// PDF 行 → 段落：按行距判断“这里是不是换段”（1.9.4，docs/PLAN-1.9.4.md 第 6、7 节）。
//
// 1.9.3 以前用固定阈值：行间距 > 字号 × 1.2 × 1.55（约字号的 1.86 倍）就换段。单倍行距没问题，
// 但 1.5 / 2 倍行距的 PDF 每一行的行距都超过阈值，于是每一行都成了一段，比较时成片报“新增 / 删除”。
//
// 现在：
// 1. 按页估计“常见行距”：同一页里同字号相邻两行的行距 / 字号，取较小那三成里最大的值（30% 分位）。
//    阈值 = max(1.86, 1.1 × 常见行距) × 字号。单倍行距时（常见行距 ≈ 1.2）和以前完全一样。
// 2. 样本不足的页面保守回退：可用的相邻行少于 MIN_PAIRS 对时，只有这一页的每对行距都不小于全文常见行距的 85%，
//    才借用全文的值；否则用以前的固定阈值（宁可多切，不把两段并成一段）。全文也不够时同样用固定阈值。
// 3. 同一页里混着不同行距（如正文单倍、附件 1.5 倍）：按页的值会偏小，大行距那部分又被切碎。
//    所以优先看局部：前后各 4 对相邻行里，上一行写满了一整行（被自动换行）的那些行距一定是“段内行距”，取离这一对最近的那个（同样近时取小的）当这一片的常见行距；
//    附近没有这样的行（比如一串单行的段落），才用整页的值。
// 只管行距；页码变化、字号变化、项目符号、表格行、缩进等其他换段规则仍在 pdf.ts 里，原样不变。

export interface PLine { y: number; x: number; size: number; page: number; text: string; cols?: boolean; _end?: number }

export const MIN_PAIRS = 6;
const FIXED = 1.2 * 1.55; // 以前的固定阈值（字号的倍数）
const REL = 1.1; // 段距至少比常见行距大 10%（Word 2 倍行距 + 段后 6 磅约大 20%）
const LOCAL = 4; // 看前后各几对相邻行

const sameSize = (a: PLine, b: PLine) => Math.abs(a.size - b.size) <= 0.5;
/** 可以拿来统计行距的一对相邻行：同一页、同字号、都不是表格行、下一行在上一行下面且不远 */
function usable(a: PLine, b: PLine) {
  if (a.page !== b.page || !sameSize(a, b) || a.cols || b.cols) return false;
  const g = a.y - b.y;
  return g > 0 && g < Math.max(a.size, b.size) * 4;
}
const ratio = (a: PLine, b: PLine) => (a.y - b.y) / Math.max(a.size, b.size);
function p30(v: number[]) { const s = [...v].sort((x, y) => x - y); return s[Math.floor(0.3 * (s.length - 1))]; }

export interface ParaStats { docTypical: number | null; pageTypical: Map<number, number | null>; pageSource: Map<number, 'page' | 'doc' | 'fixed'> }

export function lineSpacingStats(lines: PLine[]): ParaStats {
  const byPage = new Map<number, number[]>();
  const all: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    if (!usable(a, b)) continue;
    const r = ratio(a, b);
    all.push(r);
    (byPage.get(a.page) || byPage.set(a.page, []).get(a.page)!).push(r);
  }
  const docTypical = all.length >= MIN_PAIRS ? p30(all) : null;
  const pageTypical = new Map<number, number | null>();
  const pageSource = new Map<number, 'page' | 'doc' | 'fixed'>();
  const pages = new Set(lines.map((l) => l.page));
  for (const p of pages) {
    const v = byPage.get(p) || [];
    if (v.length >= MIN_PAIRS) { pageTypical.set(p, p30(v)); pageSource.set(p, 'page'); }
    else if (docTypical != null && v.length > 0 && Math.min(...v) >= docTypical * 0.85) { pageTypical.set(p, docTypical); pageSource.set(p, 'doc'); }
    else { pageTypical.set(p, null); pageSource.set(p, 'fixed'); }
  }
  return { docTypical, pageTypical, pageSource };
}

/** 每一行和上一行之间“因为行距大而换段”吗（第 0 行恒为 false；跨页、负行距等由调用方处理） */
/** 这一行是不是写满了一整行（被自动换行的）：结尾接近这一页同字号的行里最靠右的结尾 */
export function fullLines(lines: PLine[]): boolean[] {
  const fullEnd = new Map<string, number>();
  for (const l of lines) {
    if (l._end == null || l.cols) continue;
    const k = l.page + '|' + Math.round(l.size * 2);
    fullEnd.set(k, Math.max(fullEnd.get(k) ?? -Infinity, l._end));
  }
  return lines.map((l) => {
    if (l._end == null || l.cols) return false;
    const m = fullEnd.get(l.page + '|' + Math.round(l.size * 2));
    return m != null && l._end >= m - l.size * 1.5;
  });
}

export function gapBreaks(lines: PLine[], stats = lineSpacingStats(lines)): boolean[] {
  const out = new Array(lines.length).fill(false);
  const full = fullLines(lines);
  // 一定是“同一段里”的行距：上一行写满了一整行（被自动换行），和下一行之间的行距
  const wrapGap = (j: number) => (j >= 1 && j < lines.length && usable(lines[j - 1], lines[j]) && full[j - 1] ? ratio(lines[j - 1], lines[j]) : null);
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    if (a.page !== b.page) continue;
    const size = Math.max(a.size, b.size);
    const g = a.y - b.y;
    // 同页混合行距：附近（前后各 LOCAL 对）写满换行的行距就是这一片的常见行距；取最小的（边界附近宁可多切）。附近没有，用整页的值
    let typ: number | null | undefined = null;
    for (let d = 1; d <= LOCAL && typ == null; d++) {
      const rs = [wrapGap(i - d), wrapGap(i + d)].filter((r, k) => r != null && lines[k ? i + d : i - d]?.page === a.page) as number[];
      if (rs.length) typ = Math.min(...rs);
    }
    if (typ == null) typ = stats.pageTypical.get(a.page);
    const T = Math.max(FIXED, typ != null ? REL * typ : 0) * size;
    if (g > T) out[i] = true;
  }
  return out;
}
