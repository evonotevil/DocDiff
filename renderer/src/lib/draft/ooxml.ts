// 审阅稿 / 定稿的写入（1.8）。
// 在对方文件（修改后文档）的拷贝上只改 word/document.xml 里有差异的地方，其余部件原样保留：
//   - 未决定 / 待议：写成对方的 Word 修订（A 的字为删除、B 的字为插入），对方在 Word 里可逐条处理；
//   - 接受：B 的字落定，不留标记；
//   - 拒绝：以审阅人的名义写修订，把 B 的字删掉、A 的字插回来；
//   - 待议、备注：写成 Word 批注，挂在这处差异上。
// 写完立刻按“接受全部修订”重新读一遍，文字必须和预期逐块一致，否则不交付。
// 只依赖标准 DOM 接口（childNodes / getAttributeNS / createElementNS），在 Worker 里配 @xmldom/xmldom 使用。
import JSZip from 'jszip';
import type { Plan, Op, PlanBlock, RunStyle } from './plan';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const CT_COMMENTS = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';

export type Verdict = 'a' | 'r' | 'h';
export interface Decision { v?: Verdict; note?: string; by?: string; at?: number }
export interface XmlIO { parse(s: string): Document; serialize(d: Document): string }

export interface WriteInput {
  base: Uint8Array;
  plan: Plan;
  decisions: Record<number, Decision>;
  mode: 'draft' | 'final';
  /** 定稿时未决定 / 待议的处理：'b' 保持对方写法，'a' 恢复原文 */
  pending?: 'a' | 'b';
  /** 定稿时是否保留批注（默认去掉） */
  keepComments?: boolean;
  reviewer: string;
  reviewerInitials?: string;
  theirs: string;
  theirsDate: number;
  now: number;
  io: XmlIO;
}
export type Reason = 'section' | 'mismatch' | 'field' | 'textbox' | 'image' | 'cell' | 'place' | 'range';
export interface WriteOutput {
  bytes: Uint8Array;
  unwritten: { cid: number; reason: Reason }[];
  /** 写进去的变更数（含接受的） */
  written: number;
  /** 对方文件里原有的修订有多少处按“接受”处理了 */
  priorRevisions: number;
  ms: { parse: number; apply: number; verify: number; zip: number };
}

// ---------------- DOM 小工具 ----------------
const isEl = (n: Node | null | undefined): n is Element => !!n && n.nodeType === 1;
const isW = (n: Node | null | undefined, local?: string): n is Element => isEl(n) && n.namespaceURI === W && (!local || n.localName === local);
function kids(el: Node, local?: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (isEl(c) && (!local || c.localName === local)) out.push(c);
  return out;
}
const kid = (el: Node | null | undefined, local: string): Element | null => {
  if (!el) return null;
  for (let c = el.firstChild; c; c = c.nextSibling) if (isEl(c) && c.localName === local) return c;
  return null;
};
const wattr = (el: Element | null, name: string): string | null => (el ? el.getAttributeNS(W, name) || el.getAttribute('w:' + name) : null);
function descendants(el: Node, local: string, ns = W): Element[] {
  const out: Element[] = [];
  const rec = (n: Node) => { for (let c = n.firstChild; c; c = c.nextSibling) if (isEl(c)) { if (c.localName === local && c.namespaceURI === ns) out.push(c); rec(c); } };
  rec(el);
  return out;
}
const insertAfter = (n: Node, ref: Node) => { const p = ref.parentNode!; if (ref.nextSibling) p.insertBefore(n, ref.nextSibling); else p.appendChild(n); };
const unwrap = (el: Element) => { const p = el.parentNode!; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); };
const remove = (n: Node) => n.parentNode?.removeChild(n);
const ancestor = (n: Node, local: string): Element | null => { for (let p = n.parentNode; p; p = p.parentNode) if (isW(p, local)) return p; return null; };
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

// ---------------- 已有修订按“接受”处理 ----------------
const DROP = new Set(['del', 'moveFrom', 'cellDel', 'cellIns', 'cellMerge', 'rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'tblPrExChange', 'tblGridChange', 'trPrChange', 'tcPrChange', 'numberingChange',
  'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd', 'customXmlInsRangeStart', 'customXmlInsRangeEnd', 'customXmlDelRangeStart', 'customXmlDelRangeEnd', 'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd', 'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd']);
const UNWRAP = new Set(['ins', 'moveTo']);
/** 返回处理掉的修订数（只数真正带内容的 ins / del / moveFrom / moveTo） */
export function acceptExisting(root: Element): number {
  const drop: Element[] = [], un: Element[] = [];
  let n = 0;
  const rec = (el: Element) => {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (!isW(c)) { if (isEl(c)) rec(c); continue; }
      if (DROP.has(c.localName)) { drop.push(c); if ((c.localName === 'del' || c.localName === 'moveFrom') && c.firstChild) n++; continue; }
      if (UNWRAP.has(c.localName)) { un.push(c); if (c.firstChild) n++; }
      rec(c);
    }
  };
  rec(root);
  drop.forEach(remove);
  // 由内向外拆：先拆深的
  un.reverse().forEach(unwrap);
  return n;
}

// ---------------- 定位：和 docx.ts 的读法一一对应 ----------------
export interface Atom { text: string; run: Element | null; node: Element | null; para: Element | null; s: number; e: number; bad?: 'field' | 'textbox' | 'virtual' }
export interface CellLoc { atoms: Atom[]; text: string; paras: Element[] }
export interface BlockLoc { el: Element; kind: 'p' | 'tr'; cells: CellLoc[] }

/** accept = 按“接受全部修订”读（跳过删除、读插入）；docx.ts 本来就是这么读的 */
export function locate(doc: Document): BlockLoc[] {
  const out: BlockLoc[] = [];
  let fld = 0; // 复杂域嵌套深度
  const collect = (container: Element, cell: { atoms: Atom[] }, para: Element, bad: Atom['bad'] | undefined, pos: { o: number }) => {
    for (let el = container.firstChild; el; el = el.nextSibling) {
      if (!isW(el)) continue;
      const ln = el.localName;
      if (ln === 'r') {
        // 域：begin 之后、end 为止的字都算在域里（包括域结果）
        let inField = fld > 0;
        for (const c of kids(el, 'fldChar')) { const t = wattr(c, 'fldCharType'); if (t === 'begin') { fld++; inField = true; } }
        const b = bad || (inField ? 'field' : undefined);
        const push = (text: string, node: Element, bb = b) => { if (!text) return; const s = pos.o; pos.o += text.length; cell.atoms.push({ text, run: el as Element, node, para, s, e: pos.o, bad: bb }); };
        for (const c of kids(el)) {
          const cl = c.localName;
          if (c.namespaceURI !== W && cl !== 'AlternateContent') continue;
          if (cl === 't') push(c.textContent || '', c);
          else if (cl === 'tab') push('\t', c);
          else if (cl === 'br' || cl === 'cr') { if (wattr(c, 'type') !== 'page') push('\n', c); }
          else if (cl === 'noBreakHyphen') push('‑', c);
          else if (cl === 'sym') { const ch = wattr(c, 'char'); if (ch) push(String.fromCharCode(parseInt(ch, 16) & 0xffff), c); }
          else if (cl === 'drawing' || cl === 'pict' || cl === 'object') {
            const txbx = descendants(c, 'txbxContent');
            if (txbx.length) { for (const tb of txbx) for (const p of kids(tb, 'p')) collect(p, cell, p, 'textbox', pos); }
            else push('[图片]', c);
          } else if (cl === 'AlternateContent') {
            const choice = kid(c, 'Choice') || kid(c, 'Fallback');
            if (choice) collect(choice, cell, para, b, pos);
          }
        }
        for (const c of kids(el, 'fldChar')) if (wattr(c, 'fldCharType') === 'end' && fld > 0) fld--;
      } else if (ln === 'fldSimple') collect(el, cell, para, bad || 'field', pos);
      else if (ln === 'hyperlink' || ln === 'ins' || ln === 'smartTag' || ln === 'customXml' || ln === 'sdtContent' || ln === 'moveTo' || ln === 'dir' || ln === 'bdo') collect(el, cell, para, bad, pos);
      else if (ln === 'sdt') collect(kid(el, 'sdtContent') || el, cell, para, bad, pos);
    }
  };
  const mkCell = (paras: Element[]): CellLoc => {
    const cell: CellLoc = { atoms: [], text: '', paras };
    const pos = { o: 0 };
    paras.forEach((p, i) => {
      if (i > 0) { cell.atoms.push({ text: '\n', run: null, node: null, para: p, s: pos.o, e: pos.o + 1, bad: 'virtual' }); pos.o++; }
      collect(p, cell, p, undefined, pos);
    });
    cell.text = cell.atoms.map((a) => a.text).join('');
    return cell;
  };
  const walk = (container: Element) => {
    for (let el = container.firstChild; el; el = el.nextSibling) {
      if (!isW(el)) continue;
      const ln = el.localName;
      if (ln === 'p') out.push({ el, kind: 'p', cells: [mkCell([el])] });
      else if (ln === 'tbl') {
        // 已删除的行（trPr 里有 del）按“接受全部修订”不存在
        for (const tr of kids(el, 'tr')) if (!kid(kid(tr, 'trPr'), 'del')) out.push({ el: tr, kind: 'tr', cells: kids(tr, 'tc').map((tc) => mkCell(descendants(tc, 'p'))) });
      } else if (ln === 'sdt') walk(kid(el, 'sdtContent') || el);
      else if (ln === 'customXml' || ln === 'ins') walk(el);
    }
  };
  const body = descendants(doc.documentElement, 'body')[0];
  if (body) walk(body);
  return out;
}

const blockString = (b: BlockLoc) => b.cells.map((c) => c.text).join('\t');

// ---------------- 写 run ----------------
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];

class Writer {
  revId: number;
  constructor(public doc: Document, startId: number) { this.revId = startId; }
  el(local: string, attrs: Record<string, string> = {}, ...children: Node[]): Element {
    const e = this.doc.createElementNS(W, 'w:' + local);
    for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, 'w:' + k, v);
    for (const c of children) e.appendChild(c);
    return e;
  }
  text(local: 't' | 'delText', s: string): Element {
    const t = this.el(local);
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.appendChild(this.doc.createTextNode(s));
    return t;
  }
  /** 修订包装：ins / del，带编号、作者、时间 */
  rev(kind: 'ins' | 'del', author: string, date: number): Element {
    return this.el(kind, { id: String(this.revId++), author, date: iso(date) });
  }
  setProp(rPr: Element, local: string, attrs: Record<string, string> | null) {
    for (const c of kids(rPr, local)) if (c.namespaceURI === W) remove(c);
    if (!attrs) return;
    const e = this.el(local, attrs);
    const idx = RPR_ORDER.indexOf(local);
    let ref: Node | null = null;
    for (const c of kids(rPr)) { const j = RPR_ORDER.indexOf(c.localName); if (j > idx || c.localName === 'rPrChange') { ref = c; break; } }
    if (ref) rPr.insertBefore(e, ref); else rPr.appendChild(e);
  }
  /** 按 A 的样式调整 rPr（克隆的邻近 rPr 上覆盖；新建时从空开始） */
  styleRPr(base: Element | null, st: RunStyle, explicit: boolean): Element | null {
    const rPr = base ? (base.cloneNode(true) as Element) : this.el('rPr');
    for (const c of kids(rPr, 'rPrChange')) remove(c);
    const tog = (local: string, v: boolean | undefined) => { if (v !== undefined || explicit) this.setProp(rPr, local, v ? {} : explicit ? { val: '0' } : null); };
    if (explicit || st.b !== undefined) { tog('b', !!st.b); tog('bCs', !!st.b); }
    if (explicit || st.i !== undefined) { tog('i', !!st.i); tog('iCs', !!st.i); }
    if (explicit || st.s !== undefined) tog('strike', !!st.s);
    if (explicit || st.u !== undefined) this.setProp(rPr, 'u', st.u ? { val: 'single' } : explicit ? { val: 'none' } : null);
    if (st.sz) { this.setProp(rPr, 'sz', { val: String(Math.round(st.sz * 2)) }); this.setProp(rPr, 'szCs', { val: String(Math.round(st.sz * 2)) }); }
    if (st.color) this.setProp(rPr, 'color', { val: st.color.replace('#', '') });
    if (st.font && !base) this.setProp(rPr, 'rFonts', { ascii: st.font, hAnsi: st.font, eastAsia: st.font });
    return kids(rPr).length ? rPr : null;
  }
  /** 一段文字写成若干 run（\t → tab，\n → br） */
  runs(text: string, rPr: Element | null, deleted: boolean): Element[] {
    const out: Element[] = [];
    const parts = text.split(/(\t|\n)/);
    for (const p of parts) {
      if (!p) continue;
      const r = this.el('r');
      if (rPr) r.appendChild(rPr.cloneNode(true));
      if (p === '\t') r.appendChild(this.el('tab'));
      else if (p === '\n') r.appendChild(this.el('br'));
      else r.appendChild(this.text(deleted ? 'delText' : 't', p));
      out.push(r);
    }
    return out;
  }
}

/** 把 run 拆成“每个 run 只含一个内容元素” */
function explodeRun(w: Writer, r: Element) {
  const rPr = kid(r, 'rPr');
  const content = kids(r).filter((c) => c !== rPr);
  if (content.length <= 1) return;
  let ref: Element = r;
  for (let i = 1; i < content.length; i++) {
    const nr = w.el('r');
    if (rPr) nr.appendChild(rPr.cloneNode(true));
    nr.appendChild(content[i]); // 从原 run 里移走
    insertAfter(nr, ref);
    ref = nr;
  }
}
/** 在 w:t 的第 k 个字符处把 run 一分为二（run 已拆成只含这一个 w:t） */
function splitTextRun(w: Writer, r: Element, t: Element, k: number) {
  const s = t.textContent || '';
  const nr = r.cloneNode(true) as Element;
  const nt = kid(nr, 't')!;
  while (nt.firstChild) nt.removeChild(nt.firstChild);
  nt.appendChild(w.doc.createTextNode(s.slice(k)));
  nt.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(w.doc.createTextNode(s.slice(0, k)));
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  insertAfter(nr, r);
}

/** run 的最外层（被我们包了 ins / del 时是包装） */
const outer = (r: Element, wrap: Set<Element>): Element => (r.parentNode && wrap.has(r.parentNode as Element) ? (r.parentNode as Element) : r);

/** 把一个 run 的文字改成删除文字 */
function toDeleted(w: Writer, r: Element) {
  for (const t of descendants(r, 't')) {
    if (ancestor(t, 'txbxContent')) continue;
    const d = w.text('delText', t.textContent || '');
    t.parentNode!.replaceChild(d, t);
  }
  for (const t of descendants(r, 'instrText')) {
    const d = w.el('delInstrText'); d.setAttributeNS(XML_NS, 'xml:space', 'preserve'); d.appendChild(w.doc.createTextNode(t.textContent || ''));
    t.parentNode!.replaceChild(d, t);
  }
}

/** 段落里所有顶层 run（不含文本框里的） */
function paraRuns(p: Element): Element[] {
  const out: Element[] = [];
  const rec = (n: Element) => { for (const c of kids(n)) { if (!isW(c)) continue; if (c.localName === 'r') out.push(c); else if (c.localName !== 'pPr' && c.localName !== 'del' && c.localName !== 'moveFrom') rec(c); } };
  rec(p);
  return out;
}

/** 段落标记的修订：pPr/rPr 下第一个子元素 */
function markPara(w: Writer, p: Element, kind: 'ins' | 'del', author: string, date: number): boolean {
  let pPr = kid(p, 'pPr');
  if (!pPr) { pPr = w.el('pPr'); p.insertBefore(pPr, p.firstChild); }
  if (kind === 'del' && kid(pPr, 'sectPr')) return false; // 分节符所在段落不删段落标记
  let rPr = kid(pPr, 'rPr');
  if (!rPr) { rPr = w.el('rPr'); const ref = kid(pPr, 'sectPr') || kid(pPr, 'pPrChange'); if (ref) pPr.insertBefore(rPr, ref); else pPr.appendChild(rPr); }
  rPr.insertBefore(w.rev(kind, author, date), rPr.firstChild);
  return true;
}
function markRow(w: Writer, tr: Element, kind: 'ins' | 'del', author: string, date: number) {
  let trPr = kid(tr, 'trPr');
  if (!trPr) { trPr = w.el('trPr'); const ex = kid(tr, 'tblPrEx'); if (ex) insertAfter(trPr, ex); else tr.insertBefore(trPr, tr.firstChild); }
  const ch = kid(trPr, 'trPrChange');
  const m = w.rev(kind, author, date);
  if (ch) trPr.insertBefore(m, ch); else trPr.appendChild(m);
}

// ---------------- 主流程 ----------------
type Act = 'keep' | 'theirs' | 'mine' | 'revert' | 'none';

/** 同一份对方文件反复写（每个决定一次）：解压、读出正文、按“接受”处理原有修订只做一次 */
export interface Prepared { zip: JSZip; xml: string; prior: number; orig: Record<string, string | null> }
const TOUCHED = ['word/document.xml', 'word/comments.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml', 'word/commentsExtended.xml', 'word/commentsIds.xml', 'word/commentsExtensible.xml'];
export async function prepareBase(base: Uint8Array, io: XmlIO): Promise<Prepared> {
  const zip = await JSZip.loadAsync(base);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('docx: no word/document.xml');
  const orig: Record<string, string | null> = {};
  for (const p of TOUCHED) { const f = zip.file(p); orig[p] = f ? await f.async('string') : null; }
  const doc = io.parse(orig['word/document.xml']!);
  const prior = acceptExisting(doc.documentElement);
  return { zip, xml: io.serialize(doc), prior, orig };
}

export async function writeReview(inp: WriteInput & { prepared?: Prepared }): Promise<WriteOutput> {
  const t0 = now();
  const { plan, decisions, mode, io } = inp;
  const prep = inp.prepared || await prepareBase(inp.base, io);
  const zip = prep.zip;
  // 上一次写入改过的部件先还原成对方文件里的原样
  for (const [p, v] of Object.entries(prep.orig)) { if (v === null) zip.remove(p); else zip.file(p, v); }
  const doc = io.parse(prep.xml);
  const priorRevisions = prep.prior;
  let blocks = locate(doc);
  const baseText = blocks.map((b) => b.cells.map((c) => c.text));
  const t1 = now();

  // 变更 → 动作
  const act = (cid: number): Act => {
    const v = decisions[cid]?.v;
    if (mode === 'draft') return v === 'a' ? 'keep' : v === 'r' ? 'mine' : 'theirs';
    if (v === 'a') return 'keep';
    if (v === 'r') return 'revert';
    return inp.pending === 'a' ? 'revert' : 'keep';
  };
  const writesSomething = (a: Act) => a !== 'keep' && a !== 'none';

  // ---- 1. 核对 & 可行性 ----
  const unwritten = new Map<number, Reason>();
  const bad = (cid: number, r: Reason) => { if (!unwritten.has(cid)) unwritten.set(cid, r); };
  const body = (b: number) => (b >= plan.bodyStart && b < plan.bodyStart + plan.bodyCount ? b - plan.bodyStart : -1);
  const okBlock = new Map<number, Reason | null>();
  const checkBlock = (b: number): Reason | null => {
    if (okBlock.has(b)) return okBlock.get(b)!;
    const k = body(b);
    let r: Reason | null = null;
    const info = plan.bInfo[b];
    if (k < 0 || !info || info.sec !== 'body') r = 'section';
    else if (plan.bodyCount !== blocks.length) r = 'mismatch';
    else {
      const loc = blocks[k];
      if (!loc || loc.cells.length !== info.cells.length || loc.cells.some((c, i) => c.text !== info.cells[i])) r = 'mismatch';
    }
    okBlock.set(b, r);
    return r;
  };
  const cellOf = (b: number, c: number) => blocks[body(b)]?.cells[c];
  /** 整块删除的 A 块放在哪：返回模板行（表格行）和插入方式；放不下返回 null */
  const placeBlock = (op: Extract<Op, { t: 'delBlock' }>): { mode: 'after' | 'before' | 'append'; ref: Element | null; tpl?: Element } | null => {
    const ak = op.after >= 0 ? body(op.after) : -1, bk = op.before >= 0 ? body(op.before) : -1;
    const A = ak >= 0 ? blocks[ak] : null, B = bk >= 0 ? blocks[bk] : null;
    if (op.blk.kind === 'tr') {
      // 只能放进表格：紧跟前一行，或放在后一行之前；列数要一样
      if (A && A.kind === 'tr' && A.cells.length === op.blk.cells.length) return { mode: 'after', ref: A.el, tpl: A.el };
      if (B && B.kind === 'tr' && B.cells.length === op.blk.cells.length) return { mode: 'before', ref: B.el, tpl: B.el };
      return null;
    }
    if (A) {
      if (A.kind === 'p') return { mode: 'after', ref: A.el };
      if (B && B.kind === 'tr' && B.el.parentNode === A.el.parentNode) return null; // 夹在同一张表的两行之间
      return { mode: 'after', ref: A.el.parentNode as Element };
    }
    if (B) return { mode: 'before', ref: B.kind === 'p' ? B.el : (B.el.parentNode as Element) };
    if (plan.bodyCount === 0 || !blocks.length) return { mode: 'append', ref: null };
    return null;
  };
  for (const op of plan.ops) {
    const cid = op.cid;
    if (op.t === 'skip') { bad(cid, op.why); continue; }
    if (op.t === 'ins' || op.t === 'mark') {
      const r = checkBlock(op.b); if (r) { bad(cid, r); continue; }
      const cell = cellOf(op.b, op.c);
      if (!cell || op.e > cell.text.length) { bad(cid, 'range'); continue; }
      const hit = cell.atoms.filter((a) => a.e > op.s && a.s < op.e);
      const b2 = hit.find((a) => a.bad);
      if (b2 && op.t === 'ins') bad(cid, b2.bad === 'textbox' ? 'textbox' : b2.bad === 'field' ? 'field' : 'range');
    } else if (op.t === 'del') {
      const r = checkBlock(op.at.b); if (r) { bad(cid, r); continue; }
      const cell = cellOf(op.at.b, op.at.c);
      if (!cell) { bad(cid, 'cell'); continue; }
      if (op.at.o > cell.text.length) { bad(cid, 'range'); continue; }
      const inside = cell.atoms.find((a) => a.s < op.at.o && a.e > op.at.o && a.bad);
      if (inside) bad(cid, inside.bad === 'textbox' ? 'textbox' : 'field');
      if (op.img && writesSomething(act(cid))) bad(cid, 'image');
    } else if (op.t === 'insBlock' || op.t === 'markBlock') {
      const r = checkBlock(op.b); if (r) bad(cid, r);
    } else if (op.t === 'delBlock') {
      if ((op as any).sec && (op as any).sec !== 'body') { bad(cid, 'section'); continue; }
      for (const x of [op.after, op.before]) if (x >= 0) { const r = checkBlock(x); if (r === 'section' && body(x) < 0) { /* 落点在页眉页脚：看另一侧 */ } else if (r) { bad(cid, r); } }
      const aOk = op.after >= 0 && body(op.after) >= 0, bOk = op.before >= 0 && body(op.before) >= 0;
      if (!aOk && !bOk && plan.bodyCount > 0) bad(cid, 'section');
      if (op.blk.cells.some((c) => c.some((x) => x.t === '[图片]')) && writesSomething(act(cid))) bad(cid, 'image');
      if (!placeBlock(op)) bad(cid, op.blk.kind === 'tr' ? 'cell' : 'place');
    }
  }
  // 同一落点连着放的几块：表格行只能进表格、段落只能放在表格外，要和 A 里的先后一致，否则这一块不写
  {
    const groups = new Map<string, Extract<Op, { t: 'delBlock' }>[]>();
    for (const op of plan.ops) if (op.t === 'delBlock' && !unwritten.has(op.cid)) { const k = `${op.after}:${op.before}`; (groups.get(k) || groups.set(k, []).get(k)!).push(op); }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const modes = g.map((op) => placeBlock(op)?.mode);
      let seenP = false, seenTr = false;
      g.forEach((op, i) => {
        if (op.blk.kind === 'tr') { if (modes[i] === 'after' && seenP) bad(op.cid, 'place'); seenTr = true; }
        else { if (modes[i] === 'before' && seenTr && g.some((x, j) => j < i && x.blk.kind === 'tr' && modes[j] === 'before')) bad(op.cid, 'place'); seenP = true; }
      });
    }
  }
  const live = (op: Op) => !unwritten.has(op.cid);

  // ---- 2. 切分 run，让每个范围的边界都落在 run 边界上 ----
  let maxId = 0;
  const scan = (n: Node) => { for (let c = n.firstChild; c; c = c.nextSibling) if (isEl(c)) { const v = parseInt(wattr(c, 'id') || '', 10); if (v > maxId) maxId = v; scan(c); } };
  scan(doc.documentElement);
  const w = new Writer(doc, Math.max(maxId + 1, 1));
  const cuts = new Map<string, Set<number>>();
  const addCut = (b: number, c: number, o: number) => { const k = `${b}:${c}`; (cuts.get(k) || cuts.set(k, new Set()).get(k)!).add(o); };
  for (const op of plan.ops) {
    if (!live(op)) continue;
    if (op.t === 'ins' || op.t === 'mark') { addCut(op.b, op.c, op.s); addCut(op.b, op.c, op.e); }
    else if (op.t === 'del') addCut(op.at.b, op.at.c, op.at.o);
  }
  if (cuts.size) {
    // 一次走完：把涉及的 run 拆成“每个 run 一个内容元素”，再在切点处把文字 run 一分为二
    for (const [k, set] of cuts) {
      const [b, c] = k.split(':').map(Number);
      const cell = cellOf(b, c)!;
      const runs = new Set<Element>();
      for (const a of cell.atoms) if (a.run && !a.bad) runs.add(a.run);
      runs.forEach((r) => explodeRun(w, r));
      const offs = [...set].sort((x, y) => y - x);
      for (const a of cell.atoms) {
        if (!a.run || a.bad || !a.node || a.node.localName !== 't') continue;
        const r = a.node.parentNode as Element;
        for (const o of offs) if (o > a.s && o < a.e) splitTextRun(w, r, a.node, o - a.s);
      }
    }
    const before = baseText.map((cs) => cs.join('\t')).join('\n');
    blocks = locate(doc);
    if (blocks.map(blockString).join('\n') !== before) throw new Error('split changed text');
  }

  // ---- 3. 套用 ----
  const wrapped = new Set<Element>();
  const anchors = new Map<number, Element[]>(); // cid -> 节点（文档顺序大致按写入顺序）
  const posAnchors = new Map<number, { ref: Element | null; para: Element; after?: boolean }>();
  const addAnchor = (cid: number, n: Element) => { const l = anchors.get(cid) || []; l.push(n); anchors.set(cid, l); };
  const removeLater: Element[] = [];
  const lastAt = new Map<string, Element>();
  const author = (a: Act) => (a === 'mine' ? inp.reviewer : inp.theirs);
  const date = (a: Act, cid: number) => (a === 'mine' ? decisions[cid]?.at || inp.now : inp.theirsDate);
  const runsIn = (cell: CellLoc, s: number, e: number) => {
    const out: Element[] = [];
    for (const a of cell.atoms) if (a.run && a.s >= s && a.e <= e && a.e > a.s && !out.includes(a.run)) out.push(a.run);
    return out;
  };
  const wrap = (r: Element, kind: 'ins' | 'del', a: Act, cid: number) => {
    const wr = w.rev(kind, author(a), date(a, cid));
    r.parentNode!.insertBefore(wr, r);
    wr.appendChild(r);
    wrapped.add(wr);
    if (kind === 'del') toDeleted(w, r);
    addAnchor(cid, wr);
  };
  const nearRun = (cell: CellLoc, o: number) => {
    const end = [...cell.atoms].reverse().find((a) => a.run && a.e === o && !a.bad);
    const start = cell.atoms.find((a) => a.run && a.s === o && !a.bad);
    return { end: end?.run || null, start: start?.run || null };
  };
  /** 在 B 的某个位置放入一组新节点 */
  const placeAt = (b: number, c: number, o: number, nodes: Element[]) => {
    const key = `${b}:${c}:${o}`;
    const cell = cellOf(b, c)!;
    const prev = lastAt.get(key);
    if (prev) { let ref: Element = prev; for (const n of nodes) { insertAfter(n, ref); ref = n; } lastAt.set(key, ref); return; }
    const { end, start } = nearRun(cell, o);
    if (end) { let ref: Element = outer(end, wrapped); for (const n of nodes) { insertAfter(n, ref); ref = n; } }
    else if (start) { const ref = outer(start, wrapped); for (const n of nodes) ref.parentNode!.insertBefore(n, ref); }
    else {
      // 空段落 / 位置在单元格开头：放进对应段落的末尾（pPr 之后）
      const atom = cell.atoms.find((a) => a.s >= o) || cell.atoms[cell.atoms.length - 1];
      const para = atom?.para || cell.paras[0];
      for (const n of nodes) para.appendChild(n);
    }
    lastAt.set(key, nodes[nodes.length - 1]);
  };
  const refRPr = (cell: CellLoc, o: number): Element | null => {
    const { end, start } = nearRun(cell, o);
    const r = end || start || cell.atoms.find((a) => a.run)?.run || null;
    return r ? kid(r, 'rPr') : null;
  };

  // 新段落的 pPr 模板
  const tplPPr = (blk: PlanBlock, nearK: number): Element | null => {
    const want = blk.kind === 'h' ? `h${blk.level ?? 1}` : blk.kind === 'li' ? `li${blk.level ?? 0}` : 'p';
    let best = -1;
    for (let d = 0; d < plan.bodyKinds.length && best < 0; d++) {
      for (const k of [nearK - d, nearK + d]) if (k >= 0 && k < plan.bodyKinds.length && plan.bodyKinds[k] === want && blocks[k]?.kind === 'p') { best = k; break; }
    }
    const src = best >= 0 ? kid(blocks[best].el, 'pPr') : null;
    if (!src) return null;
    const pPr = src.cloneNode(true) as Element;
    for (const x of ['sectPr', 'rPr', 'pPrChange']) for (const c of kids(pPr, x)) remove(c);
    if (blk.kind !== 'li') for (const c of kids(pPr, 'numPr')) remove(c);
    return kids(pPr).length ? pPr : null;
  };
  const newPara = (blk: PlanBlock, nearK: number, kind: 'ins' | 'del' | null, a: Act, cid: number): Element => {
    const p = w.el('p');
    const pPr = tplPPr(blk, nearK);
    if (pPr) p.appendChild(pPr);
    for (const x of blk.cells[0] || []) {
      const rPr = w.styleRPr(null, x.st, false);
      for (const r of w.runs(x.t, rPr, kind === 'del')) {
        if (kind) { const wr = w.rev(kind, author(a), date(a, cid)); wr.appendChild(r); p.appendChild(wr); wrapped.add(wr); addAnchor(cid, wr); }
        else { p.appendChild(r); addAnchor(cid, r); }
      }
    }
    if (kind) markPara(w, p, kind, author(a), date(a, cid));
    if (!kind && !anchors.get(cid)?.length) addAnchor(cid, p);
    return p;
  };
  const newRow = (blk: PlanBlock, tpl: Element, kind: 'ins' | 'del' | null, a: Act, cid: number): Element => {
    const tr = tpl.cloneNode(true) as Element;
    const trPr = kid(tr, 'trPr');
    if (trPr) for (const c of kids(trPr)) if (c.localName === 'ins' || c.localName === 'del' || c.localName === 'trPrChange') remove(c);
    kids(tr, 'tc').forEach((tc, i) => {
      const firstP = descendants(tc, 'p')[0];
      const pPr = firstP ? kid(firstP, 'pPr') : null;
      for (const c of kids(tc)) if (c.localName !== 'tcPr') remove(c);
      // 单元格里的换行 = 分段
      const lines: { t: string; st: RunStyle }[][] = [[]];
      for (const x of blk.cells[i] || []) {
        const segs = x.t.split('\n');
        segs.forEach((s, k) => { if (k > 0) lines.push([]); if (s) lines[lines.length - 1].push({ t: s, st: x.st }); });
      }
      for (const line of lines) {
        const p = w.el('p');
        if (pPr) { const c = pPr.cloneNode(true) as Element; for (const x of kids(c, 'rPr')) remove(x); p.appendChild(c); }
        for (const x of line) for (const r of w.runs(x.t, w.styleRPr(null, x.st, false), kind === 'del')) {
          if (kind) { const wr = w.rev(kind, author(a), date(a, cid)); wr.appendChild(r); p.appendChild(wr); wrapped.add(wr); addAnchor(cid, wr); }
          else { p.appendChild(r); addAnchor(cid, r); }
        }
        tc.appendChild(p);
      }
    });
    if (kind) markRow(w, tr, kind, author(a), date(a, cid));
    if (!anchors.get(cid)?.length) addAnchor(cid, descendants(tr, 'p')[0] || tr);
    return tr;
  };
  const blockLastInserted = new Map<Element, Record<string, Element>>();

  for (const op of plan.ops) {
    if (!live(op)) continue;
    const a = act(op.cid);
    if (op.t === 'ins') {
      const cell = cellOf(op.b, op.c)!;
      const rs = runsIn(cell, op.s, op.e);
      if (a === 'theirs') rs.forEach((r) => wrap(r, 'ins', a, op.cid));
      else if (a === 'mine') rs.forEach((r) => wrap(r, 'del', a, op.cid));
      else if (a === 'revert') rs.forEach((r) => removeLater.push(r));
      else rs.forEach((r) => addAnchor(op.cid, r));
    } else if (op.t === 'mark') {
      const cell = cellOf(op.b, op.c)!;
      runsIn(cell, op.s, op.e).forEach((r) => addAnchor(op.cid, outer(r, wrapped)));
    } else if (op.t === 'del') {
      const cell = cellOf(op.at.b, op.at.c)!;
      if (a === 'keep') {
        const { end, start } = nearRun(cell, op.at.o);
        posAnchors.set(op.cid, { ref: end || start, para: cell.paras[0], after: !!end });
        continue;
      }
      const kind = a === 'theirs' ? 'del' : a === 'mine' ? 'ins' : null;
      const rPr = w.styleRPr(refRPr(cell, op.at.o), op.st, true);
      const rs = w.runs(op.text, rPr, kind === 'del');
      const nodes: Element[] = rs.map((r) => {
        if (!kind) { addAnchor(op.cid, r); return r; }
        const wr = w.rev(kind, author(a), date(a, op.cid)); wr.appendChild(r); wrapped.add(wr); addAnchor(op.cid, wr); return wr;
      });
      if (nodes.length) placeAt(op.at.b, op.at.c, op.at.o, nodes);
    } else if (op.t === 'insBlock') {
      const loc = blocks[body(op.b)];
      const paras = loc.kind === 'p' ? [loc.el] : descendants(loc.el, 'p');
      if (a === 'theirs' || a === 'mine') {
        const kind = a === 'theirs' ? 'ins' : 'del';
        for (const p of paras) { for (const r of paraRuns(p)) wrap(r, kind, a, op.cid); }
        if (loc.kind === 'p') { if (!markPara(w, loc.el, kind, author(a), date(a, op.cid)) && kind === 'del') { /* 分节段落：只删字 */ } }
        else markRow(w, loc.el, kind, author(a), date(a, op.cid));
        if (!anchors.get(op.cid)?.length) addAnchor(op.cid, paras[0] || loc.el);
      } else if (a === 'revert') {
        if (loc.kind === 'p' && kid(kid(loc.el, 'pPr'), 'sectPr')) paraRuns(loc.el).forEach((r) => removeLater.push(r));
        else removeLater.push(loc.el);
      } else { const rs = paras.flatMap(paraRuns); if (rs.length) rs.forEach((r) => addAnchor(op.cid, r)); else addAnchor(op.cid, paras[0] || loc.el); }
    } else if (op.t === 'markBlock') {
      const loc = blocks[body(op.b)];
      const rs = (loc.kind === 'p' ? [loc.el] : descendants(loc.el, 'p')).flatMap(paraRuns);
      if (rs.length) rs.forEach((r) => addAnchor(op.cid, outer(r, wrapped)));
    } else if (op.t === 'delBlock') {
      const afterK = op.after >= 0 ? body(op.after) : -1, beforeK = op.before >= 0 ? body(op.before) : -1;
      const A = afterK >= 0 ? blocks[afterK] : null, B = beforeK >= 0 ? blocks[beforeK] : null;
      if (a === 'keep') {
        const ref = B ? (B.kind === 'p' ? B.el : descendants(B.el, 'p')[0]) : A ? (A.kind === 'p' ? A.el : descendants(A.el, 'p').slice(-1)[0]) : null;
        if (ref) posAnchors.set(op.cid, { ref: null, para: ref, after: !B });
        continue;
      }
      const kind = a === 'theirs' ? 'del' : a === 'mine' ? 'ins' : null;
      const pl = placeBlock(op)!;
      let node: Element;
      if (op.blk.kind === 'tr') node = newRow(op.blk, pl.tpl!, kind, a, op.cid);
      else node = newPara(op.blk, afterK >= 0 ? afterK : Math.max(beforeK, 0), kind, a, op.cid);
      // 同一落点连着放几块时保持原顺序；落点按“参照节点 + 方式”区分（表格行和段落的参照节点不同）
      const key = pl.ref || descendants(doc.documentElement, 'body')[0];
      const keyed = (blockLastInserted.get(key) || {}) as Record<string, Element>;
      const prev = keyed[pl.mode];
      if (prev) insertAfter(node, prev);
      else if (pl.mode === 'after') insertAfter(node, pl.ref!);
      else if (pl.mode === 'before') pl.ref!.parentNode!.insertBefore(node, pl.ref!);
      else {
        const bodyEl = descendants(doc.documentElement, 'body')[0];
        const sect = kid(bodyEl, 'sectPr');
        if (sect) bodyEl.insertBefore(node, sect); else bodyEl.appendChild(node);
      }
      keyed[pl.mode] = node; blockLastInserted.set(key, keyed as any);
    }
  }
  for (const n of removeLater) {
    const parent = n.parentNode as Element | null;
    remove(n);
    // 整张表的行都删光了：连表一起删
    if (parent && isW(parent, 'tbl') && !kids(parent, 'tr').length) remove(parent);
  }

  // ---- 4. 批注 ----
  let commentsXml: Document | null = null;
  const cmFile = zip.file('word/comments.xml');
  const wantComment = (cid: number) => {
    const d = decisions[cid];
    if (!d || unwritten.has(cid)) return '';
    const note = (d.note || '').trim();
    if (d.v === 'h') return note ? `待议：${note}` : '待议';
    return note;
  };
  const cids = [...new Set(plan.ops.map((o) => o.cid))];
  const toComment = mode === 'draft' ? cids.filter((c) => wantComment(c)) : [];
  if (toComment.length) {
    commentsXml = cmFile ? io.parse(await cmFile.async('string')) : io.parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${W}"/>`);
    let cmId = 0;
    for (const c of kids(commentsXml.documentElement, 'comment')) { const v = parseInt(wattr(c, 'id') || '', 10); if (v >= cmId) cmId = v + 1; }
    for (const e of descendants(doc.documentElement, 'commentRangeStart')) { const v = parseInt(wattr(e, 'id') || '', 10); if (v >= cmId) cmId = v + 1; }
    for (const cid of toComment) {
      const id = String(cmId++);
      const d = decisions[cid];
      const start = w.el('commentRangeStart', { id }), end = w.el('commentRangeEnd', { id });
      const ref = w.el('r', {}, w.el('commentReference', { id }));
      const nodes = anchors.get(cid) || [];
      const pa = posAnchors.get(cid);
      const isPara = (n: Element) => n.localName === 'p' || n.localName === 'tr';
      if (nodes.length && !isPara(nodes[0])) {
        nodes[0].parentNode!.insertBefore(start, nodes[0]);
        const last = nodes[nodes.length - 1];
        insertAfter(end, last); insertAfter(ref, end);
      } else {
        // 零宽：放在一个位置或一个段落里
        const para = nodes.length ? (nodes[0].localName === 'tr' ? descendants(nodes[0], 'p')[0] : nodes[0]) : pa?.para;
        if (!para) continue;
        if (pa?.ref) { const o = outer(pa.ref, wrapped); if (pa.after) { insertAfter(start, o); insertAfter(end, start); insertAfter(ref, end); } else { o.parentNode!.insertBefore(start, o); insertAfter(end, start); insertAfter(ref, end); } }
        else if (pa?.after || !nodes.length && pa) { para.appendChild(start); para.appendChild(end); para.appendChild(ref); }
        else { const pPr = kid(para, 'pPr'); if (pPr) { insertAfter(start, pPr); } else para.insertBefore(start, para.firstChild); insertAfter(end, start); insertAfter(ref, end); }
      }
      const cm = commentsXml.createElementNS(W, 'w:comment');
      cm.setAttributeNS(W, 'w:id', id);
      cm.setAttributeNS(W, 'w:author', d?.by || inp.reviewer);
      cm.setAttributeNS(W, 'w:date', iso(d?.at || inp.now));
      cm.setAttributeNS(W, 'w:initials', inp.reviewerInitials || (d?.by || inp.reviewer).slice(0, 2));
      for (const line of wantComment(cid).split('\n')) {
        const p = commentsXml.createElementNS(W, 'w:p');
        const r = commentsXml.createElementNS(W, 'w:r');
        const t = commentsXml.createElementNS(W, 'w:t');
        t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
        t.appendChild(commentsXml.createTextNode(line));
        r.appendChild(t); p.appendChild(r); cm.appendChild(p);
      }
      commentsXml.documentElement.appendChild(cm);
    }
  }
  // 定稿：去掉批注
  let dropComments = false;
  if (mode === 'final' && !inp.keepComments) {
    for (const x of ['commentRangeStart', 'commentRangeEnd']) descendants(doc.documentElement, x).forEach(remove);
    for (const x of descendants(doc.documentElement, 'commentReference')) {
      const r = x.parentNode as Element;
      if (isW(r, 'r') && kids(r).every((c) => c === x || c.localName === 'rPr')) remove(r); else remove(x);
    }
    dropComments = true;
  }
  const t2 = now();

  // ---- 5. 核对：按“接受全部修订”重新读，必须和预期一致 ----
  const expected = expectText(plan, baseText, act, unwritten);
  const got = locate(doc).map(blockString).filter((s) => s.length);
  const want = expected.filter((s) => s.length);
  if (got.length !== want.length || got.some((s, i) => s !== want[i])) {
    const i = got.findIndex((s, k) => s !== want[k]);
    throw Object.assign(new Error('verify failed'), { at: i, gotN: got.length, wantN: want.length });
  }
  const t3 = now();

  // ---- 6. 打包 ----
  zip.file('word/document.xml', io.serialize(doc));
  if (commentsXml) {
    zip.file('word/comments.xml', io.serialize(commentsXml));
    if (!cmFile) await addCommentsPart(zip, io);
  }
  if (dropComments) await dropCommentParts(zip, io);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 } });
  const t4 = now();
  const written = cids.filter((c) => !unwritten.has(c)).length;
  return {
    bytes, written, priorRevisions,
    unwritten: [...unwritten].map(([cid, reason]) => ({ cid, reason })),
    ms: { parse: Math.round(t1 - t0), apply: Math.round(t2 - t1), verify: Math.round(t3 - t2), zip: Math.round(t4 - t3) },
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 预期的“接受全部修订”后正文：按块给出（单元格用 \t 连接） */
function expectText(plan: Plan, base: string[][], act: (cid: number) => Act, unwritten: Map<number, Reason>): string[] {
  const reverts = (cid: number) => { const a = act(cid); return a === 'mine' || a === 'revert'; };
  const cells = base.map((b) => b.map((c) => c));
  type Ed = { o: number; rm?: number; add?: string; seq: number };
  const eds = new Map<string, Ed[]>();
  const removed = new Set<number>();
  const added = new Map<number, string[]>(); // after 下标（正文） -> 新块
  let seq = 0;
  const body = (b: number) => (b >= plan.bodyStart && b < plan.bodyStart + plan.bodyCount ? b - plan.bodyStart : -1);
  for (const op of plan.ops) {
    seq++;
    if (unwritten.has(op.cid) || !reverts(op.cid)) continue;
    if (op.t === 'ins') { const k = `${body(op.b)}:${op.c}`; (eds.get(k) || eds.set(k, []).get(k)!).push({ o: op.s, rm: op.e - op.s, seq }); }
    else if (op.t === 'del') { const k = `${body(op.at.b)}:${op.at.c}`; (eds.get(k) || eds.set(k, []).get(k)!).push({ o: op.at.o, add: op.text, seq }); }
    else if (op.t === 'insBlock') removed.add(body(op.b));
    else if (op.t === 'delBlock') {
      const k = op.after >= 0 && body(op.after) >= 0 ? body(op.after) : -1;
      const l = added.get(k) || [];
      l.push(op.blk.cells.map((c) => c.map((x) => x.t).join('')).join('\t'));
      added.set(k, l);
    }
  }
  for (const [k, list] of eds) {
    const [b, c] = k.split(':').map(Number);
    let s = cells[b][c];
    // 从后往前改；同一位置先删后插，多个插入保持原顺序
    list.sort((x, y) => y.o - x.o || (x.rm ? -1 : 0) - (y.rm ? -1 : 0) || y.seq - x.seq);
    for (const e of list) {
      if (e.rm) s = s.slice(0, e.o) + s.slice(e.o + e.rm);
      else s = s.slice(0, e.o) + e.add + s.slice(e.o);
    }
    cells[b][c] = s;
  }
  const out: string[] = [];
  for (const x of added.get(-1) || []) out.push(x);
  cells.forEach((b, i) => {
    if (!removed.has(i)) out.push(b.join('\t'));
    for (const x of added.get(i) || []) out.push(x);
  });
  return out;
}

async function addCommentsPart(zip: JSZip, io: XmlIO) {
  const relsPath = 'word/_rels/document.xml.rels';
  const rf = zip.file(relsPath);
  const rels = rf ? io.parse(await rf.async('string')) : io.parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${RELS_NS}"/>`);
  const root = rels.documentElement;
  const ids = new Set(Array.from(root.getElementsByTagName('Relationship')).map((r) => r.getAttribute('Id')));
  if (!Array.from(root.getElementsByTagName('Relationship')).some((r) => r.getAttribute('Type') === REL_COMMENTS)) {
    let n = 1; while (ids.has(`rId${n}`)) n++;
    const r = rels.createElementNS(RELS_NS, 'Relationship');
    r.setAttribute('Id', `rId${n}`); r.setAttribute('Type', REL_COMMENTS); r.setAttribute('Target', 'comments.xml');
    root.appendChild(r);
    zip.file(relsPath, io.serialize(rels));
  }
  const cf = zip.file('[Content_Types].xml')!;
  const ct = io.parse(await cf.async('string'));
  if (!Array.from(ct.documentElement.getElementsByTagName('Override')).some((o) => o.getAttribute('PartName') === '/word/comments.xml')) {
    const o = ct.createElementNS(CT_NS, 'Override');
    o.setAttribute('PartName', '/word/comments.xml'); o.setAttribute('ContentType', CT_COMMENTS);
    ct.documentElement.appendChild(o);
    zip.file('[Content_Types].xml', io.serialize(ct));
  }
}

async function dropCommentParts(zip: JSZip, io: XmlIO) {
  const relsPath = 'word/_rels/document.xml.rels';
  const rf = zip.file(relsPath);
  if (!rf) return;
  const rels = io.parse(await rf.async('string'));
  const gone: string[] = [];
  for (const r of Array.from(rels.documentElement.getElementsByTagName('Relationship'))) {
    const ty = r.getAttribute('Type') || '';
    if (/\/(comments|commentsExtended|commentsIds|commentsExtensible)$/.test(ty)) { gone.push('word/' + (r.getAttribute('Target') || '').replace(/^\/?word\//, '')); remove(r); }
  }
  if (!gone.length) return;
  zip.file(relsPath, io.serialize(rels));
  for (const g of gone) zip.remove(g);
  const cf = zip.file('[Content_Types].xml');
  if (cf) {
    const ct = io.parse(await cf.async('string'));
    for (const o of Array.from(ct.documentElement.getElementsByTagName('Override'))) if (gone.includes((o.getAttribute('PartName') || '').replace(/^\//, ''))) remove(o);
    zip.file('[Content_Types].xml', io.serialize(ct));
  }
}
