import React, { useEffect, useRef, useState } from 'react';
import type { Change } from '../lib/engine';
import { t } from '../lib/i18n';

const COLOR: Record<string, string> = { del: '#ff4b4b', ins: '#58cc02', mod: '#ffc800', fmt: '#ff9600', move: '#ce82ff' };

/** 滚动条旁的“差异地图”：每处差异一条彩色刻度，点击跳转；灰色框是当前可见区域 */
export function ChangeMap({ changes, selCid, onSel, dep, bottom = 6 }: { changes: Change[]; selCid: number | null; onSel: (id: number) => void; dep: any; bottom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ticks, setTicks] = useState<{ id: number; kind: string; top: number; h: number }[]>([]);
  const [view, setView] = useState({ top: 0, h: 100 });
  useEffect(() => {
    const host = ref.current?.parentElement;
    const sc = host?.querySelector('.scroll') as HTMLElement | null;
    if (!sc) return;
    const measure = () => {
      const H = sc.scrollHeight || 1;
      const base = sc.getBoundingClientRect().top - sc.scrollTop;
      const out: { id: number; kind: string; top: number; h: number }[] = [];
      for (const c of changes) {
        const el = (sc.querySelector(`[data-cid="${c.id}"]`) || sc.querySelector(`[data-row="${c.row}"]`)) as HTMLElement | null;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        out.push({ id: c.id, kind: c.kind, top: ((r.top - base) / H) * 100, h: Math.max(0.4, (r.height / H) * 100) });
      }
      setTicks(out);
      setView({ top: (sc.scrollTop / H) * 100, h: (sc.clientHeight / H) * 100 });
    };
    const onScroll = () => { const H = sc.scrollHeight || 1; setView({ top: (sc.scrollTop / H) * 100, h: (sc.clientHeight / H) * 100 }); };
    const t1 = setTimeout(measure, 60), t2 = setTimeout(measure, 600);
    const ro = new ResizeObserver(() => measure());
    ro.observe(sc);
    if (sc.firstElementChild) ro.observe(sc.firstElementChild);
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(t1); clearTimeout(t2); ro.disconnect(); sc.removeEventListener('scroll', onScroll); };
  }, [changes, dep]);
  const jump = (e: React.MouseEvent) => {
    const host = ref.current?.parentElement;
    const sc = host?.querySelector('.scroll') as HTMLElement | null;
    if (!sc || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const pct = (e.clientY - r.top) / r.height;
    // 选中离点击位置最近的差异
    let best: number | null = null, bd = 1e9;
    for (const t of ticks) { const d = Math.abs(t.top / 100 - pct); if (d < bd) { bd = d; best = t.id; } }
    if (best !== null && bd < 0.03) onSel(best);
    else sc.scrollTo({ top: pct * sc.scrollHeight - sc.clientHeight / 2, behavior: 'smooth' });
  };
  if (!changes.length) return null;
  return (
    <div className="changemap" ref={ref} onClick={jump} title={t('差异地图：点击跳转')} style={{ bottom }}>
      <div className="cm-view" style={{ top: `${view.top}%`, height: `${Math.max(3, view.h)}%` }} />
      {ticks.map((t) => (
        <div key={t.id} className={`cm-tick ${t.id === selCid ? 'on' : ''}`} style={{ top: `${t.top}%`, height: `max(3px, ${t.h}%)`, background: COLOR[t.kind] }} />
      ))}
    </div>
  );
}
