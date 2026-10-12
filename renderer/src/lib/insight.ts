// 比较结果的“解读”：每处变更属于哪一条（条款锚点）、前后文、以及风险摘要。
// 全部是纯函数、只靠规则，不联网、不用模型，结果可解释、可复现（scripts/test-engine.mjs 有测试）。
import type { Block, Sec } from './model';
import { blockText } from './model';
import type { Change, DiffResult, MTok, Row } from './engine';

// ---------------------------------------------------------------- 条款锚点
const CN_NUM = '[一二三四五六七八九十百零〇两\\d]+';
const CLAUSE_RE = new RegExp(
  `^\\s*(第\\s*${CN_NUM}\\s*[条章节款部分篇]|Article\\s+[\\dIVXLC]+|Section\\s+\\d+(\\.\\d+)*|Clause\\s+\\d+|\\d{1,2}(\\.\\d{1,2}){0,2}[、.．]\\s*\\S|[一二三四五六七八九十]+、)`,
  'i',
);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

/** 这一块是不是“条款标题”：标题样式，或者短小的“第 X 条 / 1.2 / Article 3”开头的段落 */
export function clauseTitle(b: Block): string | null {
  if (b.kind === 'tr') return null;
  const text = blockText(b).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (b.kind === 'h') return clip(text, 28);
  if (text.length <= 40 && CLAUSE_RE.test(text)) return clip(text, 28);
  const m = text.match(new RegExp(`^\\s*(第\\s*${CN_NUM}\\s*条)\\s*([^\\s，。,.:：;；]{0,12})`));
  if (m) return `${m[1].replace(/\\s+/g, ' ')} ${m[2]}`.trim();
  return null;
}

/** 正文第一个非空块如果是标题、又不像“第 X 条”，就是文档名而不是条款（PDF 里标题级别和对齐方式都靠猜，所以不看这两项） */
function isDocTitle(b: Block, isFirst: boolean) {
  if (!isFirst || b.kind !== 'h') return false;
  return !CLAUSE_RE.test(blockText(b));
}

/**
 * 给每处变更挂上所属条款。返回 cid → 条款标题；null 表示在第一个条款之前（文档开头）。
 * 页眉 / 页脚 / 脚注里的变更不挂条款，由区段本身说明位置。
 */
export function clauseMap(res: DiffResult, blocksA: Block[], blocksB: Block[]): Map<number, string | null> {
  const rowClause: (string | null)[] = [];
  let cur: string | null = null;
  let seenBody = false;
  res.rows.forEach((r, i) => {
    if (r.sec && r.sec !== 'body') { rowClause[i] = null; return; }
    const blk = r.bi !== undefined ? blocksB[r.bi] : r.ai !== undefined ? blocksA[r.ai] : undefined;
    if (blk) {
      const nonEmpty = !!blockText(blk).trim();
      const first = nonEmpty && !seenBody;
      if (nonEmpty) seenBody = true;
      if (!isDocTitle(blk, first)) { const t = clauseTitle(blk); if (t) cur = t; }
    }
    rowClause[i] = cur;
  });
  const out = new Map<number, string | null>();
  for (const c of res.changes) out.set(c.id, rowClause[c.row] ?? null);
  return out;
}

// ---------------------------------------------------------------- 前后文
export interface Ctx { a: string; aStart: number; aEnd: number; b: string; bStart: number; bEnd: number }

/** 变更在原文 / 新文里的位置：整段文字 + 变更所占的区间（用来补全被拆开的数字，如 120 + ",000 元"） */
export function changeContext(row: Row, cid: number): Ctx {
  const side = (s: 'a' | 'b') => {
    let text = '', start = -1, end = -1;
    row.merged.forEach((m: MTok) => {
      const tk = m[s];
      if (!tk || tk.psep) return;
      const piece = tk.sep ? ' | ' : tk.t;
      if (m.cid === cid && m.op !== 0) { if (start < 0) start = text.length; text += piece; end = text.length; }
      else text += piece;
    });
    if (start < 0) { start = end = 0; }
    return { text, start, end };
  };
  const A = side('a'), B = side('b');
  return { a: A.text, aStart: A.start, aEnd: A.end, b: B.text, bStart: B.start, bEnd: B.end };
}

// ---------------------------------------------------------------- 数字与日期
const ZH_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const ZH_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 十二 → 12，二十四 → 24，一百二十 → 120，三万五千 → 35000 */
export function parseZhNumber(s: string): number | null {
  if (!/^[零〇一二两三四五六七八九十百千万亿]+$/.test(s)) return null;
  let total = 0, section = 0, num = 0;
  for (const ch of s) {
    if (ch in ZH_DIGIT) num = ZH_DIGIT[ch];
    else if (ch in ZH_UNIT) { section += (num || 1) * ZH_UNIT[ch]; num = 0; }
    else if (ch === '万' || ch === '亿') { total += (section + num) * (ch === '万' ? 1e4 : 1e8); section = 0; num = 0; }
  }
  return total + section + num;
}

const NUM_RE = /(?:\d{1,3}(?:[,，]\d{3})+|\d+)(?:\.\d+)?(?:\s*[万亿])?|[零〇一二两三四五六七八九十百千万亿]{1,10}/g;

interface NumHit { value: number; text: string; start: number; end: number; left: string; right: string }

function parseNum(raw: string): number | null {
  const s = raw.replace(/\s+/g, '');
  if (/^[\d,，.]+[万亿]?$/.test(s)) {
    const mult = s.endsWith('万') ? 1e4 : s.endsWith('亿') ? 1e8 : 1;
    const v = parseFloat(s.replace(/[万亿]$/, '').replace(/[,，]/g, ''));
    return isNaN(v) ? null : v * mult;
  }
  return parseZhNumber(s);
}

/** 文字中与 [start, end) 重叠的那个数字 */
function numberAt(text: string, start: number, end: number): NumHit | null {
  NUM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUM_RE.exec(text))) {
    const s = m.index, e = s + m[0].length;
    if (e <= start || s >= Math.max(end, start + 1)) continue;
    const value = parseNum(m[0]);
    if (value === null) continue;
    return { value, text: m[0], start: s, end: e, left: text.slice(Math.max(0, s - 8), s), right: text.slice(e, e + 8) };
  }
  return null;
}

const CURRENCY_RIGHT = /^\s*(万元|亿元|元|人民币|美元|欧元|港元|USD|RMB|CNY|EUR|dollars?)/i;
const CURRENCY_LEFT = /(人民币|RMB|CNY|USD|EUR|US\$|\$|¥|￥|€)\s*$/i;
const PERCENT_RIGHT = /^\s*(%|％|个百分点|percent)/i;
const DURATION_RIGHT = /^\s*(个工作日|工作日|个自然日|自然日|日|天|个月|月|年|周|星期|小时|business days?|days?|months?|years?|weeks?|hours?)/i;
const ORDINAL = (h: NumHit) => /第\s*$/.test(h.left) && /^\s*[条款章节页项部篇]/.test(h.right);
const MONEY_CLAUSE = /费用|价款|价格|金额|支付|付款|报酬|结算|违约金|price|fee|payment|amount/i;

const DATE_RES = [/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g];
function dateAt(text: string, start: number, end: number): { d: Date; text: string } | null {
  for (const re of DATE_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const s = m.index, e = s + m[0].length;
      if (e <= start || s >= Math.max(end, start + 1)) continue;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!isNaN(d.getTime())) return { d, text: m[0] };
    }
  }
  return null;
}

// ---------------------------------------------------------------- 风险摘要
export type RiskCat = 'money' | 'date' | 'term' | 'kw';
/** 与语言无关的描述，界面层（describe.ts）负责翻译 */
export type RiskDetail =
  | { k: 'money'; a: number; b: number; unit: string; pct?: number }
  | { k: 'percent'; a: number; b: number }
  | { k: 'amount-new'; v: number; unit: string; del?: boolean }
  | { k: 'date'; a: string; b: string; days: number; months: number }
  | { k: 'term'; a: number; b: number; unit: string }
  | { k: 'kw'; words: string[] };
export interface Risk { cid: number; cat: RiskCat; detail: RiskDetail; kw?: string[] }
export interface RiskOpts { money: boolean; date: boolean; keywords: string[] }

export const DEFAULT_KEYWORDS = ['违约', '赔偿', '责任上限', '解除'];

function unitOf(h: NumHit): string {
  const r = h.right.match(CURRENCY_RIGHT) || h.right.match(PERCENT_RIGHT) || h.right.match(DURATION_RIGHT);
  if (r) return r[1];
  const l = h.left.match(CURRENCY_LEFT);
  return l ? l[1] : '';
}

export function detectRisks(res: DiffResult, clauses: Map<number, string | null>, o: RiskOpts): Risk[] {
  const out: Risk[] = [];
  const kws = o.keywords.map((k) => k.trim()).filter(Boolean);
  for (const c of res.changes) {
    if (c.kind === 'fmt' || c.kind === 'move') continue;
    const row = res.rows[c.row];
    if (!row) continue;
    const clause = clauses.get(c.id) || '';
    const hitKw = kws.filter((k) => {
      const lk = k.toLowerCase();
      return c.before.toLowerCase().includes(lk) || c.after.toLowerCase().includes(lk) || clause.toLowerCase().includes(lk);
    });
    let risk: Risk | null = null;
    const ctx = changeContext(row, c.id);

    if ((o.money || o.date) && c.kind === 'mod') {
      const da = dateAt(ctx.a, ctx.aStart, ctx.aEnd), db = dateAt(ctx.b, ctx.bStart, ctx.bEnd);
      if (o.date && da && db && da.text !== db.text) {
        const days = Math.round((db.d.getTime() - da.d.getTime()) / 864e5);
        const months = (db.d.getFullYear() - da.d.getFullYear()) * 12 + db.d.getMonth() - da.d.getMonth();
        risk = { cid: c.id, cat: 'date', detail: { k: 'date', a: da.text, b: db.text, days, months: db.d.getDate() === da.d.getDate() ? months : 0 } };
      } else {
        const na = numberAt(ctx.a, ctx.aStart, ctx.aEnd), nb = numberAt(ctx.b, ctx.bStart, ctx.bEnd);
        if (na && nb && na.value !== nb.value && !ORDINAL(na) && !ORDINAL(nb)) {
          const unit = unitOf(nb) || unitOf(na);
          const isPct = PERCENT_RIGHT.test(nb.right) || PERCENT_RIGHT.test(na.right);
          const isMoney = CURRENCY_RIGHT.test(nb.right) || CURRENCY_LEFT.test(nb.left) || CURRENCY_RIGHT.test(na.right) || CURRENCY_LEFT.test(na.left);
          const isDur = DURATION_RIGHT.test(nb.right) || DURATION_RIGHT.test(na.right);
          if (o.money && isPct) risk = { cid: c.id, cat: 'money', detail: { k: 'percent', a: na.value, b: nb.value } };
          else if (o.money && (isMoney || (!isDur && MONEY_CLAUSE.test(clause)))) {
            risk = { cid: c.id, cat: 'money', detail: { k: 'money', a: na.value, b: nb.value, unit, pct: na.value ? (nb.value - na.value) / na.value : undefined } };
          } else if (o.date && isDur) risk = { cid: c.id, cat: 'term', detail: { k: 'term', a: na.value, b: nb.value, unit } };
        }
      }
    } else if (o.money && (c.kind === 'ins' || c.kind === 'del')) {
      const text = c.kind === 'ins' ? c.after : c.before;
      NUM_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = NUM_RE.exec(text))) {
        const v = parseNum(m[0]);
        const h: NumHit = { value: v ?? 0, text: m[0], start: m.index, end: m.index + m[0].length, left: text.slice(Math.max(0, m.index - 8), m.index), right: text.slice(m.index + m[0].length, m.index + m[0].length + 8) };
        if (v !== null && (CURRENCY_RIGHT.test(h.right) || CURRENCY_LEFT.test(h.left))) {
          risk = { cid: c.id, cat: 'money', detail: { k: 'amount-new', v, unit: unitOf(h), del: c.kind === 'del' } };
          break;
        }
      }
    }
    if (!risk && hitKw.length) risk = { cid: c.id, cat: 'kw', detail: { k: 'kw', words: hitKw } };
    if (risk) { if (hitKw.length && risk.cat !== 'kw') risk.kw = hitKw; out.push(risk); }
  }
  const rank: Record<RiskCat, number> = { money: 0, date: 1, term: 1, kw: 2 };
  return out.sort((x, y) => rank[x.cat] - rank[y.cat] || x.cid - y.cid);
}

// ---------------------------------------------------------------- 决定的指纹
/**
 * 审阅决定按“变更指纹”保存，而不是按编号：改了比较设置、编号整体错位时，同一处修订还能认回来。
 * 指纹 = 区段 + 类型 + 前后文字 + 同样内容第几次出现。
 */
export function changeFingerprints(changes: Change[]): Map<number, string> {
  const seen = new Map<string, number>();
  const out = new Map<number, string>();
  for (const c of changes) {
    const base = `${c.sec || 'body'}|${c.kind}|${c.before.replace(/\s+/g, ' ').trim()}|${c.after.replace(/\s+/g, ' ').trim()}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    out.set(c.id, `${base}#${n}`);
  }
  return out;
}

export const SEC_LABEL: Record<Sec, string> = { header: '页眉', body: '正文', footnote: '脚注', footer: '页脚' };
