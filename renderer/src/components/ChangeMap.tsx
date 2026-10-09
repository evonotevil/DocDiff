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
      const rowEls = Array.from(sc.querySelectorAll('[data-row]')) as HTMLElement[];
      const idxOf = new Map<number, number>();
      rowEls.forEach((el, i) => idxOf.set(Number(el.dataset.row), i));

      // 纯文本 / 修订审阅的行上有 content-visibility: auto。对这类元素取矩形会"逐行"单独触发布局：
      // 实测 1200 行、516 处差异要 6.5 秒，地图画不出来（刻度数为 0），还把帧拖到 6 秒以上。
      // 所以差异多的时候改成按行号等距估算 —— 这些视图行高本来就基本一致，而 content-visibility
      // 估算滚动高度用的也是同一个假设，minimap 的精度完全够。判据只看样式，不做运行时计时：
      // 第一次测量本身就会把布局烤热，之后再计时恒为 0，探不出来。
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
          if (i === undefined) continue;                 // 被折叠起来的行不画
          out.push({ id: c.id, kind: c.kind, top: (i / n) * 100, h });
        }
      }
      setTicks(out);
      setView({ top: (sc.scrollTop / H) * 100, h: (sc.clientHeight / H) * 100 });
    };
    const onScroll = () => { const H = sc.scrollHeight || 1; setView({ top: (sc.scrollTop / H) * 100, h: (sc.clientHeight / H) * 100 }); };
    // 一次 measure 要对全部差异取 getBoundingClientRect（大文档约 20ms），做节流避免连续重排
    let pending = 0, timer: any = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(measure); }, 120);
    };
    const t1 = setTimeout(measure, 60), t2 = setTimeout(measure, 600);
    const ro = new ResizeObserver(schedule);
    ro.observe(sc);
    if (sc.firstElementChild) ro.observe(sc.firstElementChild);
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(timer); cancelAnimationFrame(pending); ro.disconnect(); sc.removeEventListener('scroll', onScroll); };
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
