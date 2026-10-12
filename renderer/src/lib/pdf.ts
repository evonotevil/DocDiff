import * as pdfjs from 'pdfjs-dist';
// @ts-ignore
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Block, Run, DocModel, FileInfo } from './model';
import { isPageNumberText } from './model';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export class NeedPassword extends Error { constructor(public wrong: boolean) { super(wrong ? '密码错误' : '需要密码'); this.name = 'NeedPassword'; } }

export async function openPdf(data: Uint8Array, password?: string) {
  try {
    // pdfjs 会转移 buffer，传副本
    return await pdfjs.getDocument({ data: data.slice(), password, isEvalSupported: false, useSystemFonts: true }).promise;
  } catch (e: any) {
    if (e?.name === 'PasswordException') throw new NeedPassword(e.code === 2);
    throw e;
  }
}

interface Line { y: number; x: number; size: number; runs: Run[]; page: number; text: string; bottom: number }

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;

export async function parsePdf(file: FileInfo, password?: string): Promise<DocModel> {
  const pdf = await openPdf(file.data, password);
  const lines: Line[] = [];
  const pageH: number[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    try { pageH[p] = page.getViewport({ scale: 1 }).height; } catch { pageH[p] = 842; }
    const tc = await page.getTextContent();
    try { await page.getOperatorList(); } catch {}
    const fontInfo = (name: string) => {
      let f: any = null;
      try { if (page.commonObjs.has(name)) f = page.commonObjs.get(name); } catch {}
      const n: string = (f?.name || (tc.styles as any)[name]?.fontFamily || '') as string;
      const clean = n.replace(/^[A-Z]{6}\+/, '');
      return {
        b: !!f?.bold || !!f?.black || /bold|black|heavy|semibold|demi|w[6-9]/i.test(clean),
        i: !!f?.italic || /italic|oblique/i.test(clean),
        font: clean.replace(/[-,](bold|italic|regular|oblique|semibold|black|heavy|medium|light|mt|psmt|bolditalic).*$/i, '') || undefined,
      };
    };
    let cur: (Line & { _end?: number; cols?: boolean }) | null = null;
    for (const it of tc.items as any[]) {
      if (!('str' in it)) continue;
      const [a, b, c, d, x, y] = it.transform;
      const size = Math.round(Math.hypot(c, d) * 10) / 10 || Math.round(Math.hypot(a, b) * 10) / 10 || 10;
      const str: string = it.str;
      if (!str) continue; // 空的换行标记不可靠（有时出现在行中间），只按坐标分行
      const sameLine = cur && cur.page === p && Math.abs(cur.y - y) < Math.max(2, size * 0.45) && x >= (cur._end ?? x) - size * 2;
      // 很宽的空白 = 表格列间距
      if (/^\s+$/.test(str)) {
        if (sameLine && (it.width || 0) > size * 1.5) { cur!.runs.push({ t: '\t' }); cur!.text += '\t'; cur!.cols = true; cur!._end = x + (it.width || 0); }
        else if (sameLine) { cur!.runs.push({ ...cur!.runs[cur!.runs.length - 1], t: ' ' }); cur!.text += ' '; cur!._end = x + (it.width || 0); }
        continue;
      }
      // 脚注在正文里的上标号（小一号、抬高的 1~3 位数字）：Word 那边不进文字，这里也去掉，免得每处都报差异
      if (cur && cur.page === p && /^\d{1,3}$/.test(str.trim()) && size < cur.size * 0.8 && y > cur.y + cur.size * 0.15 && Math.abs(x - (cur._end ?? x)) < cur.size * 0.6) {
        cur._end = x + (it.width || 0);
        continue;
      }
      const fi = fontInfo(it.fontName);
      const run: Run = { t: str, sz: Math.round(size * 2) / 2 };
      if (fi.b) run.b = true;
      if (fi.i) run.i = true;
      if (fi.font) run.font = fi.font;
      if (!sameLine) {
        if (cur) lines.push(cur);
        cur = { y, x, size, runs: [run], page: p, text: str, bottom: y, _end: x + (it.width || 0) };
      } else {
        const gap = x - (cur!._end ?? x);
        const prev = cur!.text;
        if (gap > size * 1.5) { cur!.runs.push({ t: '\t' }); cur!.text += '\t'; cur!.cols = true; }
        else if (gap > size * 0.18 && !/\s$/.test(prev) && !/^\s/.test(str) && !(CJK.test(prev.slice(-1)) && CJK.test(str[0]))) {
          cur!.runs.push({ ...run, t: ' ' });
          cur!.text += ' ';
        }
        cur!.runs.push(run);
        cur!.text += str;
        cur!.size = Math.max(cur!.size, size);
        cur!._end = x + (it.width || 0);
      }
    }
    if (cur) lines.push(cur);
    page.cleanup();
  }

  // 行 → 段落
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 10;

  // ---- 页眉 / 页脚：每页顶部、底部反复出现的同一行（数字视为通配，页码就能对上）----
  const nPages = pdf.numPages;
  const band = (l: Line): 'top' | 'bottom' | null => {
    const H = pageH[l.page] || 842;
    if (l.y > H * 0.9) return 'top';
    if (l.y < H * 0.075) return 'bottom';
    return null;
  };
  const norm = (t: string) => t.replace(/\d+/g, '#').replace(/\s+/g, '');
  const hfKey = new Map<string, Set<number>>();
  for (const l of lines) { const b = band(l); if (b) { const k = b + '|' + norm(l.text); (hfKey.get(k) || hfKey.set(k, new Set()).get(k)!).add(l.page); } }
  const need = Math.max(2, Math.ceil(nPages * 0.5));
  // 多页：每页都出现的顶部 / 底部行；单页：没法看重复，就看位置 + 字号（比正文小的顶部 / 底部行）
  const isHF = (l: Line) => {
    const b = band(l);
    if (!b) return false;
    if (nPages >= 2) return (hfKey.get(b + '|' + norm(l.text))?.size || 0) >= need;
    return l.size < median * 0.95 || isPageNumberText(l.text);
  };
  const header: Block[] = [], footer: Block[] = [];
  const seenHF = new Set<string>();
  let pageNumbersDropped = false;
  for (const l of lines) {
    if (!isHF(l)) continue;
    const k = band(l) + '|' + norm(l.text);
    if (seenHF.has(k)) continue;
    seenHF.add(k);
    if (isPageNumberText(l.text)) { pageNumbersDropped = true; continue; }
    (band(l) === 'top' ? header : footer).push({ kind: 'p', runs: mergeRuns(trimRuns(l.runs)), page: l.page });
  }
  let body = lines.filter((l) => !isHF(l));

  // ---- 脚注：页面下部、字号明显小于正文、以编号开头的一组行 ----
  const notes: Block[] = [];
  const noteLines = new Set<Line>();
  for (let p = 1; p <= nPages; p++) {
    const H = pageH[p] || 842;
    const pl = body.filter((l) => l.page === p);
    const tail: Line[] = [];
    for (let i = pl.length - 1; i >= 0; i--) {
      const l = pl[i];
      if (l.y > H * 0.35 || l.size > median * 0.88) break;
      tail.unshift(l);
    }
    if (!tail.length || !/^\s*\[?\d{1,3}\]?(?=[\s.、)）]|$|[\u3400-\u9fff])/.test(tail[0].text) || tail.length === pl.length) continue;
    let curNote: Line[] = [];
    const flushNote = () => {
      if (!curNote.length) return;
      const runs: Run[] = [];
      curNote.forEach((l, i) => { if (i) runs.push({ t: ' ' }); runs.push(...l.runs); });
      const text = runs.map((r) => r.t).join('');
      const m = text.match(/^\s*\[?(\d{1,3})\]?[\s.、)）]*/);
      let cut = m ? m[0].length : 0;
      const rest = trimRuns(runs);
      while (cut > 0 && rest.length) { const r = rest[0]; if (r.t.length <= cut) { cut -= r.t.length; rest.shift(); } else { rest[0] = { ...r, t: r.t.slice(cut) }; cut = 0; } }
      notes.push({ kind: 'p', runs: mergeRuns([{ t: `[${m ? m[1] : notes.length + 1}] ` }, ...trimRuns(rest)]), page: p });
      curNote = [];
    };
    for (const l of tail) {
      if (/^\s*\[?\d{1,3}\]?(?=[\s.、)）]|$|[\u3400-\u9fff])/.test(l.text)) flushNote();
      curNote.push(l);
      noteLines.add(l);
    }
    flushNote();
  }
  body = body.filter((l) => !noteLines.has(l));
  const blocks: Block[] = [];
  const BULLET = /^\s*([•·▪■◦○●\-–*\u2022\u25aa\u25cf\u25e6\u2023\u2043\uf0a7\uf0b7\uf076\uf0d8\uf0fc\uf06e\ue000-\uf8ff]|\(?\d{1,3}[.)、]|\(?[a-zA-Z][.)]|[一二三四五六七八九十]+、)\s*/;
  let cur: { lines: Line[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const ls = cur.lines;
    const runs: Run[] = [];
    ls.forEach((l, idx) => {
      if (idx > 0) {
        const prevText = ls[idx - 1].text;
        const joinNoSpace = CJK.test(prevText.slice(-1)) || CJK.test(l.text.trimStart()[0] || '');
        if (/[a-z]-$/.test(prevText) && /^[a-z]/.test(l.text)) {
          const lr = runs[runs.length - 1]; lr.t = lr.t.replace(/-$/, '');
        } else if (!joinNoSpace && !/\s$/.test(prevText)) runs.push({ ...l.runs[0], t: ' ' });
      }
      runs.push(...l.runs);
    });
    // 去掉行首尾空白
    const text = ls.map((l) => l.text).join(' ').trim();
    if (!text) { cur = null; return; }
    const size = Math.max(...ls.map((l) => l.size));
    if (ls.length === 1 && (ls[0] as any).cols) {
      const cells: Run[][] = [[]];
      for (const r of trimRuns(ls[0].runs)) { if (r.t === '\t') cells.push([]); else cells[cells.length - 1].push(r); }
      blocks.push({ kind: 'tr', runs: [], cells: cells.map((c) => mergeRuns(trimRuns(c))), page: ls[0].page });
      cur = null;
      return;
    }
    const blk: Block = { kind: 'p', runs: mergeRuns(trimRuns(runs)), page: ls[0].page };
    const m = text.match(BULLET);
    const allBold = runs.filter((r) => r.t.trim()).every((r) => r.b);
    if (size >= median * 1.15 && text.length < 160 && ls.length <= 3) {
      blk.kind = 'h';
      blk.level = size >= median * 1.8 ? 1 : size >= median * 1.4 ? 2 : 3;
    } else if (allBold && text.length < 100 && ls.length === 1 && !m) {
      blk.kind = 'h'; blk.level = 4;
    } else if (m) {
      blk.kind = 'li';
      blk.marker = /[\ue000-\uf8ff\u2022\u25cf]/.test(m[1]) ? '•' : m[1];
      blk.list = /\d|[a-zA-Z一二三四五六七八九十]/.test(m[1]) ? 'ol' : 'ul';
      blk.level = 0;
      // 从正文中去掉标号
      let toCut = m[0].length;
      while (toCut > 0 && blk.runs.length) {
        const r = blk.runs[0];
        if (r.t.length <= toCut) { toCut -= r.t.length; blk.runs.shift(); } else { r.t = r.t.slice(toCut); toCut = 0; }
      }
    }
    blocks.push(blk);
    cur = null;
  };
  for (let i = 0; i < body.length; i++) {
    const l = body[i];
    const prev = i > 0 ? body[i - 1] : null;
    if (!cur || !prev) { cur = { lines: [l] }; continue; }
    const lh = Math.max(prev.size, l.size) * 1.2;
    const gap = prev.y - l.y;
    const newPara =
      l.page !== prev.page ? !(prev.text.length > 40 && !/[.。!！?？:：;；]$/.test(prev.text.trim())) :
      gap > lh * 1.55 || gap < -2 ||
      Math.abs(l.size - prev.size) > median * 0.12 ||
      BULLET.test(l.text) || (l as any).cols || (prev as any).cols ||
      (prev.text.trim().length < 40 && /[.。!！?？:：]$/.test(prev.text.trim())) ||
      (l.x - prev.x > l.size * 1.5);
    if (newPara) { flush(); cur = { lines: [l] }; } else cur.lines.push(l);
  }
  flush();

  // 元数据
  const meta: Record<string, string> = {};
  try {
    const md: any = await pdf.getMetadata();
    const info = md.info || {};
    Object.assign(meta, {
      标题: info.Title || '', 作者: info.Author || '', 主题: info.Subject || '', 关键词: info.Keywords || '',
      创建程序: info.Creator || '', PDF生成器: info.Producer || '',
      文档创建时间: pdfDate(info.CreationDate), 文档修改时间: pdfDate(info.ModDate),
      PDF版本: info.PDFFormatVersion || '', 线性化: info.IsLinearized ? '是' : '否',
      加密: password ? '是（已用密码打开）' : info.IsEncrypted ? '是' : '否',
      含表单: info.IsAcroFormPresent ? '是' : '否',
    });
  } catch {}
  try {
    const p1 = await pdf.getPage(1);
    const vp = p1.getViewport({ scale: 1 });
    meta['页面尺寸'] = `${Math.round(vp.width / 72 * 25.4)} × ${Math.round(vp.height / 72 * 25.4)} mm`;
  } catch {}
  meta['是否为扫描件'] = blocks.length === 0 ? '可能是（未提取到文字，请使用 OCR 模式）' : '否';
  const pageCount = pdf.numPages;
  await pdf.destroy();
  const multi = nPages >= 2;
  return {
    file, type: 'pdf', blocks, meta, pageCount, pdfPassword: password,
    secBlocks: { header, footer, footnote: notes },
    secInfo: {
      header: header.length ? 'found' : multi ? 'none' : 'unknown',
      footer: footer.length ? 'found' : multi || pageNumbersDropped ? 'none' : 'unknown',
      footnote: notes.length ? 'found' : 'unknown',
      pageNumbersDropped,
    },
  };
}

function trimRuns(runs: Run[]): Run[] {
  const r = runs.map((x) => ({ ...x }));
  while (r.length && !r[0].t.trim()) r.shift();
  while (r.length && !r[r.length - 1].t.trim()) r.pop();
  if (r.length) { r[0].t = r[0].t.trimStart(); r[r.length - 1].t = r[r.length - 1].t.trimEnd(); }
  return r;
}

function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !!last.b === !!r.b && !!last.i === !!r.i && last.sz === r.sz && last.font === r.font) last.t += r.t;
    else out.push({ ...r });
  }
  return out;
}

function pdfDate(s?: string): string {
  if (!s) return '';
  const m = s.match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return s;
  return `${m[1]}-${m[2] || '01'}-${m[3] || '01'} ${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
}

// ---------- 页面渲染（图像 / OCR 模式） ----------
export interface PageImage { width: number; height: number; canvas: HTMLCanvasElement }

export async function renderPdfPages(data: Uint8Array, opts: { scale: number; password?: string; onProgress?: (i: number, n: number) => void; maxPages?: number }): Promise<PageImage[]> {
  const pdf = await openPdf(data, opts.password);
  const n = Math.min(pdf.numPages, opts.maxPages || 500);
  const out: PageImage[] = [];
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: opts.scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push({ width: canvas.width, height: canvas.height, canvas });
    page.cleanup();
    opts.onProgress?.(i, n);
  }
  await pdf.destroy();
  return out;
}
