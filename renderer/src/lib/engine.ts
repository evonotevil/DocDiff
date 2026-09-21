import { diffArrays } from 'diff';
import type { Block, Run } from './model';
import { sameStyle } from './docx';
import { t, isEn } from './i18n';

export interface DiffOptions {
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
  precision: 'word' | 'char';
  formatting: boolean;
  detectMoves: boolean;
  keepEmpty?: boolean;
  normPunct?: boolean; // 全角/半角标点视为相同
  mergeParas?: boolean; // 识别段落拆分/合并（一段 ↔ 多段）
}

export interface Tok { t: string; st: Run; c: number; key: string; ws: boolean; sep?: boolean; psep?: boolean; blk?: number }
export interface MTok { op: 0 | -1 | 1; a?: Tok; b?: Tok; cid?: number; fmt?: string; move?: boolean }
export type RowKind = 'equal' | 'modified' | 'removed' | 'added' | 'format' | 'moved-from' | 'moved-to';
export interface Row { kind: RowKind; ai?: number; bi?: number; aList?: number[]; bList?: number[]; merged: MTok[]; cids: number[]; moveRow?: number; blockNote?: string; blockTag?: string; blockCid?: number }
export type ChangeKind = 'del' | 'ins' | 'mod' | 'fmt' | 'move';
export interface Change { id: number; kind: ChangeKind; row: number; before: string; after: string; note?: string; row2?: number }
export interface DiffResult { rows: Row[]; changes: Change[]; stats: Record<ChangeKind, number> }

const CJK_CHAR = '[\\u2e80-\\u2fff\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uac00-\\ud7af\\u3000-\\u303f\\uff00-\\uffef]';
const WORD_RE = new RegExp(`${CJK_CHAR}|[\\p{L}\\p{N}_]+(?:['’][\\p{L}]+)*|\\s+|[^\\s]`, 'gu');

const PUNCT: Record<string, string> = {
  '，': ',', '。': '.', '、': ',', '：': ':', '；': ';', '！': '!', '？': '?', '（': '(', '）': ')',
  '【': '[', '】': ']', '《': '<', '》': '>', '“': '"', '”': '"', '‘': "'", '’': "'", '「': '"', '」': '"',
  '『': '"', '』': '"', '～': '~', '—': '-', '–': '-', '－': '-', '…': '...', '　': ' ',
};
function normKey(t: string, o: DiffOptions): string {
  let k = t;
  if (o.normPunct) k = PUNCT[k] ?? (k.length === 1 && k >= '\uff01' && k <= '\uff5e' ? String.fromCharCode(k.charCodeAt(0) - 0xfee0) : k);
  if (o.ignoreCase) k = k.toLowerCase();
  if (/^\s+$/.test(k)) k = o.ignoreWhitespace ? ' ' : k.replace(/ /g, ' ');
  return k;
}

export function tokenize(b: Block, o: DiffOptions): Tok[] {
  const out: Tok[] = [];
  const cells: Run[][] = b.kind === 'tr' ? b.cells || [] : [b.runs];
  cells.forEach((runs, ci) => {
    if (ci > 0) out.push({ t: '', st: {} as Run, c: ci, key: '\u0001cell', ws: false, sep: true });
    for (const r of runs) {
      if (r.img) { out.push({ t: r.t, st: r, c: ci, key: '\u0002img:' + r.img, ws: false }); continue; }
      const parts = o.precision === 'char' ? mergeWs([...r.t]) : r.t.match(WORD_RE) || [];
      for (const p of parts) {
        const ws = /^\s+$/.test(p);
        out.push({ t: p, st: r, c: ci, key: normKey(p, o), ws });
      }
    }
  });
  return out;
}
function mergeWs(chars: string[]): string[] {
  const out: string[] = [];
  for (const c of chars) {
    if (/\s/.test(c) && out.length && /^\s+$/.test(out[out.length - 1])) out[out.length - 1] += c;
    else out.push(c);
  }
  return out;
}

function blockKey(toks: Tok[], b: Block, o: DiffOptions): string {
  let s = toks.map((t) => (o.ignoreWhitespace && t.ws ? '' : t.key)).join('');
  if (o.ignoreWhitespace) s = s.trim();
  return (b.kind === 'tr' ? 'T|' : '') + s;
}

function isEmptyBlock(toks: Tok[]) { return !toks.some((t) => !t.ws && !t.sep); }

/** part 的词有多少比例出现在 whole 里（多重集合） */
function containment(part: Tok[], whole: Tok[]): number {
  const m = new Map<string, number>();
  for (const t of whole) if (!t.ws && !t.sep) m.set(t.key, (m.get(t.key) || 0) + 1);
  let n = 0, hit = 0;
  for (const t of part) if (!t.ws && !t.sep) { n++; const c = m.get(t.key) || 0; if (c > 0) { hit++; m.set(t.key, c - 1); } }
  return n ? hit / n : 0;
}

function similarity(a: Tok[], b: Tok[]): number {
  const m = new Map<string, number>();
  let na = 0, nb = 0, common = 0;
  for (const t of a) if (!t.ws && !t.sep) { m.set(t.key, (m.get(t.key) || 0) + 1); na++; }
  for (const t of b) if (!t.ws && !t.sep) { nb++; const c = m.get(t.key) || 0; if (c > 0) { common++; m.set(t.key, c - 1); } }
  if (!na && !nb) return 1;
  return (2 * common) / (na + nb);
}

const KIND_LABEL = (b: Block) => b.kind === 'h' ? t('标题 {n}', { n: b.level! }) : b.kind === 'li' ? t('列表项') : b.kind === 'tr' ? t('表格行') : t('正文');

export function describeStyle(a: Run, b: Run): string {
  const d: string[] = [];
  if (!!a.b !== !!b.b) d.push(t(b.b ? '加粗' : '取消加粗'));
  if (!!a.i !== !!b.i) d.push(t(b.i ? '倾斜' : '取消倾斜'));
  if (!!a.u !== !!b.u) d.push(t(b.u ? '下划线' : '取消下划线'));
  if (!!a.s !== !!b.s) d.push(t(b.s ? '删除线' : '取消删除线'));
  if ((a.sz || 0) !== (b.sz || 0)) d.push(t('字号 {a} → {b}', { a: a.sz ?? t('默认'), b: b.sz ?? t('默认') }));
  if ((a.color || '') !== (b.color || '')) d.push(t('颜色 {a} → {b}', { a: a.color || t('默认'), b: b.color || t('默认') }));
  if ((a.hl || '') !== (b.hl || '')) d.push(b.hl ? t('突出显示 {c}', { c: b.hl }) : t('取消突出显示'));
  if ((a.font || '') !== (b.font || '')) d.push(t('字体 {a} → {b}', { a: a.font || t('默认'), b: b.font || t('默认') }));
  return d.join(isEn() ? ', ' : '，');
}

function tokDiff(A: Tok[], B: Tok[], o: DiffOptions): MTok[] {
  const parts = diffArrays(A.map((t) => t.key), B.map((t) => t.key));
  const out: MTok[] = [];
  let ia = 0, ib = 0;
  for (const p of parts) {
    const n = p.count ?? p.value.length;
    if (p.added) for (let k = 0; k < n; k++) out.push({ op: 1, b: B[ib++] });
    else if (p.removed) for (let k = 0; k < n; k++) out.push({ op: -1, a: A[ia++] });
    else for (let k = 0; k < n; k++) out.push({ op: 0, a: A[ia++], b: B[ib++] });
  }
  semanticCleanup(out);
  // 段落分隔（拆分/合并段落时插入的虚拟空白）不算差异
  for (const m of out) if (m.op !== 0 && ((m.a && m.a.psep) || (m.b && m.b.psep))) (m as any).wsOnly = true;
  // 忽略空白：纯空白的增删不算差异
  if (o.ignoreWhitespace) {
    for (let i = 0; i < out.length; i++) {
      const m = out[i];
      if (m.op !== 0 && ((m.a && m.a.ws) || (m.b && m.b.ws))) (m as any).wsOnly = true;
    }
  }
  return out;
}

/** 语义清理：两处差异之间只隔很短的相同内容（如 1 个汉字）时，合并成一处"整体替换"，更易读 */
function semanticCleanup(ms: MTok[]) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 5) {
    changed = false;
    let i = 0;
    while (i < ms.length) {
      if (ms[i].op !== 0) { i++; continue; }
      let j = i;
      while (j < ms.length && ms[j].op === 0) j++;
      // [i, j) 是一段相等；两侧都是差异
      if (i > 0 && j < ms.length) {
        const eq = ms.slice(i, j);
        const eqLen = eq.reduce((n, m) => n + (m.a!.ws ? 0 : [...m.a!.t].length), 0);
        const hasWs = eq.some((m) => m.a!.ws);
        let l = i - 1, lenL = 0; while (l >= 0 && ms[l].op !== 0) { lenL += [...((ms[l].a || ms[l].b)!.t)].length; l--; }
        let r = j, lenR = 0; while (r < ms.length && ms[r].op !== 0) { lenR += [...((ms[r].a || ms[r].b)!.t)].length; r++; }
        if (!hasWs && eqLen > 0 && eqLen <= 2 && eqLen <= Math.max(lenL, lenR) && !eq.some((m) => m.a!.sep)) {
          const dels = eq.map((m) => ({ op: -1 as const, a: m.a }));
          const ins = eq.map((m) => ({ op: 1 as const, b: m.b }));
          // 放到右侧差异段的删除部分之前，保持 “删在前、增在后”
          const right = ms.slice(j, r);
          const rd = right.filter((m) => m.op === -1), ri = right.filter((m) => m.op === 1);
          const left = ms.slice(l + 1, i);
          const ld = left.filter((m) => m.op === -1), li = left.filter((m) => m.op === 1);
          ms.splice(l + 1, r - (l + 1), ...ld, ...dels, ...rd, ...li, ...ins, ...ri);
          changed = true;
          i = l + 1;
          continue;
        }
      }
      i = j;
    }
  }
}

function fmtEqual(m: MTok[], o: DiffOptions) {
  if (!o.formatting) return;
  for (const x of m) {
    if (x.op === 0 && x.a && x.b && !x.a.sep && !x.a.ws && !sameStyle(x.a.st, x.b.st)) {
      const d = describeStyle(x.a.st, x.b.st);
      if (d) x.fmt = d;
    }
  }
}

/** 把多个段落的 token 拼成一个序列，段落之间插入一个“虚拟空白”，并记录每个 token 属于第几段 */
export function joinToks(list: number[], toks: Tok[][]): Tok[] {
  if (list.length === 1) return toks[list[0]];
  const out: Tok[] = [];
  list.forEach((bi, k) => {
    if (k > 0) out.push({ t: '', st: {} as Run, c: 0, key: ' ', ws: true, psep: true, blk: k });
    for (const t of toks[bi]) out.push({ ...t, blk: k });
  });
  return out;
}

interface Group { a: number[]; b: number[] }

/**
 * 在一组连续的删除块与新增块之间做保序配对（序列比对 DP）。
 * 除了一段对一段，还允许“一段 ↔ 连续 2~4 段”（段落被拆分或合并，PDF 与 Word 互比时很常见）。
 */
function pairBlocks(R: number[], Aa: number[], tokA: Tok[][], tokB: Tok[][], merge: boolean): Group[] {
  const n = R.length, m = Aa.length;
  const res: Group[] = [];
  if (n * m > 40000) {
    for (let i = 0; i < Math.max(n, m); i++) {
      const a = R[i], b = Aa[i];
      if (a !== undefined && b !== undefined && similarity(tokA[a], tokB[b]) >= 0.3) res.push({ a: [a], b: [b] });
      else { if (a !== undefined) res.push({ a: [a], b: [] }); if (b !== undefined) res.push({ a: [], b: [b] }); }
    }
    return res;
  }
  const allowMerge = merge && n * m <= 12000;
  const K = 4;
  const S: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const C: (null | [number, number])[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  const simCache = new Map<string, number>();
  const sim = (i0: number, p: number, j0: number, q: number) => {
    const key = `${i0},${p},${j0},${q}`;
    let v = simCache.get(key);
    if (v === undefined) {
      const ta = p === 1 ? tokA[R[i0]] : joinToks(R.slice(i0, i0 + p), tokA);
      const tb = q === 1 ? tokB[Aa[j0]] : joinToks(Aa.slice(j0, j0 + q), tokB);
      v = similarity(ta, tb);
      simCache.set(key, v);
    }
    return v;
  };
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    if (i === 0 && j === 0) continue;
    let best = -1, choice: [number, number] | null = null;
    if (i > 0 && S[i - 1][j] > best) { best = S[i - 1][j]; choice = [1, 0]; }
    if (j > 0 && S[i][j - 1] > best) { best = S[i][j - 1]; choice = [0, 1]; }
    if (i > 0 && j > 0) {
      const s = sim(i - 1, 1, j - 1, 1);
      if (s >= 0.3 && S[i - 1][j - 1] + s > best) { best = S[i - 1][j - 1] + s; choice = [1, 1]; }
      if (allowMerge) {
        for (let k = 2; k <= K; k++) {
          if (j - k >= 0) { // 左 1 段 ↔ 右 k 段
            const s2 = sim(i - 1, 1, j - k, k);
            // 段落拆分：合起来高度相似，且每一小段都几乎完整地出现在另一侧那一段里
            const g = s2 * (1 + k) / 2;
            if (s2 >= 0.8 && S[i - 1][j - k] + g > best + 1e-9 && Aa.slice(j - k, j).every((b) => containment(tokB[b], tokA[R[i - 1]]) >= 0.8)) { best = S[i - 1][j - k] + g; choice = [1, k]; }
          }
          if (i - k >= 0) { // 左 k 段 ↔ 右 1 段
            const s2 = sim(i - k, k, j - 1, 1);
            const g = s2 * (1 + k) / 2;
            if (s2 >= 0.8 && S[i - k][j - 1] + g > best + 1e-9 && R.slice(i - k, i).every((a) => containment(tokA[a], tokB[Aa[j - 1]]) >= 0.8)) { best = S[i - k][j - 1] + g; choice = [k, 1]; }
          }
        }
      }
    }
    S[i][j] = best; C[i][j] = choice;
  }
  const out: Group[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const [p, q] = C[i][j]!;
    const a = R.slice(i - p, i), b = Aa.slice(j - q, j);
    out.push({ a, b });
    i -= p; j -= q;
  }
  out.reverse();
  // 未配对的单独块保持“先删后增”的顺序，便于阅读
  const merged: Group[] = [];
  for (const g of out) {
    if (g.a.length && g.b.length) { merged.push(g); continue; }
    merged.push(g);
  }
  return merged;
}

export function diffDocs(blocksA: Block[], blocksB: Block[], o: DiffOptions): DiffResult {
  const tokA = blocksA.map((b) => tokenize(b, o));
  const tokB = blocksB.map((b) => tokenize(b, o));
  const idxA = blocksA.map((_, i) => i).filter((i) => o.keepEmpty || !isEmptyBlock(tokA[i]));
  const idxB = blocksB.map((_, i) => i).filter((i) => o.keepEmpty || !isEmptyBlock(tokB[i]));
  const keyA = idxA.map((i) => blockKey(tokA[i], blocksA[i], o));
  const keyB = idxB.map((i) => blockKey(tokB[i], blocksB[i], o));
  const parts = diffArrays(keyA, keyB);

  const rows: Row[] = [];
  let pa = 0, pb = 0;
  let pendR: number[] = [], pendA: number[] = [];
  const flush = () => {
    if (!pendR.length && !pendA.length) return;
    for (const g of pairBlocks(pendR, pendA, tokA, tokB, !!o.mergeParas)) {
      if (g.a.length && g.b.length) {
        const merged = tokDiff(joinToks(g.a, tokA), joinToks(g.b, tokB), o);
        fmtEqual(merged, o);
        const row: Row = { kind: 'modified', ai: g.a[0], bi: g.b[0], merged, cids: [] };
        if (g.a.length > 1) row.aList = g.a;
        if (g.b.length > 1) row.bList = g.b;
        if ((g.a.length > 1 || g.b.length > 1) && o.formatting) { row.blockTag = t(g.a.length > 1 ? '段落合并' : '段落拆分'); row.blockNote = t(g.a.length > 1 ? '段落合并：{a} 段 → {b} 段' : '段落拆分：{a} 段 → {b} 段', { a: g.a.length, b: g.b.length }); }
        rows.push(row);
      } else if (g.a.length) rows.push({ kind: 'removed', ai: g.a[0], merged: tokA[g.a[0]].map((t) => ({ op: -1, a: t })), cids: [] });
      else if (g.b.length) rows.push({ kind: 'added', bi: g.b[0], merged: tokB[g.b[0]].map((t) => ({ op: 1, b: t })), cids: [] });
    }
    pendR = []; pendA = [];
  };
  for (const p of parts) {
    const n = p.count ?? p.value.length;
    if (p.removed) { for (let k = 0; k < n; k++) pendR.push(idxA[pa++]); }
    else if (p.added) { for (let k = 0; k < n; k++) pendA.push(idxB[pb++]); }
    else {
      flush();
      for (let k = 0; k < n; k++) {
        const a = idxA[pa++], b = idxB[pb++];
        let merged: MTok[];
        if (tokA[a].length === tokB[b].length && tokA[a].every((t, i) => t.key === tokB[b][i].key)) merged = tokA[a].map((t, i) => ({ op: 0, a: t, b: tokB[b][i] }));
        else merged = tokDiff(tokA[a], tokB[b], o).map((m) => (m.op !== 0 ? { ...m, op: 0 as const, wsOnly: true } as any : m));
        // 空白差异（ignoreWhitespace 下同 key）在 equal 中保持两边原样
        fmtEqual(merged, o);
        const row: Row = { kind: 'equal', ai: a, bi: b, merged, cids: [] };
        if (o.formatting) {
          const ba = blocksA[a], bb = blocksB[b];
          if (ba.kind !== bb.kind || (ba.kind === 'h' && ba.level !== bb.level)) { row.blockNote = t('段落样式：{a} → {b}', { a: KIND_LABEL(ba), b: KIND_LABEL(bb) }); row.blockTag = t('样式变化'); }
          else if ((ba.align || 'left') !== (bb.align || 'left') && ba.kind !== 'tr') { row.blockNote = t('对齐：{a} → {b}', { a: alignLabel(ba.align), b: alignLabel(bb.align) }); row.blockTag = t('样式变化'); }
        }
        if (row.blockNote || merged.some((m) => m.fmt)) row.kind = 'format';
        rows.push(row);
      }
    }
  }
  flush();

  // 移动检测
  if (o.detectMoves) {
    const addedByKey = new Map<string, number[]>();
    rows.forEach((r, i) => {
      if (r.kind === 'added') {
        const k = blockKey(tokB[r.bi!], blocksB[r.bi!], o);
        if (k.replace(/\s/g, '').length >= 6) { const l = addedByKey.get(k) || []; l.push(i); addedByKey.set(k, l); }
      }
    });
    rows.forEach((r, i) => {
      if (r.kind !== 'removed') return;
      const k = blockKey(tokA[r.ai!], blocksA[r.ai!], o);
      const l = addedByKey.get(k);
      if (l && l.length) {
        const j = l.shift()!;
        r.kind = 'moved-from'; r.moveRow = j;
        rows[j].kind = 'moved-to'; rows[j].moveRow = i;
        r.merged.forEach((m) => (m.move = true));
        rows[j].merged.forEach((m) => (m.move = true));
      }
    });
  }

  // 生成变更（change）编号
  const changes: Change[] = [];
  const stats: Record<ChangeKind, number> = { del: 0, ins: 0, mod: 0, fmt: 0, move: 0 };
  let nextId = 1;
  const add = (c: Omit<Change, 'id'>) => { const id = nextId++; changes.push({ ...c, id }); stats[c.kind]++; return id; };
  const txt = (ms: MTok[], side: 'a' | 'b') => ms.map((m) => (m[side] ? m[side]!.t || (m[side]!.sep ? ' | ' : '') : '')).join('');
  rows.forEach((r, ri) => {
    if (r.kind === 'equal') return;
    if (r.kind === 'moved-to') return; // 与 moved-from 共用编号
    if (r.kind === 'moved-from') {
      const id = add({ kind: 'move', row: ri, row2: r.moveRow, before: txt(r.merged, 'a'), after: '', note: t('移动到第 {n} 段附近', { n: rows[r.moveRow!].bi! + 1 }) });
      r.merged.forEach((m) => (m.cid = id)); r.cids.push(id);
      const dst = rows[r.moveRow!]; dst.merged.forEach((m) => (m.cid = id)); dst.cids.push(id);
      return;
    }
    if (r.kind === 'removed' || r.kind === 'added') {
      const id = add({ kind: r.kind === 'removed' ? 'del' : 'ins', row: ri, before: txt(r.merged, 'a'), after: txt(r.merged, 'b') });
      r.merged.forEach((m) => (m.cid = id)); r.cids.push(id);
      return;
    }
    if (r.blockNote) {
      const id = add({ kind: 'fmt', row: ri, before: txt(r.merged, 'a').slice(0, 80), after: '', note: r.blockNote });
      r.blockCid = id; r.cids.push(id);
    }
    // modified / format：把相邻的非相等 token 聚成一处变更（中间只隔空白也算同一处）
    const ms = r.merged;
    let i = 0;
    while (i < ms.length) {
      const isDiff = (m: MTok) => m.op !== 0 && !(m as any).wsOnly;
      if (isDiff(ms[i])) {
        let j = i;
        let last = i;
        while (j < ms.length && (isDiff(ms[j]) || (ms[j].op === 0 && (ms[j].a?.ws || ms[j].b?.ws) && j + 1 < ms.length && isDiff(ms[j + 1])))) { if (isDiff(ms[j])) last = j; j++; }
        const seg = ms.slice(i, last + 1);
        const hasDel = seg.some((m) => m.op === -1), hasIns = seg.some((m) => m.op === 1);
        const id = add({ kind: hasDel && hasIns ? 'mod' : hasDel ? 'del' : 'ins', row: ri, before: txt(seg.filter((m) => m.op !== 1), 'a'), after: txt(seg.filter((m) => m.op !== -1), 'b') });
        seg.forEach((m) => (m.cid = id)); r.cids.push(id);
        i = last + 1;
      } else if (ms[i].fmt) {
        const note = ms[i].fmt!;
        let j = i;
        while (j < ms.length && ms[j].op === 0 && (ms[j].fmt === note || ((ms[j].a?.ws) && ms[j + 1]?.fmt === note))) j++;
        const seg = ms.slice(i, j);
        const id = add({ kind: 'fmt', row: ri, before: txt(seg, 'b'), after: '', note });
        seg.forEach((m) => { if (m.fmt || m.a?.ws) m.cid = id; });
        r.cids.push(id);
        i = j;
      } else i++;
    }
    if (r.kind === 'format' && !r.cids.length) r.kind = 'equal';
    if (r.kind === 'modified' && !r.cids.length) r.kind = 'equal';
    if (r.kind === 'modified' && r.blockNote && r.cids.length === 1 && r.blockCid === r.cids[0]) r.kind = 'format';
  });
  return { rows, changes, stats };
}

function alignLabel(a?: string) { return t(a === 'center' ? '居中' : a === 'right' ? '右对齐' : a === 'justify' ? '两端对齐' : '左对齐'); }

/** 纯文本模式：每行一个块，不带样式 */
export function linesToBlocks(text: string): Block[] {
  return text.split('\n').map((l) => ({ kind: 'p' as const, runs: [{ t: l }] }));
}
