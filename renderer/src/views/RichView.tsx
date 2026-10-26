import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DocModel } from '../lib/model';
import type { DiffResult, Row } from '../lib/engine';
import { BlockGroup, RTok } from '../components/DocBlock';
import { t } from '../lib/i18n';
import { fmtText, blockTagText, blockNoteText } from '../lib/describe';
import { useSections, SecHead, SecHeadProps } from './sections';

function sideToks(r: Row, side: 'a' | 'b'): RTok[] {
  const out: RTok[] = [];
  r.merged.forEach((m, mi) => {
    const t = m[side];
    if (!t) return;
    let cls: string | undefined;
    let title: string | undefined;
    if (r.kind === 'modified' || r.kind === 'format' || r.kind === 'equal') {
      if (m.op === -1 && !(m as any).wsOnly) cls = 't-del';
      else if (m.op === 1 && !(m as any).wsOnly) cls = 't-ins';
      else if (m.fmt) { cls = 't-fmt'; title = fmtText(m.fmt); }
    }
    out.push({ tok: t, cls, cid: m.cid, title, mi });
  });
  return out;
}

/** 选中某处变更时滚动到它；skipRef 为 true 时跳过一次（由点击文档本身触发时，不要把页面拽走） */
export function useScrollToChange(ref: React.RefObject<HTMLElement>, selCid: number | null, rowOf: (cid: number) => number | undefined, onExpand?: (row: number) => void, skipRef?: React.MutableRefObject<boolean>, instantFar = false) {
  useEffect(() => {
    if (selCid == null || !ref.current) return;
    if (skipRef?.current) { skipRef.current = false; return; }
    const row = rowOf(selCid);
    if (row !== undefined) onExpand?.(row);
    // 两帧之后再找元素：被折叠的段落 / 区段刚刚展开，要等 React 把它渲染出来
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const root = ref.current;
      if (!root) return;
      const el = (root.querySelector(`[data-cid="${selCid}"]`) || (row !== undefined ? root.querySelector(`[data-row="${row}"]`) : null)) as HTMLElement | null;
      if (el) {
        scrollToEl(root, el, instantFar);
        const cell = el.closest('[data-row]') as HTMLElement | null;
        if (cell) { cell.classList.remove('row-flash'); void cell.offsetWidth; cell.classList.add('row-flash'); }
      }
    }));
  }, [selCid]);
}

/**
 * 滚到元素并居中。instantFar：距离超过 1.5 屏时直接跳过去，再在两帧后校正一次——
 * 正文按需挂载时，中间的段落边滚边挂载、高度会变，平滑滚动的终点会偏。
 */
export function scrollToEl(root: HTMLElement, el: HTMLElement, instantFar = false) {
  const sc = (root.classList.contains('scroll') ? root : root.closest('.scroll')) as HTMLElement | null;
  const far = instantFar && !!sc && Math.abs(el.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight / 2) > sc.clientHeight * 1.5;
  if (!far) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  el.scrollIntoView({ block: 'center', behavior: 'auto' });
  requestAnimationFrame(() => requestAnimationFrame(() => { if (el.isConnected) el.scrollIntoView({ block: 'center', behavior: 'auto' }); }));
}

// ---------- 正文按需挂载（1.7.4） ----------
// 1.7.3 把整篇正文一次挂到页面上（3000 段约 3 万个节点），切回富文本时整篇重建。
// 现在按行号每 CH 行分成一块，只挂载视口上下各一屏左右的块；其他块用同样高度的占位代替。
// 量过的块高度按“块内容 + 宽度”缓存，切回来时占位高度就是真实高度，滚动条和差异地图不跳。
const CH = 60;                 // 每块的行数
const ALL_BELOW = 360;         // 可见条目少于这么多时整篇挂载（小文档没必要分块）
const HCACHE = new WeakMap<object, { h: Map<string, number>; unit: number }>();
type Item = number | { fold: number[] } | { sec: SecHeadProps };
interface Chunk { key: string; first: number; last: number; items: { it: Item; vi: number }[]; units: number }

/** 估算一个条目大约占几行，用于还没量过的块 */
function unitsOf(it: Item, rows: Row[], A: DocModel, B: DocModel) {
  if (typeof it !== 'number') return 1.6;
  const r = rows[it];
  const len = (side: 'a' | 'b') => {
    const ids = side === 'a' ? (r.ai !== undefined ? r.aList || [r.ai] : []) : (r.bi !== undefined ? r.bList || [r.bi] : []);
    const D = side === 'a' ? A : B;
    let n = 0;
    for (const i of ids) { const b = D.blocks[i]; if (b) n += b.kind === 'tr' ? (b.cells || []).reduce((s, c) => s + c.reduce((x, y) => x + y.t.length, 0), 0) : b.runs.reduce((x, y) => x + y.t.length, 0); }
    return n;
  };
  return 1 + Math.ceil(Math.max(len('a'), len('b')) / 34);
}

// ---------- 行框选 / 对齐 ----------
type Side = 'a' | 'b';
interface Box { top: number; left: number; width: number; height: number }
interface LineHit { row: number; side: Side; span: HTMLElement; rect: DOMRect; twin?: { span: HTMLElement; rect: DOMRect } }
interface Align { row: number; side: Side; px: number }

/** span 在 y 处的那一行的矩形（一个词可能折行成多段） */
function lineRectAt(span: HTMLElement, y?: number): DOMRect | null {
  const rs = Array.from(span.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  if (!rs.length) return null;
  if (y === undefined) return rs[0];
  return rs.find((r) => y >= r.top - 2 && y <= r.bottom + 2) || rs.reduce((a, b) => (Math.abs(a.top - y) < Math.abs(b.top - y) ? a : b));
}

export function RichView({ A, B, res, selCid, onSel, hideUnchanged }: { A: DocModel; B: DocModel; res: DiffResult; selCid: number | null; onSel: (id: number) => void; hideUnchanged: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const richRef = useRef<HTMLDivElement>(null);
  const skipScroll = useRef(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<{ a?: Box; b?: Box; side: Side } | null>(null);
  const [pinned, setPinned] = useState<{ a?: Box; b?: Box; row: number; ok: boolean } | null>(null);
  const [align, setAlign] = useState<Align | null>(null);
  const [tick, setTick] = useState(0);
  const anchor = useRef<{ span: HTMLElement; top: number; idx: number } | null>(null);
  useEffect(() => { setExpanded(new Set()); setAlign(null); setPinned(null); setHover(null); }, [res]);
  const rowOfCid = (cid: number) => res.changes.find((c) => c.id === cid)?.row;
  const secs = useSections(res);
  useScrollToChange(ref, selCid, rowOfCid, (row) => { secs.reveal(res.rows[row]?.sec); setForce([Math.floor(row / CH)]); if (hideUnchanged && !expanded.has(row)) setExpanded((s) => new Set(s).add(row)); }, skipScroll, true);

  const rows = res.rows;

  // 把屏幕坐标换算成 .rich 内的坐标（随内容一起滚动）
  const toBox = useCallback((rect: DOMRect, cell: HTMLElement): Box => {
    const base = richRef.current!.getBoundingClientRect();
    const blk = (cell.querySelector('.blk') as HTMLElement) || cell;
    const br = blk.getBoundingClientRect();
    return { top: rect.top - base.top - 3, left: br.left - base.left - 8, width: br.width + 16, height: rect.height + 6 };
  }, []);

  /** 找到鼠标所在的那一行，以及另一侧对应的位置 */
  const hitTest = useCallback((x: number, y: number, target: HTMLElement): LineHit | null => {
    const cell = target.closest('.cell[data-side]') as HTMLElement | null;
    if (!cell || cell.classList.contains('ph')) return null;
    let span = target.closest('[data-mi]') as HTMLElement | null;
    if (!span) {
      const cr = (document as any).caretRangeFromPoint?.(x, y) as Range | null;
      const node = cr?.startContainer;
      const el = node ? (node.nodeType === 3 ? node.parentElement : (node as HTMLElement)) : null;
      span = el?.closest('[data-mi]') as HTMLElement | null;
      if (span && !cell.contains(span)) span = null;
    }
    if (!span) {
      // 行尾空白处：取这一格里离 y 最近的一个词
      let best: HTMLElement | null = null, bd = 1e9;
      cell.querySelectorAll<HTMLElement>('[data-mi]').forEach((s) => { const r = lineRectAt(s, y); if (r) { const d = Math.abs((r.top + r.bottom) / 2 - y); if (d < bd) { bd = d; best = s; } } });
      if (!best || bd > 30) return null;
      span = best;
    }
    const rect = lineRectAt(span, y);
    if (!rect) return null;
    const row = Number(cell.dataset.row), side = cell.dataset.side as Side;
    const other: Side = side === 'a' ? 'b' : 'a';
    const otherCell = richRef.current!.querySelector(`.cell[data-row="${row}"][data-side="${other}"]`) as HTMLElement | null;
    const hit: LineHit = { row, side, span, rect };
    if (otherCell && !otherCell.classList.contains('ph')) {
      const merged = rows[row].merged;
      const mi = Number(span.dataset.mi);
      // 在合并序列里找离它最近、且另一侧有内容的词（相同的词优先，其次是被替换的词）
      for (let d = 0; d < merged.length; d++) {
        for (const k of d === 0 ? [mi] : [mi - d, mi + d]) {
          const t = merged[k]?.[other];
          if (!t || t.sep || t.psep || t.ws) continue;
          const s2 = otherCell.querySelector(`[data-mi="${k}"]`) as HTMLElement | null;
          const r2 = s2 && lineRectAt(s2);
          if (s2 && r2) { hit.twin = { span: s2, rect: r2 }; break; }
        }
        if (hit.twin) break;
      }
    }
    return hit;
  }, [rows]);

  const boxesOf = (hit: LineHit) => {
    const cell = hit.span.closest('.cell') as HTMLElement;
    const out: { a?: Box; b?: Box } = { [hit.side]: toBox(hit.rect, cell) };
    if (hit.twin) out[hit.side === 'a' ? 'b' : 'a'] = toBox(hit.twin.rect, hit.twin.span.closest('.cell') as HTMLElement);
    return out;
  };

  const raf = useRef(0);
  const onMove = (e: React.MouseEvent) => {
    const { clientX: x, clientY: y } = e;
    const target = e.target as HTMLElement;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (!richRef.current) return;
      const hit = hitTest(x, y, target);
      setHover(hit ? { ...boxesOf(hit), side: hit.side } : null);
    });
  };

  const onClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.movetag, button')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // 正在选中文字，不做对齐
    const target = e.target as HTMLElement;
    const hit = hitTest(e.clientX, e.clientY, target);
    const el = target.closest('[data-cid]') as HTMLElement | null;
    if (el?.dataset.cid) { skipScroll.current = true; onSel(Number(el.dataset.cid)); }
    if (!hit) { setPinned(null); return; }
    if (!hit.twin) {
      // 另一侧没有可对齐的内容：只保留所选这一行
      setPinned({ ...boxesOf(hit), row: hit.row, ok: false });
      return;
    }
    // 去掉当前这一行已有的偏移，得到“自然位置”，再决定把哪一侧往下推
    const off = (s: Side) => (align && align.row === hit.row && align.side === s ? align.px : 0);
    const other: Side = hit.side === 'a' ? 'b' : 'a';
    const natMine = hit.rect.top - off(hit.side);
    const natTwin = hit.twin.rect.top - off(other);
    const diff = Math.round(natMine - natTwin);
    const rs = Array.from(hit.span.getClientRects());
    anchor.current = { span: hit.span, top: hit.rect.top, idx: Math.max(0, rs.findIndex((r) => Math.abs(r.top - hit.rect.top) < 1)) };
    setTick((t) => t + 1);
    setAlign(Math.abs(diff) < 2 ? null : diff > 0 ? { row: hit.row, side: other, px: diff } : { row: hit.row, side: hit.side, px: -diff });
    setPinned({ row: hit.row, ok: true }); // 位置在布局后重新计算
  };

  // 对齐后：保持点击的那一行在屏幕上不动，并重新计算框的位置（只在点击后执行一次）
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a || !ref.current || !richRef.current) return;
    anchor.current = null;
    if (!a.span.isConnected) return;
    const lineOf = () => { const rs = a.span.getClientRects(); return rs[a.idx] || rs[0]; };
    const r1 = lineOf();
    if (!r1) return;
    const delta = r1.top - a.top;
    if (Math.abs(delta) > 0.5) ref.current.scrollTop += delta;
    const r2 = lineOf();
    const hit = hitTest(r2.left + 1, r2.top + r2.height / 2, a.span);
    if (hit) setPinned({ ...boxesOf(hit), row: hit.row, ok: !!hit.twin });
  }, [tick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAlign(null); setPinned(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- 按需挂载 ----------
  const [win, setWin] = useState<{ lo: number; hi: number }>({ lo: 0, hi: 2 });
  const [force, setForce] = useState<number[]>([]);          // 跳转目标所在的块
  const [selSpan, setSelSpan] = useState<{ lo: number; hi: number } | 'all' | null>(null); // 正在选中文字时不卸载
  const [, setMeasured] = useState(0);
  const chunkEls = useRef(new Map<number, HTMLElement>());
  const [width, setWidth] = useState(0);

  const ensureRow = useCallback((row: number) => setForce([Math.floor(row / CH)]), []);
  const jump = useCallback((row: number) => {
    ensureRow(row);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = ref.current?.querySelector(`[data-row="${row}"]`) as HTMLElement | null;
      if (!el || !ref.current) return;
      scrollToEl(ref.current, el, true);
      el.classList.remove('row-flash'); void el.offsetWidth; el.classList.add('row-flash');
    }));
  }, [ensureRow]);

  // 隐藏未变化：每个变化前后保留 1 段；页眉 / 页脚 / 脚注各自一个区段，可以折叠
  const visible: Item[] = [];
  const keep = new Array(rows.length).fill(!hideUnchanged);
  if (hideUnchanged) rows.forEach((r, i) => { if (r.kind !== 'equal') for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < rows.length && (rows[k].sec || 'body') === (r.sec || 'body')) keep[k] = true; });
  let buf: number[] = [];
  const flushFold = () => { if (buf.length) { visible.push({ fold: buf }); buf = []; } };
  rows.forEach((r, i) => {
    const head = secs.headAt(i);
    if (head) { flushFold(); visible.push({ sec: head }); }
    if (secs.hidden(r.sec)) return;
    if (keep[i] || expanded.has(i)) { flushFold(); visible.push(i); }
    else buf.push(i);
  });
  flushFold();

  // 按行号分块：展开 / 折叠只影响所在的块，其他块的缓存高度仍然有效
  const chunks: Chunk[] = [];
  {
    const byB = new Map<number, Chunk>();
    let pendingSec: { it: Item; vi: number }[] = [];
    const rowOfItem = (it: Item) => (typeof it === 'number' ? it : 'fold' in it ? it.fold[0] : -1);
    visible.forEach((it, vi) => {
      const row = rowOfItem(it);
      if (row < 0) { pendingSec.push({ it, vi }); return; }
      const b = Math.floor(row / CH);
      let c = byB.get(b);
      if (!c) { c = { key: '', first: row, last: row, items: [], units: 0 }; byB.set(b, c); chunks.push(c); (c as any).b = b; }
      for (const p of pendingSec) { c.items.push(p); c.units += unitsOf(p.it, rows, A, B); }
      pendingSec = [];
      c.items.push({ it, vi }); c.units += unitsOf(it, rows, A, B);
      c.last = typeof it === 'number' ? it : (it as { fold: number[] }).fold[(it as { fold: number[] }).fold.length - 1];
    });
    if (pendingSec.length) {
      if (!chunks.length) { const c: Chunk = { key: '', first: 0, last: 0, items: [], units: 0 }; (c as any).b = 0; chunks.push(c); }
      const c = chunks[chunks.length - 1];
      for (const p of pendingSec) { c.items.push(p); c.units += 1.6; }
    }
    const k = (it: Item) => (typeof it === 'number' ? 'r' + it : 'fold' in it ? `f${it.fold[0]}-${it.fold.length}` : 's' + (it as any).sec.sec + ((it as any).sec.open ? 'o' : 'c'));
    for (const c of chunks) c.key = `${c.items.length}|${k(c.items[0].it)}|${k(c.items[c.items.length - 1].it)}`;
  }
  const windowed = visible.length > ALL_BELOW;
  const bOf = (c: Chunk) => (c as any).b as number;
  const cache = (() => { let c = HCACHE.get(res); if (!c) { c = { h: new Map(), unit: 26 }; HCACHE.set(res, c); } return c; })();
  const hKey = (c: Chunk) => `${width}|${align && align.row >= c.first && align.row <= c.last ? 'al' + align.px : ''}|${c.key}`;
  const estH = (c: Chunk) => cache.h.get(hKey(c)) ?? Math.round(c.units * cache.unit);

  // 选中的差异、对齐的行所在的块总要挂着
  const selRowIdx = selCid != null ? rowOfCid(selCid) : undefined;
  const isMounted = (ci: number, c: Chunk) => {
    if (!windowed || selSpan === 'all') return true;
    const b = bOf(c);
    if (ci >= win.lo && ci <= win.hi) return true;
    if (selSpan && ci >= selSpan.lo && ci <= selSpan.hi) return true;
    if (force.includes(b)) return true;
    if (selRowIdx !== undefined && Math.floor(selRowIdx / CH) === b) return true;
    if (align && Math.floor(align.row / CH) === b) return true;
    return false;
  };

  // 根据滚动位置决定挂哪些块：视口往上一屏、往下两屏
  const recompute = useCallback(() => {
    const sc = ref.current, rich = richRef.current;
    if (!sc || !rich) return;
    const kids = Array.from(rich.querySelectorAll<HTMLElement>(':scope > [data-chunk]'));
    if (!kids.length) return;
    const top = sc.scrollTop - sc.clientHeight, bottom = sc.scrollTop + sc.clientHeight * 2;
    let lo = -1, hi = -1;
    kids.forEach((el, i) => { const y = el.offsetTop, h = el.offsetHeight; if (y + h >= top && y <= bottom) { if (lo < 0) lo = i; hi = i; } });
    if (lo < 0) { lo = hi = kids.length - 1; }
    setWin((w) => (w.lo === lo && w.hi === hi ? w : { lo, hi }));
  }, []);
  useEffect(() => {
    const sc = ref.current;
    if (!sc) return;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(recompute); };
    sc.addEventListener('scroll', on, { passive: true });
    const ro = new ResizeObserver(() => { setWidth(Math.round(sc.clientWidth / 8) * 8); on(); });
    ro.observe(sc);
    return () => { sc.removeEventListener('scroll', on); ro.disconnect(); cancelAnimationFrame(raf); };
  }, [recompute]);
  // 跳转目标挂上以后，过一会儿就不再强制
  useEffect(() => { if (!force.length) return; const t = setTimeout(() => setForce([]), 4000); return () => clearTimeout(t); }, [force]);

  // 正在选中文字：选区两端之间的块全部挂上、且不卸载；全选时挂载全文
  useEffect(() => {
    const onSel = () => {
      const rich = richRef.current;
      const sel = window.getSelection();
      if (!rich || !sel || sel.isCollapsed || !sel.rangeCount) { setSelSpan((x) => (x ? null : x)); return; }
      const r = sel.getRangeAt(0);
      if (!r.intersectsNode(rich)) { setSelSpan((x) => (x ? null : x)); return; }
      const ci = (n: Node | null) => { const el = n && (n.nodeType === 3 ? n.parentElement : (n as HTMLElement)); const c = el?.closest?.('[data-chunk]') as HTMLElement | null; return c && rich.contains(c) ? Number(c.dataset.chunk) : null; };
      const a = ci(r.startContainer), b = ci(r.endContainer);
      if (a === null || b === null) { setSelSpan((x) => (x === 'all' ? x : 'all')); return; }
      const lo = Math.min(a, b), hi = Math.max(a, b);
      setSelSpan((x) => (x && x !== 'all' && x.lo === lo && x.hi === hi ? x : { lo, hi }));
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  // 每次渲染后量一下挂着的块，更新缓存；平均每“行”多高用于估算没量过的块
  useLayoutEffect(() => {
    if (!windowed || !width) return;
    let changed = false, sumH = 0, sumU = 0;
    chunks.forEach((c, ci) => {
      const el = chunkEls.current.get(ci);
      if (!el || el.dataset.ph) return;
      const h = el.offsetHeight;
      const k = hKey(c);
      if (cache.h.get(k) !== h) { cache.h.set(k, h); changed = true; }
      sumH += h; sumU += c.units;
    });
    if (sumU > 0) { const u = sumH / sumU; if (Math.abs(u - cache.unit) / cache.unit > 0.05) { cache.unit = u; changed = true; } }
    if (changed) setMeasured((n) => n + 1);
  });

  const isSec = (x: Item | undefined) => !!x && typeof x === 'object' && 'sec' in x;
  const frame = (b: Box | undefined, cls: string) => b && <div className={`line-frame ${cls}`} style={{ top: b.top, left: b.left, width: b.width, height: b.height }} />;
  const renderItem = (v: Item, vi: number) => {
    if (isSec(v)) return <SecHead key={'s' + vi} {...(v as { sec: SecHeadProps }).sec} span />;
    const edge = (vi === 0 || isSec(visible[vi - 1]) ? ' first' : '') + (vi === visible.length - 1 || isSec(visible[vi + 1]) ? ' last' : '');
    if (typeof v !== 'number') {
      const f = v as { fold: number[] };
      const expand = () => setExpanded((st) => { const x = new Set(st); f.fold.forEach((i) => x.add(i)); return x; });
      return (
        <React.Fragment key={'f' + f.fold[0]}>
          <div className={`cell fold-cell${edge}`}><button className="btn sm plain block" onClick={expand}>{t('⋯ {n} 个未变化的段落', { n: f.fold.length })}</button></div>
          <div className={`cell fold-cell${edge}`}><button className="btn sm plain block" onClick={expand}>{t('⋯ {n} 个未变化的段落', { n: f.fold.length })}</button></div>
        </React.Fragment>
      );
    }
    const r = rows[v];
    const whole = r.kind === 'removed' || r.kind === 'added' || r.kind.startsWith('moved');
    const hasSel = selCid != null && (whole ? r.cids.includes(selCid) : (r.blockCid === selCid || r.cids.includes(selCid)));
    return <RichRow key={v} v={v} r={r} A={A} B={B} edge={edge} selRow={selCid != null && (whole ? r.cids.includes(selCid) : r.blockCid === selCid)} sc={!whole && hasSel ? selCid : null}
      alignA={align && align.row === v && align.side === 'a' ? align.px : 0} alignB={align && align.row === v && align.side === 'b' ? align.px : 0} onJump={jump} />;
  };
  return (
    <>
      <div className="scroll" ref={ref} onClick={onClick} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <div className={`rich doc chunked`} ref={richRef}>
          <div className="rich-head">
            <div className="colhead"><span className={`badge ${A.type}`}>{A.type.toUpperCase()}</span>{A.file.name}</div>
            <div className="colhead"><span className={`badge ${B.type}`}>{B.type.toUpperCase()}</span>{B.file.name}</div>
          </div>
          {chunks.map((c, ci) => isMounted(ci, c)
            ? <div key={'c' + bOf(c)} className="rich-chunk" data-chunk={ci} ref={(el) => { if (el) chunkEls.current.set(ci, el); else chunkEls.current.delete(ci); }}>{c.items.map(({ it, vi }) => renderItem(it, vi))}</div>
            : <div key={'c' + bOf(c)} className="rich-ph" data-chunk={ci} data-ph="1" data-rows={`${c.first}-${c.last}`} style={{ height: estH(c) }} ref={(el) => { if (el) chunkEls.current.set(ci, el); else chunkEls.current.delete(ci); }} aria-hidden="true">
                <div className="cell vspace" /><div className="cell vspace" />
              </div>)}
          {hover && frame(hover[hover.side], 'hover')}
          {hover && frame(hover[hover.side === 'a' ? 'b' : 'a'], 'hover twin')}
          {pinned && frame(pinned.a, pinned.ok ? 'pinned' : 'pinned lone')}
          {pinned && frame(pinned.b, pinned.ok ? 'pinned' : 'pinned lone')}
        </div>
      </div>
      {(align || pinned) && (
        <div className="align-chip">
          {t(pinned && !pinned.ok ? '另一侧没有可对应的内容，已标记所选行' : align ? '已把两侧对齐到所选行' : '这一行两侧已经对齐')}
          <button className="btn sm plain" onClick={() => { setAlign(null); setPinned(null); }}>{t(align ? '撤销对齐' : '取消标记')}</button>
        </div>
      )}
    </>
  );
}

/** 一行（左右两格）。按值比较 props：选中别的差异、对齐别的行时，这一行不重新渲染 */
const RichRow = React.memo(function RichRow({ v, r, A, B, edge, selRow, sc, alignA, alignB, onJump }: {
  v: number; r: Row; A: DocModel; B: DocModel; edge: string; selRow: boolean; sc: number | null; alignA: number; alignB: number; onJump: (row: number) => void;
}) {
  const la = r.ai !== undefined ? (r.aList || [r.ai]).map((i) => A.blocks[i]) : null;
  const lb = r.bi !== undefined ? (r.bList || [r.bi]).map((i) => B.blocks[i]) : null;
  const sr = selRow ? ' sel-row' : '';
  const moveTag = (side: Side) => {
    if (r.kind === 'moved-from' && side === 'a') return <span className="movetag" onClick={(e) => { e.stopPropagation(); onJump(r.moveRow!); }}>{t('已移动')} {r.moveRow! > v ? '↓' : '↑'}</span>;
    if (r.kind === 'moved-to' && side === 'b') return <span className="movetag" onClick={(e) => { e.stopPropagation(); onJump(r.moveRow!); }}>{t(r.moveRow! < v ? '从上方移来' : '从下方移来')} {r.moveRow! < v ? '↑' : '↓'}</span>;
    return null;
  };
  return (
    <>
      <div className={`cell k-${r.kind}${edge}${la ? sr : ' ph'}`} data-row={v} data-side="a">
        {alignA > 0 && <div className="align-spacer" style={{ height: alignA }} />}
        {la ? <BlockGroup blocks={la} toks={sideToks(r, 'a')} selCid={sc} className={r.blockDesc ? 'bnote' : ''} /> : <div className="phline" />}
        {moveTag('a')}
      </div>
      <div className={`cell k-${r.kind}${edge}${lb ? sr : ' ph'}`} data-row={v} data-side="b">
        {alignB > 0 && <div className="align-spacer" style={{ height: alignB }} />}
        {lb ? <BlockGroup blocks={lb} toks={sideToks(r, 'b')} selCid={sc} className={r.blockDesc ? 'bnote' : ''} /> : <div className="phline" />}
        {moveTag('b')}
        {r.blockDesc && <span className="movetag fmt" data-cid={r.blockCid} title={blockNoteText(r.blockDesc)}>{blockTagText(r.blockDesc)}</span>}
      </div>
    </>
  );
});
