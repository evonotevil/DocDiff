import React, { useEffect, useRef, useState } from 'react';
import type { Change } from '../lib/engine';
import { t } from '../lib/i18n';

const DENSE = 200;   // 超过这么多处差异，改画密度条
const BUCKETS = 120;
const RANK: Record<string, number> = { del: 5, mod: 4, ins: 3, move: 2, fmt: 1 };

/**
 * 差异地图兼滚动条：中间区域的原生滚动条隐藏掉，由它来显示位置、拖动和跳转。
 * 每处差异一条彩色刻度；差异很多时按位置分桶画成密度条（颜色取桶里最“重”的类型，深浅表示数量）。
 */
export function ChangeMap({ changes, selCid, onSel, dep, bottom = 6 }: { changes: Change[]; selCid: number | null; onSel: (id: number) => void; dep: any; bottom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ticks, setTicks] = useState<{ id: number; kind: string; top: number; h: number }[]>([]);
  const [view, setView] = useState({ top: 0, h: 100 });
  const scroller = () => ref.current?.parentElement?.querySelector('.scroll') as HTMLElement | null;
  useEffect(() => {
    const sc = scroller();
    if (!sc) return;
    const measure = () => {
      const H = sc.scrollHeight || 1;
      const rowEls = Array.from(sc.querySelectorAll('[data-row]')) as HTMLElement[];
      const idxOf = new Map<number, number>();
      rowEls.forEach((el, i) => idxOf.set(Number(el.dataset.row), i));
      // 带 content-visibility: auto 的行逐个取矩形会逐行触发布局（1.5.0 的教训），差异多时按行号等距估算
      const sample = rowEls[Math.floor(rowEls.length / 2)];
      const skipped = !!sample && getComputedStyle(sample).contentVisibility === 'auto';
      const exact = !skipped || changes.length <= 60;
      const out: { id: number; kind: string; top: number; h: number }[] = [];
      if (exact) {
        const base = sc.getBoundingClientRect().top - sc.scrollTop;
        for (const c of changes) {
          const el = (sc.querySelector(`[data-cid="${c.id}"]`) || sc.querySelector(`[data-row="${c.row}"]`)) as HTMLElement | null;
          if (!el) continue;
          const r = el.getBoundingClientRect();
          out.push({ id: c.id, kind: c.kind, top: ((r.top - base) / H) * 100, h: Math.max(0.4, (r.height / H) * 100) });
        }
      } else {
        const n = rowEls.length || 1;
        const h = Math.max(0.4, 100 / n);
        for (const c of changes) {
          const i = idxOf.get(c.row);
          if (i === undefined) continue;
          out.push({ id: c.id, kind: c.kind, top: (i / n) * 100, h });
        }
      }
      setTicks(out);
      setView({ top: (sc.scrollTop / H) * 100, h: (sc.clientHeight / H) * 100 });
    };
    const onScroll = () => { const H = sc.scrollHeight || 1; setView({ top: (sc.scrollTop / H) * 100, h: (sc.clientHeight / H) * 100 }); };
    let pending = 0, timer: any = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(measure); }, 120); };
    const t1 = setTimeout(measure, 60), t2 = setTimeout(measure, 600);
    const ro = new ResizeObserver(schedule);
    ro.observe(sc);
    if (sc.firstElementChild) ro.observe(sc.firstElementChild);
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(timer); cancelAnimationFrame(pending); ro.disconnect(); sc.removeEventListener('scroll', onScroll); };
  }, [changes, dep]);

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
      if (ticks.length <= DENSE) for (const t of ticks) { const d = Math.abs(t.top / 100 - pct); if (d < bd) { bd = d; best = t.id; } }
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
    buckets = Array.from({ length: BUCKETS }, () => ({ kind: '', n: 0 }));
    for (const tk of ticks) {
      const b = buckets[Math.min(BUCKETS - 1, Math.max(0, Math.floor((tk.top / 100) * BUCKETS)))];
      b.n++;
      if (!b.kind || RANK[tk.kind] > RANK[b.kind]) b.kind = tk.kind;
    }
  }
  const maxN = dense ? Math.max(1, ...buckets.map((b) => b.n)) : 1;
  return (
    <div className={`changemap ${dense ? 'dense' : ''}`} ref={ref} style={{ bottom }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      role="scrollbar" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.top)} tabIndex={0} onKeyDown={onKey}
      title={t('差异地图：拖动滚动，点击跳到附近的差异')} aria-label={t('差异地图')}>
      {dense
        ? buckets.map((b, i) => b.n > 0 && <div key={i} className={`cm-tick k-${b.kind}`} style={{ top: `${(i / BUCKETS) * 100}%`, height: `${100 / BUCKETS}%`, opacity: 0.35 + 0.65 * (b.n / maxN) }} />)
        : ticks.map((tk) => <div key={tk.id} className={`cm-tick k-${tk.kind} ${tk.id === selCid ? 'on' : ''}`} style={{ top: `${tk.top}%`, height: `max(3px, ${tk.h}%)` }} />)}
      <div className="cm-view" style={{ top: `${view.top}%`, height: `${Math.max(3, view.h)}%` }} />
    </div>
  );
}
