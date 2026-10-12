import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType,
  InsertedTextRun, DeletedTextRun, CommentRangeStart, CommentRangeEnd, CommentReference, Header, Footer,
} from 'docx';
import type { Block, Run, Sec } from './model';
import type { Change, Row } from './engine';
import type { DecMap, Verdict } from './review';
import { initialsOf } from './review';
import type { Risk } from './insight';
import { riskTag } from './describe';
import { fmtText } from './describe';
import { t } from './i18n';

export type Decision = 'a' | 'r' | undefined;
export interface Piece {
  t: string; st: Run; mark?: 'del' | 'ins' | 'mdel' | 'mins'; cell: number; cid?: number; fmt?: string; sep?: boolean; blk: number;
  /** 格式变化的原样式（导出成 Word 的“格式修订”时要用） */
  old?: Run;
  /** 内容因为决定而消失，只留一个锚点，用来挂批注 */
  anchor?: boolean;
}

/** 根据接受/拒绝状态计算某一行在修订稿中的显示内容；返回 null 表示整行不显示 */
export function redlinePieces(r: Row, dec: (cid?: number) => Decision, finalMode: boolean): { block: 'a' | 'b'; pieces: Piece[] } | null {
  const d = (cid?: number): Decision => { const x = dec(cid); return x ?? (finalMode ? 'a' : undefined); };
  const pieces: Piece[] = [];
  // 当前显示的是哪一侧的段落：用那一侧的段落编号给每个片段归段（删除的词跟随它前面的新段落）
  let side: 'a' | 'b' = 'b';
  let cur = 0;
  const track = (m: any) => { const t = m[side]; if (t) cur = t.blk || 0; };
  const push = (t: any, mark?: Piece['mark'], m?: any) => {
    if (!t || t.psep) return;
    if (!t.sep) pieces.push({ t: t.t, st: t.st, mark, cell: t.c, cid: m?.cid, fmt: m?.fmt, old: m?.fmt ? m.a?.st : undefined, blk: cur });
    else pieces.push({ t: '', st: {} as Run, cell: t.c, sep: true, blk: cur });
  };
  const anchor = (m: any) => { const tk = m.a || m.b; if (m.cid !== undefined && tk) pieces.push({ t: '', st: {} as Run, cell: tk.c, cid: m.cid, blk: cur, anchor: true }); };
  switch (r.kind) {
    case 'equal': side = 'b'; r.merged.forEach((m) => { track(m); push(m.b, undefined, m); }); return { block: 'b', pieces };
    case 'format': {
      const blockDec = d(r.blockCid);
      side = blockDec === 'r' ? 'a' : 'b';
      r.merged.forEach((m) => { track(m); const x = m.fmt ? d(m.cid) : undefined; push(x === 'r' ? { ...m.b, st: m.a!.st } : m.b, undefined, x === undefined ? m : { ...m, fmt: undefined }); });
      return { block: side, pieces };
    }
    case 'removed': case 'moved-from': {
      const x = d(r.cids[0]);
      if (x === 'a') return null;
      side = 'a';
      r.merged.forEach((m) => { track(m); push(m.a, x === 'r' ? undefined : r.kind === 'removed' ? 'del' : 'mdel', m); });
      return { block: 'a', pieces };
    }
    case 'added': case 'moved-to': {
      const x = d(r.cids[0]);
      if (x === 'r') return null;
      side = 'b';
      r.merged.forEach((m) => { track(m); push(m.b, x === 'a' ? undefined : r.kind === 'added' ? 'ins' : 'mins', m); });
      return { block: 'b', pieces };
    }
    case 'modified': {
      // 段落结构：若全部被拒绝则按原文分段，否则按新文分段
      const allRejected = r.cids.length > 0 && r.cids.every((c) => d(c) === 'r');
      side = allRejected ? 'a' : 'b';
      for (const m of r.merged) {
        track(m);
        const x = d(m.cid);
        if (m.op === 0) push(m.fmt && x === 'r' ? { ...m.b, st: m.a!.st } : m.b, undefined, m.fmt && x === undefined ? m : m.fmt ? { ...m, fmt: undefined } : m);
        else if ((m as any).wsOnly) { if (m.op === 1) push(m.b); }
        else if (m.op === -1) { if (x !== 'a') push(m.a, x === 'r' ? undefined : 'del', m); else anchor(m); }
        else { if (x !== 'r') push(m.b, x === 'a' ? undefined : 'ins', m); else anchor(m); }
      }
      return { block: side, pieces };
    }
  }
  return null;
}

// =====================================================================
// Word 导出：真修订（w:ins / w:del / w:rPrChange，作者 = 修改方）+ 审阅批注（作者 = 审阅人）
// =====================================================================
export interface ExportOpts {
  mode: 'redline' | 'final';
  /** 修订的作者：改文字的人（对方） */
  author: string;
  /** 修订时间：对方文件的修改时间 */
  authorDate: Date;
  reviewer: { name: string; initials: string };
  decisions: DecMap;
  commentAccepted: boolean;
  risks: Map<number, Risk>;
  changes: Change[];
  title: string;
}

const VERDICT_LABEL: Record<Verdict, string> = { a: '接受', r: '拒绝', h: '待议' };

type Child = any; // docx 的段落子元素（TextRun / InsertedTextRun / CommentRangeStart …）
interface ParaSpec { children: Child[]; heading?: any; alignment?: any; indent?: any; run?: any }

export async function buildDocx(rows: Row[], blocksA: Block[], blocksB: Block[], o: ExportOpts): Promise<Uint8Array> {
  let revId = 1;
  const date = o.authorDate.toISOString();
  const rev = () => ({ id: revId++, author: o.author, date });
  const verdictOf = (cid?: number) => (cid === undefined ? undefined : o.decisions[cid]?.v);
  // 导出时：接受 → 写成新文字；拒绝 → 恢复原文；待议 / 未处理 → 保持为修订
  const dec = (cid?: number): Decision => { const v = verdictOf(cid); return v === 'a' || v === 'r' ? v : undefined; };
  const effDec = o.mode === 'final' ? dec : (cid?: number): Decision => (cid === undefined ? undefined : undefined);

  // ---- 批注 ----
  const changeById = new Map(o.changes.map((c) => [c.id, c]));
  const comments: { id: number; author: string; initials: string; date: Date; children: Paragraph[] }[] = [];
  const commentOf = new Map<number, number>(); // cid → 批注编号
  const needsComment = (cid: number) => {
    const d = o.decisions[cid];
    if (!d) return false;
    if (d.v === 'a' && !o.commentAccepted && !d.note) return false;
    return !!(d.v || d.note);
  };
  const ensureComment = (cid: number, where?: string): number | undefined => {
    if (!needsComment(cid)) return undefined;
    if (commentOf.has(cid)) return commentOf.get(cid);
    const d = o.decisions[cid];
    const c = changeById.get(cid);
    const risk = o.risks.get(cid);
    const head: TextRun[] = [];
    if (risk) head.push(new TextRun({ text: `【${t('风险')}·${riskTag(risk)}】`, bold: true }));
    if (d.v) head.push(new TextRun({ text: `【${t(VERDICT_LABEL[d.v])}】`, bold: true }));
    if (where) head.push(new TextRun({ text: `（${where}）` }));
    if (d.note) head.push(new TextRun({ text: ` ${d.note}` }));
    const paras = [new Paragraph({ children: head })];
    if (c?.kind === 'fmt' && c.desc?.k === 'fmt') paras.push(new Paragraph({ children: [new TextRun({ text: t('格式：{f}', { f: fmtText(c.desc.sig) }), italics: true })] }));
    if (where && c) paras.push(new Paragraph({ children: [new TextRun({ text: c.kind === 'mod' ? `“${c.before}” → “${c.after}”` : c.kind === 'ins' ? `${t('新增')}：${c.after}` : c.kind === 'del' ? `${t('删除')}：${c.before}` : c.before, italics: true })] }));
    const id = comments.length;
    const by = d.by || o.reviewer.name;
    comments.push({ id, author: by, initials: by === o.reviewer.name ? o.reviewer.initials : initialsOf(by), date: new Date(d.at || Date.now()), children: paras });
    commentOf.set(cid, id);
    return id;
  };

  // ---- 片段 → docx 的 run ----
  const fmtProps = (st: Run) => ({
    bold: st.b, italics: st.i, underline: st.u ? {} : undefined, strike: st.s,
    size: st.sz ? Math.round(st.sz * 2) : undefined, color: st.color?.replace('#', ''),
    font: st.font ? { eastAsia: st.font, ascii: st.font, hAnsi: st.font } : undefined,
  });
  const textChildren = (text: string) => text.split('\n').flatMap((x, i) => (i ? [new TextRun({ break: 1 }), x] : [x]));
  const runOf = (p: Piece): Child[] => {
    const st = p.st || ({} as Run);
    if (p.mark === 'del' || p.mark === 'mdel') {
      return p.t.split('\n').map((x) => new DeletedTextRun({ text: x, ...fmtProps(st), ...rev() } as any));
    }
    if (p.mark === 'ins' || p.mark === 'mins') {
      return p.t.split('\n').map((x, i) => new InsertedTextRun({ text: x, ...fmtProps(st), break: i ? 1 : undefined, ...rev() } as any));
    }
    if (p.fmt && p.old) {
      // 格式修订：新格式 + 记录原格式，在 Word 里可以接受 / 拒绝
      return [new TextRun({ children: textChildren(p.t) as any, ...fmtProps(st), revision: { ...fmtProps(p.old), ...rev() } } as any)];
    }
    return [new TextRun({ children: textChildren(p.t) as any, ...fmtProps(st) })];
  };

  // ---- 逐行生成段落；批注的起止位置先记下来，最后统一插入 ----
  const body: (ParaSpec | { table: ParaSpec[][][] })[] = [];
  const header: ParaSpec[] = [], footer: ParaSpec[] = [], notes: ParaSpec[] = [];
  const firstPos = new Map<number, { arr: Child[]; idx: number }>();
  const lastPos = new Map<number, { arr: Child[]; idx: number }>();
  let pendingAnchors: number[] = [];
  const outOfBody: { cid: number; sec: Sec }[] = [];
  let table: ParaSpec[][][] | null = null;
  const flushTable = (dest: typeof body) => { if (table) { dest.push({ table }); table = null; } };

  const emitPieces = (arr: Child[], pieces: Piece[], sec: Sec) => {
    for (const p of pieces) {
      if (p.sep) continue;
      if (p.cid !== undefined && sec !== 'header' && sec !== 'footer' && needsComment(p.cid)) {
        if (!firstPos.has(p.cid)) firstPos.set(p.cid, { arr, idx: arr.length });
      }
      if (!p.anchor && p.t) arr.push(...runOf(p));
      if (p.cid !== undefined && firstPos.has(p.cid) && sec !== 'header' && sec !== 'footer') lastPos.set(p.cid, { arr, idx: arr.length });
    }
  };

  for (const r of rows) {
    const sec: Sec = r.sec || 'body';
    const rp = redlinePieces(r, effDec, false);
    if (sec === 'header' || sec === 'footer') for (const c of r.cids) if (needsComment(c) && !outOfBody.some((x) => x.cid === c)) outOfBody.push({ cid: c, sec });
    if (!rp) {
      if (sec !== 'header' && sec !== 'footer') for (const c of r.cids) if (needsComment(c)) pendingAnchors.push(c);
      continue;
    }
    const dest = sec === 'header' ? header : sec === 'footer' ? footer : sec === 'footnote' ? notes : null;
    const list = rp.block === 'a' ? (r.aList || [r.ai!]) : (r.bList || [r.bi!]);
    const whole = r.kind === 'added' || r.kind === 'moved-to' || r.kind === 'removed' || r.kind === 'moved-from';
    const pend = whole && r.cids.length && effDec(r.cids[0]) === undefined;
    for (let k = 0; k < list.length; k++) {
      const blk = rp.block === 'a' ? blocksA[list[k]] : blocksB[list[k]];
      if (!blk) continue;
      const pieces = rp.pieces.filter((p) => p.blk === k);
      if (blk.kind === 'tr' && !dest) {
        const n = Math.max(1, blk.cells?.length || 1);
        const cells: ParaSpec[][] = Array.from({ length: n }, () => [{ children: [] }]);
        if (pendingAnchors.length) { cells[0][0].children.push(...pendingAnchors.map((c) => ({ __anchor: c }))); pendingAnchors = []; }
        for (let ci = 0; ci < n; ci++) emitPieces(cells[ci][0].children, pieces.filter((p) => Math.min(n - 1, p.cell) === ci), sec);
        (table ||= []).push(cells);
        continue;
      }
      if (!dest) flushTable(body);
      const spec: ParaSpec = { children: [] };
      if (pendingAnchors.length && !dest) { spec.children.push(...pendingAnchors.map((c) => ({ __anchor: c }))); pendingAnchors = []; }
      if (blk.kind === 'li') spec.children.push(new TextRun({ text: `${blk.marker || '•'}\t` }));
      if (blk.kind === 'tr') {
        // 页眉页脚里的表格：按制表符拼成一段
        const n = Math.max(1, blk.cells?.length || 1);
        for (let ci = 0; ci < n; ci++) { if (ci) spec.children.push(new TextRun({ text: '\t' })); emitPieces(spec.children, pieces.filter((p) => Math.min(n - 1, p.cell) === ci), sec); }
      } else emitPieces(spec.children, pieces, sec);
      spec.heading = blk.kind === 'h' ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.min(6, blk.level || 1) - 1] : undefined;
      spec.alignment = blk.align === 'center' ? AlignmentType.CENTER : blk.align === 'right' ? AlignmentType.RIGHT : blk.align === 'justify' ? AlignmentType.JUSTIFIED : undefined;
      if (blk.kind === 'li') spec.indent = { left: 360 * ((blk.level || 0) + 1), hanging: 360 };
      // 整段新增 / 删除：段落标记本身也记成修订，在 Word 里拒绝后不会留下空段
      if (pend) spec.run = r.kind === 'added' || r.kind === 'moved-to' ? { insertion: rev() } : { deletion: rev() };
      (dest || body).push(spec);
    }
  }
  flushTable(body);

  // 页眉 / 页脚里的变更：Word 不允许在页眉页脚里挂批注，挂到正文开头并写明位置
  const bodyFirst = (): ParaSpec => {
    let f = body.find((b) => !('table' in b)) as ParaSpec | undefined;
    if (!f) { f = { children: [] }; body.unshift(f); }
    return f;
  };
  for (const { cid, sec } of outOfBody) {
    const id = ensureComment(cid, t(sec === 'header' ? '页眉' : '页脚'));
    if (id !== undefined) bodyFirst().children.unshift(new CommentRangeStart(id), new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] }));
  }
  // 脚注：列在文末（DocDiff 不知道正文里每条脚注的引用位置）
  if (notes.length) {
    body.push({ children: [new TextRun({ text: t('脚注'), bold: true })], heading: HeadingLevel.HEADING_3 });
    body.push(...notes);
  }
  // 文末仍未落地的锚点（最后几行被整段删掉）
  if (pendingAnchors.length) { body.push({ children: pendingAnchors.map((c) => ({ __anchor: c })) }); pendingAnchors = []; }

  // ---- 插入批注的起止标记（从后往前插，下标不会错位）----
  const inserts: { arr: Child[]; idx: number; start: boolean; items: Child[] }[] = [];
  for (const [cid, pos] of firstPos) {
    const id = ensureComment(cid);
    if (id === undefined) continue;
    const end = lastPos.get(cid) || pos;
    const endItems = [new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })];
    if (end.arr === pos.arr && end.idx === pos.idx) { inserts.push({ arr: pos.arr, idx: pos.idx, start: true, items: [new CommentRangeStart(id), ...endItems] }); continue; }
    inserts.push({ arr: pos.arr, idx: pos.idx, start: true, items: [new CommentRangeStart(id)] });
    inserts.push({ arr: end.arr, idx: end.idx, start: false, items: endItems });
  }
  // 每个数组里从后往前插，下标不会错位。同一位置上“上一条的结束”必须排在“下一条的开始”前面：
  // splice 后插入的会落在先插入的前面，所以同一位置先处理“开始”、再处理“结束”。
  const byArr = new Map<Child[], typeof inserts>();
  for (const it of inserts) (byArr.get(it.arr) || byArr.set(it.arr, []).get(it.arr)!).push(it);
  for (const [arr, list] of byArr) {
    list.sort((x, y) => y.idx - x.idx || (x.start === y.start ? 0 : x.start ? -1 : 1));
    for (const it of list) arr.splice(it.idx, 0, ...it.items);
  }
  // 被决定“删掉”的内容留下的零宽锚点
  const resolveAnchors = (arr: Child[]) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (a && typeof a === 'object' && '__anchor' in a) {
        const id = ensureComment(a.__anchor);
        arr.splice(i, 1, ...(id === undefined ? [] : [new CommentRangeStart(id), new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })]));
      }
    }
  };

  const mkPara = (s: ParaSpec) => { resolveAnchors(s.children); return new Paragraph({ children: s.children, heading: s.heading, alignment: s.alignment, indent: s.indent, run: s.run } as any); };
  const children: (Paragraph | Table)[] = body.map((b) => ('table' in b
    ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: b.table.map((cells) => new TableRow({ children: cells.map((paras) => new TableCell({ children: paras.map(mkPara) })) })) })
    : mkPara(b)));

  const doc = new Document({
    creator: 'DocDiff',
    lastModifiedBy: o.reviewer.name,
    title: o.title,
    comments: { children: comments },
    features: o.mode === 'redline' ? { trackRevisions: true } : undefined,
    sections: [{
      headers: header.length ? { default: new Header({ children: header.map(mkPara) }) } : undefined,
      footers: footer.length ? { default: new Footer({ children: footer.map(mkPara) }) } : undefined,
      children,
    }],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
