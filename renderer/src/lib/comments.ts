// 1.9.5：Word 里已有的批注 → 挂到比较结果上（方案「1.9.5 · 批注」H1–H7）。
// 只读，不参与差异匹配：先按位置找到批注所在的行，再看被批注的文字里有没有修订。
//   - 对方稿（修改后文档，side b）的批注：文字上有修订 → 挂到那几处修订；没有 → “没有修订的地方”。
//   - 我方稿（原始文档，side a）的批注：文字在修改后文档里原样还在 → 画在修改后文档的同样文字上；
//     文字被对方改了 → 挂到对应修订（“同事批过、被对方改了”，置顶）；整段被删 → 标“已删”。
import type { DocComment, DocModel } from './model';
import type { DiffResult, Row, Tok } from './engine';

export type CmSide = 'a' | 'b';
export type Owner = 'ours' | 'theirs';
/** 要画点线的一段：第 row 行、side 一侧、该侧第 k 个块（段落被拆分 / 合并时一行有几块）、第 c 个单元格、[s, e) */
export interface CmMark { row: number; side: CmSide; k: number; c: number; s: number; e: number }

export interface CmThread {
  /** 稳定的键：side + 批注编号（同一对文件里不变） */
  key: string;
  side: CmSide;
  root: DocComment;
  replies: DocComment[];
  owner: Owner;
  /** 对方稿里我方成员（不含审阅人自己）写的：生成审阅稿时会一起发给对方 */
  internal: boolean;
  resolved: boolean;
  /** 画批注标的位置（被批注的第一行） */
  row?: number;
  /** 挂在哪几处修订上 */
  cids: number[];
  /** 被批注的文字两边一样、没有修订 */
  plain: boolean;
  /** 我方稿的批注：文字被对方改过（或删了） */
  changedByThem: boolean;
  /** 我方稿的批注：整段 / 被批注的文字被对方删掉 */
  gone: boolean;
  /** 对方稿的批注：被批注的文字被修订删掉了（批注落在空位置上） */
  onDeleted: boolean;
  /** 在自己那一侧画点线的位置 */
  marks: CmMark[];
  /** 我方稿的批注、文字没变：在修改后文档（b）上画的位置 */
  bMarks: CmMark[];
  /** 修订审阅里：被批注的文字被修订换掉时，另一侧（换回来 / 被删掉）的那几个字也画点线 */
  alt: CmMark[];
  clause: string | null;
  /** 已经有我方回复（文档里有，或在 DocDiff 里写了） */
  replied: boolean;
}

export interface CmOpts {
  /** 我方成员（含审阅人）。比较时去掉空格、不分大小写 */
  ours: string[];
  reviewer: string;
  /** 卡片里手动改过的归属（只影响这一对文件） */
  overrides?: Record<string, Owner>;
  /** DocDiff 里写了回复的批注 */
  localReplies?: Record<string, unknown>;
  rowClause?: (string | null)[];
}

export const normName = (s: string) => s.replace(/\s+/g, '').toLowerCase();
/** 作者名是不是“没有署名”（空、或 Word 的默认名） */
export const anonymous = (s: string) => !s.trim() || /^(作者|author|unknown|未知)$/i.test(s.trim());

/** 一行里某一侧每个 token 的位置（第几块、第几格、起止字符） */
function sideOffsets(r: Row, side: CmSide) {
  const pos = new Map<string, number>();
  const out: ({ k: number; c: number; s: number; e: number } | null)[] = [];
  for (const m of r.merged) {
    const t = m[side] as Tok | undefined;
    if (!t) { out.push(null); continue; }
    const k = t.blk || 0, key = `${k}:${t.c}`;
    const s = pos.get(key) || 0;
    const e = s + (t.sep || t.psep ? 0 : t.t.length);
    pos.set(key, e);
    out.push({ k, c: t.c, s, e });
  }
  return out;
}

/** 修改后 / 原始文档的块 → 所在行（rows 里的 ai / bi 是 compareBlocks 的全局下标：页眉在前） */
function rowIndex(res: DiffResult, side: CmSide) {
  const m = new Map<number, { row: number; k: number }>();
  res.rows.forEach((r, row) => {
    const list = side === 'a' ? (r.ai !== undefined ? r.aList || [r.ai] : []) : (r.bi !== undefined ? r.bList || [r.bi] : []);
    list.forEach((bi, k) => { if (!m.has(bi)) m.set(bi, { row, k }); });
  });
  return m;
}

export function buildThreads(A: DocModel, B: DocModel, res: DiffResult, o: CmOpts): CmThread[] {
  const ours = new Set([...o.ours, o.reviewer].filter(Boolean).map(normName));
  const me = normName(o.reviewer || '');
  const isOurs = (name: string) => ours.has(normName(name));
  const out: CmThread[] = [];
  const offCache = new Map<string, ReturnType<typeof sideOffsets>>();
  const offs = (row: number, side: CmSide) => { const k = row + side; let v = offCache.get(k); if (!v) { v = sideOffsets(res.rows[row], side); offCache.set(k, v); } return v; };
  for (const side of ['a', 'b'] as CmSide[]) {
    const D = side === 'a' ? A : B;
    const list = D.comments || [];
    if (!list.length) continue;
    const hdr = D.secBlocks?.header.length || 0;
    const idx = rowIndex(res, side);
    const byId = new Map(list.map((c) => [c.id, c]));
    const rootOf = (c: DocComment) => { let x = c, g = 0; while (x.parent && byId.has(x.parent) && g++ < 20) x = byId.get(x.parent)!; return x; };
    const replies = new Map<string, DocComment[]>();
    for (const c of list) if (c.parent && byId.has(c.parent)) { const r = rootOf(c); (replies.get(r.id) || replies.set(r.id, []).get(r.id)!).push(c); }
    for (const root of list) {
      if (root.parent && byId.has(root.parent)) continue;
      const key = `${side}:${root.id}`;
      const owner: Owner = o.overrides?.[key] ?? (isOurs(root.author) ? 'ours' : 'theirs');
      const reps = (replies.get(root.id) || []).sort((x, y) => (x.date || '').localeCompare(y.date || ''));
      const th: CmThread = {
        key, side, root, replies: reps, owner,
        internal: side === 'b' && owner === 'ours' && normName(root.author) !== me,
        resolved: !!root.done, cids: [], plain: false, changedByThem: false, gone: false,
        onDeleted: side === 'b' && !!root.delText && !root.quote, marks: [], bMarks: [], alt: [], clause: null,
        replied: reps.some((x) => isOurs(x.author)) || !!o.localReplies?.[key],
      };
      const cids = new Set<number>();
      let eq = 0, changed = 0;
      if (root.from && root.to) {
        for (let b = root.from.b; b <= root.to.b; b++) {
          const hit = idx.get(b + hdr);
          if (!hit) continue;
          const r = res.rows[hit.row];
          if (th.row === undefined) th.row = hit.row;
          const so = offs(hit.row, side);
          const other: CmSide = side === 'a' ? 'b' : 'a';
          const oo = offs(hit.row, other);
          const local = new Set<number>();
          const zero = root.from.b === root.to.b && root.from.c === root.to.c && root.from.o === root.to.o;
          // 这一块里被批注的范围（按单元格）
          const inRange = (c: number, s: number, e: number) => {
            const fc = b === root.from!.b ? root.from!.c : 0, tc = b === root.to!.b ? root.to!.c : 1e9;
            if (c < fc || c > tc) return false;
            const lo = b === root.from!.b && c === fc ? root.from!.o : 0;
            const hi = b === root.to!.b && c === tc ? root.to!.o : 1e9;
            return zero ? s <= lo && e >= lo : e > lo && s < hi;
          };
          const clip = (c: number, s: number, e: number) => {
            const lo = b === root.from!.b && c === root.from!.c ? root.from!.o : 0;
            const hi = b === root.to!.b && c === root.to!.c ? root.to!.o : 1e9;
            return [Math.max(s, lo), Math.min(e, hi)] as const;
          };
          r.merged.forEach((m, mi) => {
            const p = so[mi];
            if (p) {
              if (p.k !== hit.k || !inRange(p.c, p.s, p.e)) return;
              if (p.e === p.s && !zero) return;
              const [s, e] = clip(p.c, p.s, p.e);
              if (e > s) addMark(th.marks, { row: hit.row, side, k: p.k, c: p.c, s, e });
              if (m.op === 0 && !m.fmt) {
                eq++;
                if (side === 'a' && oo[mi] && e > s) { const q = oo[mi]!; addMark(th.bMarks, { row: hit.row, side: 'b', k: q.k, c: q.c, s: q.s + (s - p.s), e: q.s + (e - p.s) }); }
              } else { changed++; if (m.cid !== undefined) { cids.add(m.cid); local.add(m.cid); } }
            } else if (zero && side === 'b') {
              // 批注落在被删掉的文字上：找同一位置上被删的 token（它们只在 a 侧）
              const prev = so.slice(0, mi).reverse().find((x) => x && x.k === hit.k);
              const at = prev ? prev.e : 0;
              if (at === root.from!.o && (prev ? prev.c : 0) === root.from!.c && m.op === -1 && m.cid !== undefined) { cids.add(m.cid); local.add(m.cid); changed++; }
            }
          });
          // 同一处修订在另一侧的字（拒绝后换回来的原文、被删掉的字）：修订审阅里也画点线
          if (local.size) r.merged.forEach((m, mi) => {
            if (m.cid === undefined || !local.has(m.cid) || m[side]) return;
            const q = oo[mi];
            if (q && q.e > q.s) addMark(th.alt, { row: hit.row, side: other, k: q.k, c: q.c, s: q.s, e: q.e });
          });
          if (r.blockCid !== undefined && zero && !cids.size) { /* 只有段落格式变化：不算挂在修订上 */ }
        }
      }
      th.cids = [...cids].sort((x, y) => x - y);
      th.plain = !th.cids.length;
      if (side === 'a') { th.changedByThem = changed > 0; th.gone = changed > 0 && eq === 0; }
      th.clause = th.row !== undefined ? o.rowClause?.[th.row] ?? null : null;
      out.push(th);
    }
  }
  // 按在文档里的位置排：行号，同一行先 b 后 a
  out.sort((x, y) => (x.row ?? 1e9) - (y.row ?? 1e9) || (x.side === y.side ? 0 : x.side === 'b' ? -1 : 1));
  return out;
}

function addMark(list: CmMark[], m: CmMark) {
  const last = list[list.length - 1];
  if (last && last.row === m.row && last.side === m.side && last.k === m.k && last.c === m.c && last.e === m.s) last.e = m.e;
  else list.push({ ...m });
}

/** 「批注 N」：还在讨论的——对方没解决的 + 我方的 */
export const live = (t: CmThread) => t.owner === 'ours' || !t.resolved;

export type CmGroup = 'changed' | 'theirs' | 'resolved' | 'ours' | 'plain';
/** 检查器里的分组（H2）：同事批过被改 → 对方批注 → 对方已解决（收起）→ 我方批注 → 没有修订的地方 */
export function groupOf(t: CmThread): CmGroup {
  if (t.side === 'a' && t.owner === 'ours' && t.changedByThem) return 'changed';
  if (t.owner === 'theirs' && t.resolved) return 'resolved';
  if (t.plain) return 'plain';
  return t.owner === 'theirs' ? 'theirs' : 'ours';
}
export const GROUP_ORDER: CmGroup[] = ['changed', 'theirs', 'resolved', 'ours', 'plain'];

/** 审阅到某处修订时最相关的一条（H3）：同事批过被改了 > 对方未回复 > 对方已回复 > 我方 */
export function bestFor(threads: CmThread[]): CmThread | null {
  const rank = (t: CmThread) => (groupOf(t) === 'changed' ? 0 : t.owner === 'theirs' && !t.resolved ? (t.replied ? 2 : 1) : t.owner === 'theirs' ? 4 : 3);
  return [...threads].sort((x, y) => rank(x) - rank(y))[0] || null;
}

/** 对方稿里我方成员（不含审阅人）写的批注和回复：生成审阅稿时会带出去（H5） */
export function internalComments(B: DocModel, threads: CmThread[], o: Pick<CmOpts, 'ours' | 'reviewer' | 'overrides'>): { id: string; author: string; text: string; clause: string | null; root: boolean }[] {
  const ours = new Set(o.ours.filter(Boolean).map(normName));
  const me = normName(o.reviewer || '');
  const out: { id: string; author: string; text: string; clause: string | null; root: boolean }[] = [];
  for (const t of threads) {
    if (t.side !== 'b') continue;
    if (t.internal) { out.push({ id: t.root.id, author: t.root.author, text: t.root.text, clause: t.clause, root: true }); continue; }
    for (const r of t.replies) if (ours.has(normName(r.author)) && normName(r.author) !== me && o.overrides?.[t.key] !== 'theirs') out.push({ id: r.id, author: r.author, text: r.text, clause: t.clause, root: false });
  }
  void B;
  return out;
}

/** 文件里读到的作者（设置里“从文件里读到的作者”，点名字直接加进名单） */
export function authorsOf(...docs: (DocModel | null | undefined)[]): string[] {
  const s = new Set<string>();
  for (const d of docs) for (const c of d?.comments || []) if (!anonymous(c.author)) s.add(c.author.trim());
  return [...s];
}

/** 一行里要画点线的 token 片段：键是 “side:合并序号”，值是 token 内的 [s, e) 和批注键 */
export type CmSlices = Map<string, { s: number; e: number; key: string }[]>;
export interface CmRowView { pins: { side: CmSide; threads: CmThread[] }[]; slices: CmSlices }

/**
 * 每一行要画什么：富文本两栏各画各的（我方稿的批注画在左栏）；修订审阅只有一张纸，
 * 我方稿的批注画在修改后文档的同样文字上，被删的字（删除线）上也画。
 */
export function cmView(res: DiffResult, threads: CmThread[], mode: 'rich' | 'redline'): Map<number, CmRowView> {
  const out = new Map<number, CmRowView>();
  const get = (row: number) => { let v = out.get(row); if (!v) { v = { pins: [], slices: new Map() }; out.set(row, v); } return v; };
  const marksByRow = new Map<number, (CmMark & { key: string })[]>();
  const addM = (m: CmMark, key: string) => { (marksByRow.get(m.row) || marksByRow.set(m.row, []).get(m.row)!).push({ ...m, key }); };
  for (const th of threads) {
    if (th.row === undefined) continue;
    const pinSide: CmSide = mode === 'rich' ? th.side : 'b';
    const v = get(th.row);
    let p = v.pins.find((x) => x.side === pinSide);
    if (!p) { p = { side: pinSide, threads: [] }; v.pins.push(p); }
    p.threads.push(th);
    if (mode === 'rich') th.marks.forEach((m) => addM(m, th.key));
    else { th.marks.forEach((m) => addM(m, th.key)); th.bMarks.forEach((m) => addM(m, th.key)); th.alt.forEach((m) => addM(m, th.key)); }
  }
  for (const [row, ms] of marksByRow) {
    const r = res.rows[row];
    if (!r) continue;
    const v = get(row);
    for (const side of ['a', 'b'] as CmSide[]) {
      const mine = ms.filter((m) => m.side === side);
      if (!mine.length) continue;
      const so = sideOffsets(r, side);
      so.forEach((p, mi) => {
        if (!p || p.e <= p.s) return;
        for (const m of mine) {
          if (m.k !== p.k || m.c !== p.c) continue;
          const s = Math.max(p.s, m.s), e = Math.min(p.e, m.e);
          if (e <= s) continue;
          const k = `${side}:${mi}`;
          (v.slices.get(k) || v.slices.set(k, []).get(k)!).push({ s: s - p.s, e: e - p.s, key: m.key });
        }
      });
    }
  }
  return out;
}
