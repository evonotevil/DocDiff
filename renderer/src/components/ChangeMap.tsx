import React, { useEffect, useRef, useState } from 'react';
import type { Change } from '../lib/engine';
import { t } from '../lib/i18n';

const DENSE = 200;   // 超过这么多处差异，改画密度条
const BUCKETS = 120;
const RANK: Record<string, number> = { del: 5, mod: 4, ins: 3, move: 2, fmt: 1 };  // 数量相同时按这个顺序取色

type Tick = { id: number; kind: string; top: number; h: number };
/** 切回同一个视图时，版面尺寸没变就直接用上次量好的刻度 */
const CACHE = new WeakMap<object, { key: string; dep: any; ticks: Tick[] }>();
function shallowSame(a: any, b: any) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

/**
 * 量出每处差异在滚动内容里的位置（百分比）。
 * 一次 querySelectorAll 建好 差异 id / 行号 → 元素 的索引，不再按差异逐个在整棵树里查找。
 * 差异很多（> DENSE，画成密度条）时只量每一行的第一格：同一行的差异共用一个位置，量的次数从“差异数”降到“行数”。
 * 带 content-visibility: auto 的行逐个取矩形会逐行触发布局（1.5.0 的教训），这时按行号等距估算。
 */
function locate(sc: HTMLElement, changes: Change[]): Tick[] {
  const H = sc.scrollHeight || 1;
  const byCid = new Map<number, HTMLElement>();
  const byRow = new Map<number, HTMLElement>();
  const rowOrder: number[] = [];
  const phs: { first: number; last: number; el: HTMLElement }[] = [];   // 正文按需挂载时没挂上的块（占位）
  sc.querySelectorAll<HTMLElement>('[data-cid],[data-row],[data-rows]').forEach((el) => {
    const c = el.dataset.cid, r = el.dataset.row;
    if (el.dataset.rows) { const [f, l] = el.dataset.rows.split('-').map(Number); phs.push({ first: f, last: l, el }); return; }
    if (c !== undefined && !byCid.has(+c)) byCid.set(+c, el);
    if (r !== undefined && !byRow.has(+r)) { byRow.set(+r, el); rowOrder.push(+r); }
  });
  const out: Tick[] = [];
  const sample = byRow.get(rowOrder[rowOrder.length >> 1]);
  const skipped = !!sample && getComputedStyle(sample).contentVisibility === 'auto';
  if (skipped && changes.length > 60) {
    const idx = new Map<number, number>();
    rowOrder.forEach((r, i) => idx.set(r, i));
    const n = rowOrder.length || 1;
    const h = Math.max(0.4, 100 / n);
    for (const c of changes) { const i = idx.get(c.row); if (i !== undefined) out.push({ id: c.id, kind: c.kind, top: (i / n) * 100, h }); }
    return out;
  }
  const base = sc.getBoundingClientRect().top - sc.scrollTop;
  const dense = changes.length > DENSE;
  const rowPos = new Map<number, { top: number; h: number } | null>();
  const pos = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { top: ((r.top - base) / H) * 100, h: Math.max(0.4, (r.height / H) * 100) }; };
  // 没挂载的行：在占位块里按行号比例估算
  const inPh = (row: number) => {
    let lo = 0, hi = phs.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; const x = phs[m]; if (row < x.first) hi = m - 1; else if (row > x.last) lo = m + 1; else {
      const r = x.el.getBoundingClientRect(); const n = x.last - x.first + 1;
      return { top: ((r.top - base + (r.height * (row - x.first)) / n) / H) * 100, h: Math.max(0.4, (r.height / n / H) * 100) };
    } }
    return null;
  };
  for (const c of changes) {
    let p: { top: number; h: number } | null | undefined;
    if (c.row2 !== undefined) {
      // 移动：两处都有同一个 id，和以前一样取文档里靠前的那一处
      const r0 = Math.min(c.row, c.row2);
      const el = byRow.get(r0);
      p = el ? pos(el) : inPh(r0);
    } else if (dense) {
      p = rowPos.get(c.row);
      if (p === undefined) { const el = byRow.get(c.row) || byCid.get(c.id); p = el ? pos(el) : inPh(c.row); rowPos.set(c.row, p); }
    } else {
      const el = byCid.get(c.id) || byRow.get(c.row);
      p = el ? pos(el) : inPh(c.row);
    }
    if (p) out.push({ id: c.id, kind: c.kind, ...p });
  }
  return out;
}

/**
 * 差异地图兼滚动条：中间区域的原生滚动条隐藏掉，由它来显示位置、拖动和跳转。
 * 每处差异一条彩色刻度（修改 = 左红右绿）；可见区域只画描边，不盖住刻度。
 * 筛选某一类时，其他类别降到 25% 而不是消失。差异很多时按位置分桶画成密度条：
 * 颜色取这一段里数量最多的类别，深浅三档表示多少。
 */
export function ChangeMap({ changes, filter = [], selCid, onSel, dep, bottom = 6 }: { changes: Change[]; filter?: string[]; selCid: number | null; onSel: (id: number) => void; dep: any; bottom?: number }) {
  const pass = (k: string) => !filter.length || filter.includes(k);
  const ref = useRef<HTMLDivElement>(null);
  const [ticks, setTicks] = useState<Tick[]>(() => []);
  const [view, setView] = useState({ top: 0, h: 100 });
  const scroller = () => ref.current?.parentElement?.querySelector('.scroll') as HTMLElement | null;
  // dep 由调用方每次渲染新建数组；这里按元素浅比较，内容没变就不重新测量（1.7.3 每次选中差异都会重测一遍）
  const depRef = useRef<{ dep: any; v: number }>({ dep: undefined, v: 0 });
  if (!shallowSame(depRef.current.dep, dep)) depRef.current = { dep, v: depRef.current.v + 1 };
  const depV = depRef.current.v;
  useEffect(() => {
    const sc = scroller();
    if (!sc) return;
    const sig = () => `${sc.scrollHeight}x${sc.clientWidth}`;
    let last = '';
    const measure = () => {
      const key = sig();
      if (key === last) return;           // 版面没变，不用再量
      last = key;
      const hit = CACHE.get(changes);
      if (hit && hit.key === key && shallowSame(hit.dep, depRef.current.dep)) { setTicks(hit.ticks); onScroll(); return; }
      const out = locate(sc, changes);
      CACHE.set(changes, { key, dep: depRef.current.dep, ticks: out });
      setTicks(out);
      onScroll();
    };
    const onScroll = () => { const H = sc.scrollHeight || 1; setView({ top: (sc.scrollTop / H) * 100, h: (sc.clientHeight / H) * 100 }); };
    let pending = 0, timer: any = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(measure); }, 120); };
    // 先画一次（有缓存就直接用），之后只在尺寸真的变化时再量
    pending = requestAnimationFrame(measure);
    const ro = new ResizeObserver(schedule);
    ro.observe(sc);
    if (sc.firstElementChild) ro.observe(sc.firstElementChild);
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(timer); cancelAnimationFrame(pending); ro.disconnect(); sc.removeEventListener('scroll', onScroll); };
  }, [changes, depV]);

  // 拖动视口框 = 拖动滚动条；在空白处按下 = 跳到那里（或选中附近的差异）
  const drag = useRef<{ y0: number; top0: number } | null>(null);
  const pctAt = (y: number) => { const r = ref.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (y - r.top) / r.height)); };
  const onDown = (e: React.PointerEvent) => {
    const sc = scroller();
    if (!sc || !ref.current) return;
    const pct = pctAt(e.clientY);
    const inView = pct * 100 >= view.top && pct * 100 <= view.top + view.h;
    if (!inView) {
      let best: number | null = null, bd = 1e9;
      if (ticks.length <= DENSE) for (const t of ticks) { if (!pass(t.kind)) continue; const d = Math.abs(t.top / 100 - pct); if (d < bd) { bd = d; best = t.id; } }
      if (best !== null && bd < 0.012) { onSel(best); return; }
      sc.scrollTop = pct * sc.scrollHeight - sc.clientHeight / 2;
    }
    drag.current = { y0: e.clientY, top0: sc.scrollTop };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const sc = scroller();
    if (!drag.current || !sc || !ref.current) return;
    const ratio = sc.scrollHeight / ref.current.getBoundingClientRect().height;
    sc.scrollTop = drag.current.top0 + (e.clientY - drag.current.y0) * ratio;
  };
  const onUp = () => { drag.current = null; };
  const onKey = (e: React.KeyboardEvent) => {
    const sc = scroller();
    if (!sc) return;
    if (e.key === 'ArrowDown') sc.scrollTop += 60; else if (e.key === 'ArrowUp') sc.scrollTop -= 60;
    else if (e.key === 'PageDown') sc.scrollTop += sc.clientHeight * 0.9; else if (e.key === 'PageUp') sc.scrollTop -= sc.clientHeight * 0.9;
    else return;
    e.preventDefault();
  };

  if (!changes.length) return null;
  const dense = ticks.length > DENSE;
  let buckets: { kind: string; n: number }[] = [];
  if (dense) {
    const counts = Array.from({ length: BUCKETS }, () => ({} as Record<string, number>));
    for (const tk of ticks) {
      if (!pass(tk.kind)) continue;
      const c = counts[Math.min(BUCKETS - 1, Math.max(0, Math.floor((tk.top / 100) * BUCKETS)))];
      c[tk.kind] = (c[tk.kind] || 0) + 1;
    }
    buckets = counts.map((c) => {
      let kind = '', best = 0, n = 0;
      for (const [k, v] of Object.entries(c)) { n += v; if (v > best || (v === best && RANK[k] > RANK[kind])) { best = v; kind = k; } }
      return { kind, n };
    });
  }
  const maxN = dense ? Math.max(1, ...buckets.map((b) => b.n)) : 1;
  const level = (n: number) => (n / maxN > 0.66 ? 1 : n / maxN > 0.33 ? 0.7 : 0.4);
  return (
    <div className={`changemap ${dense ? 'dense' : ''}`} ref={ref} style={{ bottom }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      role="scrollbar" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.top)} tabIndex={0} onKeyDown={onKey}
      title={t('差异地图：拖动滚动，点击跳到附近的差异')} aria-label={t('差异地图')}>
      {dense
        ? buckets.map((b, i) => b.n > 0 && <div key={i} className={`cm-tick k-${b.kind}`} style={{ top: `${(i / BUCKETS) * 100}%`, height: `${100 / BUCKETS}%`, opacity: level(b.n) }} />)
        : ticks.map((tk) => <div key={tk.id} data-tick={tk.id} className={`cm-tick k-${tk.kind} ${tk.id === selCid ? 'on' : ''} ${pass(tk.kind) ? '' : 'dim'}`} style={{ top: `${tk.top}%`, height: `max(3px, ${tk.h}%)` }} />)}
      <div className="cm-view" style={{ top: `${view.top}%`, height: `${Math.max(3, view.h)}%` }} />
    </div>
  );
}
