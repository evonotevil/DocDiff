// 审阅稿（1.8）：把一次比较的结果换算成“在对方文件上要做的编辑”。
// 坐标一律落在修改后文档（B）上：第几块、第几个单元格、块内第几个字符。
// 计划只依赖比较结果，和决定无关；决定变了只需要重新套用，不用重算计划。
import type { DiffResult, Row, Tok } from '../engine';
import type { Block, Run, Sec } from '../model';

/** 一段文字的样式（够用来写 Word 的 rPr） */
export type RunStyle = Pick<Run, 'b' | 'i' | 'u' | 's' | 'sz' | 'color' | 'font'>;

export interface Pos { b: number; c: number; o: number }

export type Op =
  /** B 里多出来的一段字：[s, e) */
  | { t: 'ins'; cid: number; b: number; c: number; s: number; e: number }
  /** A 里有、B 里没有的一段字，放在 B 的 at 处 */
  | { t: 'del'; cid: number; at: Pos; text: string; st: RunStyle; img?: boolean }
  /** B 里整块新增（段落或表格行） */
  | { t: 'insBlock'; cid: number; b: number }
  /** A 里整块被删；放在 B 的 after 之后（-1 = 最前），before 是 B 里紧随其后的块（-1 = 没有） */
  | { t: 'delBlock'; cid: number; after: number; before: number; blk: PlanBlock }
  /** 只改了格式的一段字（审阅稿里只用来挂批注） */
  | { t: 'mark'; cid: number; b: number; c: number; s: number; e: number }
  /** 整块的格式变化（标题级别、对齐、拆分合并） */
  | { t: 'markBlock'; cid: number; b: number }
  /** 写不进的变更（比如表格行被拆分合并、列数变了）：结论只留在 DocDiff 里 */
  | { t: 'skip'; cid: number; why: 'cell' };

/** 计划里带上的 A 块：只留写 Word 需要的东西 */
export interface PlanBlock { kind: Block['kind']; level?: number; cells: { t: string; st: RunStyle }[][] }

export interface Plan {
  ops: Op[];
  /** 计划里引用到的 B 块：区段、类型、各单元格的文字（用来核对对方文件是否对得上） */
  bInfo: Record<number, { sec: Sec; kind: string; cells: string[] }>;
  /** B 正文第一块在比较列表里的下标、正文块数 */
  bodyStart: number;
  bodyCount: number;
  /** 正文每块的类型（找模板段落用） */
  bodyKinds: string[];
}

const style = (r: Run | undefined): RunStyle => {
  if (!r) return {};
  const o: RunStyle = {};
  for (const k of ['b', 'i', 'u', 's', 'sz', 'color', 'font'] as const) if (r[k] !== undefined) (o as any)[k] = r[k];
  return o;
};
export const kindKey = (b: Block) => (b.kind === 'h' ? `h${b.level ?? 1}` : b.kind === 'li' ? `li${b.level ?? 0}` : b.kind);
const cellsOf = (b: Block): Run[][] => (b.kind === 'tr' ? b.cells || [] : [b.runs]);
const cellText = (rs: Run[]) => rs.map((r) => r.t).join('');

export function buildPlan(res: DiffResult, blocksA: Block[], blocksB: Block[]): Plan {
  const ops: Op[] = [];
  const bInfo: Plan['bInfo'] = {};
  const info = (bi: number) => {
    if (bInfo[bi]) return;
    const b = blocksB[bi];
    bInfo[bi] = { sec: b.sec || 'body', kind: kindKey(b), cells: cellsOf(b).map(cellText) };
  };
  const rows = res.rows;
  // 每行在 B 里的最后一块 / 第一块（找整块删除的落点用）
  const lastB = (r: Row) => (r.bList ? r.bList[r.bList.length - 1] : r.bi);
  const firstB = (r: Row) => (r.bList ? r.bList[0] : r.bi);

  rows.forEach((r, ri) => {
    if (r.kind === 'equal') return;
    if (r.kind === 'added' || r.kind === 'moved-to') {
      const cid = r.merged[0]?.cid;
      if (cid !== undefined) { info(r.bi!); ops.push({ t: 'insBlock', cid, b: r.bi! }); }
      return;
    }
    if (r.kind === 'removed' || r.kind === 'moved-from') {
      const cid = r.merged[0]?.cid;
      if (cid === undefined) return;
      let after = -1, before = -1;
      for (let k = ri - 1; k >= 0; k--) { const x = lastB(rows[k]); if (x !== undefined) { after = x; break; } }
      for (let k = ri + 1; k < rows.length; k++) { const x = firstB(rows[k]); if (x !== undefined) { before = x; break; } }
      if (after >= 0) info(after);
      if (before >= 0) info(before);
      const a = blocksA[r.ai!];
      const blk: PlanBlock = { kind: a.kind, level: a.level, cells: cellsOf(a).map((rs) => rs.filter((x) => x.t).map((x) => ({ t: x.t, st: style(x) }))) };
      // A 的区段跟着落点走：落点在正文以外时，写入阶段会判为“没写进”
      ops.push({ t: 'delBlock', cid, after, before, blk });
      if (after < 0 && before < 0) (ops[ops.length - 1] as any).sec = a.sec || 'body';
      return;
    }
    // 表格行参与了拆分合并、段落和表格行互相配对、列数变了、或者比较时单元格边界没对齐：单元格对不上，整行的变更都不写
    const aIdx = r.aList || (r.ai !== undefined ? [r.ai] : []), bIdx = r.bList || (r.bi !== undefined ? [r.bi] : []);
    const anyTr = [...aIdx.map((k) => blocksA[k]), ...bIdx.map((k) => blocksB[k])].some((b) => b?.kind === 'tr');
    if (anyTr && (aIdx.length !== 1 || bIdx.length !== 1 || blocksA[aIdx[0]].kind !== blocksB[bIdx[0]].kind || cellsOf(blocksA[aIdx[0]]).length !== cellsOf(blocksB[bIdx[0]]).length || r.merged.some((m) => m.op !== 0 && (m.a?.sep || m.b?.sep)))) {
      for (const cid of r.cids) ops.push({ t: 'skip', cid, why: 'cell' });
      return;
    }
    // modified / format：逐个 token 换算到 B 的坐标
    const bOf = (blk?: number) => (r.bList ? r.bList[blk || 0] : r.bi!);
    if (r.blockCid !== undefined) { info(r.bi!); ops.push({ t: 'markBlock', cid: r.blockCid, b: r.bi! }); }
    const cur = new Map<string, number>(); // `${b}:${c}` -> 已走过的字符数
    let last: Pos = { b: bOf(0), c: 0, o: 0 };
    const usedB = new Set<number>();
    let pendIns: { cid: number; b: number; c: number; s: number; e: number; mark: boolean } | null = null;
    let pendDel: { cid: number; at: Pos; text: string; st: RunStyle; img: boolean } | null = null;
    const flushIns = () => { if (pendIns) { ops.push({ t: pendIns.mark ? 'mark' : 'ins', cid: pendIns.cid, b: pendIns.b, c: pendIns.c, s: pendIns.s, e: pendIns.e }); pendIns = null; } };
    const flushDel = () => { if (pendDel) { if (pendDel.text) ops.push({ t: 'del', cid: pendDel.cid, at: pendDel.at, text: pendDel.text, st: pendDel.st, img: pendDel.img || undefined }); pendDel = null; } };
    for (const m of r.merged) {
      const ws = (m as any).wsOnly;
      if (m.b) {
        const tb: Tok = m.b;
        const b = bOf(tb.blk), c = tb.c;
        usedB.add(b);
        const key = `${b}:${c}`;
        const s = cur.get(key) || 0;
        const len = tb.psep ? 0 : tb.t.length;
        const e = s + len;
        cur.set(key, e);
        const isIns = m.op === 1 && !ws && m.cid !== undefined;
        const isMark = m.op === 0 && !!m.fmt && m.cid !== undefined;
        if ((isIns || isMark) && len) {
          flushDel();
          const mark = !isIns;
          if (pendIns && pendIns.cid === m.cid && pendIns.b === b && pendIns.c === c && pendIns.e === s && pendIns.mark === mark) pendIns.e = e;
          else { flushIns(); pendIns = { cid: m.cid!, b, c, s, e, mark }; }
        } else if (len) flushIns();
        last = { b, c, o: e };
      } else if (m.a && m.op === -1 && !ws && m.cid !== undefined) {
        const ta: Tok = m.a;
        if (ta.sep || ta.psep || !ta.t) continue;
        flushIns();
        // 删掉的字落在 B 里：同一单元格里最后走到的位置；A 的单元格比 B 多时，记成越界，写入时判“没写进”
        let at: Pos;
        if (ta.c !== last.c) at = { b: last.b, c: ta.c, o: cur.get(`${last.b}:${ta.c}`) || 0 };
        else at = last;
        const img = !!ta.st?.img;
        if (pendDel && pendDel.cid === m.cid && pendDel.at.b === at.b && pendDel.at.c === at.c && pendDel.at.o === at.o) { pendDel.text += ta.t; pendDel.img = pendDel.img || img; }
        else { flushDel(); pendDel = { cid: m.cid, at, text: ta.t, st: style(ta.st), img }; }
      }
    }
    flushIns(); flushDel();
    for (const b of usedB) info(b);
    if (!usedB.size && r.bi !== undefined) info(r.bi);
  });

  let bodyStart = blocksB.findIndex((b) => (b.sec || 'body') === 'body');
  if (bodyStart < 0) bodyStart = blocksB.findIndex((b) => b.sec === 'footnote' || b.sec === 'footer');
  if (bodyStart < 0) bodyStart = blocksB.length;
  let bodyCount = 0;
  while (bodyStart + bodyCount < blocksB.length && (blocksB[bodyStart + bodyCount].sec || 'body') === 'body') bodyCount++;
  const bodyKinds = blocksB.slice(bodyStart, bodyStart + bodyCount).map(kindKey);
  return { ops, bInfo, bodyStart, bodyCount, bodyKinds };
}

/** 计划里涉及的变更编号 */
export function planCids(p: Plan): Set<number> {
  return new Set(p.ops.map((o) => o.cid));
}
