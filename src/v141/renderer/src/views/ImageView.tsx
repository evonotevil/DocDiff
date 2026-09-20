import React, { useEffect, useRef, useState } from 'react';
import type { DocModel } from '../lib/model';
import { getPages, diffPage, PageDiff } from '../lib/pages';
import { t } from '../lib/i18n';

export type ImgMode = 'split' | 'diff' | 'fade' | 'slider';

export function useImagePages(A: DocModel, B: DocModel, threshold: number) {
  const [state, setState] = useState<{ loading: string | null; error?: string; diffs: PageDiff[] }>({ loading: t('正在准备页面…'), diffs: [] });
  useEffect(() => {
    if (!A || !B) return;
    let alive = true;
    setState({ loading: t('正在排版文档…'), diffs: [] });
    (async () => {
      try {
        const pa = await getPages(A, 1.5, (i, n) => alive && setState((s) => ({ ...s, loading: t('正在渲染原始文档第 {i}/{n} 页', { i, n }) })));
        const pb = await getPages(B, 1.5, (i, n) => alive && setState((s) => ({ ...s, loading: t('正在渲染修改后文档第 {i}/{n} 页', { i, n }) })));
        const n = Math.max(pa.length, pb.length);
        const diffs: PageDiff[] = [];
        for (let i = 0; i < n; i++) {
          if (!alive) return;
          setState((s) => ({ ...s, loading: t('正在比对第 {i}/{n} 页', { i: i + 1, n }) }));
          diffs.push(await diffPage(pa[i], pb[i], threshold));
          await new Promise((r) => setTimeout(r, 0));
        }
        if (alive) setState({ loading: null, diffs });
      } catch (e: any) {
        if (alive) setState({ loading: null, error: String(e?.message || e), diffs: [] });
      }
    })();
    return () => { alive = false; };
  }, [A, B, threshold]);
  return state;
}

function Boxes({ boxes, show }: { boxes: PageDiff['boxes']; show: boolean }) {
  if (!show) return null;
  return <>{boxes.map((b, i) => <div key={i} className="box" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />)}</>;
}

function Slider({ d, pos, setPos }: { d: PageDiff; pos: number; setPos: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    const el = ref.current!;
    const move = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); setPos(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100))); };
    move(e.nativeEvent);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <div className="overlay" ref={ref} onPointerDown={drag} style={{ cursor: 'ew-resize' }}>
      <img src={d.aUrl} draggable={false} />
      <div className="top" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}><img src={d.bUrl} draggable={false} /></div>
      <div className="slider-handle" style={{ left: `${pos}%` }} />
    </div>
  );
}

export function ImageView({ state, mode, zoom, fade, setFade, slider, setSlider, showBoxes, onlyDiff, scrollRef }: {
  state: ReturnType<typeof useImagePages>; mode: ImgMode; zoom: number; fade: number; setFade: (n: number) => void; slider: number; setSlider: (n: number) => void; showBoxes: boolean; onlyDiff: boolean; scrollRef: React.RefObject<HTMLDivElement>;
}) {
  if (state.error) return <div className="empty-state"><div className="err">{t('页面渲染失败')}：{state.error}</div></div>;
  if (state.loading && !state.diffs.length) return <div className="empty-state"><div className="spinner" />{state.loading}</div>;
  const width = mode === 'split' ? `${Math.round(100 * zoom)}%` : `${Math.round(62 * zoom)}%`;
  return (
    <div className="scroll" ref={scrollRef}>
      <div className="imgview">
        {state.diffs.map((d, i) => {
          if (onlyDiff && d.pct < 0.001) return null;
          const same = d.pct < 0.001;
          const missing = d.aMissing || d.bMissing;
          return (
            <div className="pagepair" key={i} id={`page-${i}`} style={{ width, minWidth: mode === 'split' ? 600 : 320 }}>
              <div className="ptitle">
                <span>{t('第 {n} 页', { n: i + 1 })}</span>
                <span className={`pct ${same ? 'same' : 'diff'}`}>{missing ? t(d.aMissing ? '仅修改后文档有此页' : '仅原始文档有此页') : same ? t('无差异') : t('差异 {p}% · {n} 处区域', { p: d.pct < 0.01 ? '<0.01' : d.pct.toFixed(2), n: d.boxes.length })}</span>
              </div>
              {mode === 'split' || missing ? (
                <div className="pp-split">
                  <div className="pimg">{d.aUrl ? <img src={d.aUrl} /> : <div className="nopage">{t('无对应页')}</div>}<Boxes boxes={d.boxes} show={showBoxes} /></div>
                  <div className="pimg right">{d.bUrl ? <img src={d.bUrl} /> : <div className="nopage">{t('无对应页')}</div>}<Boxes boxes={d.boxes} show={showBoxes} /></div>
                </div>
              ) : mode === 'diff' ? (
                <div className="pimg" style={{ margin: '0 auto' }}><img src={d.diffUrl} /><Boxes boxes={d.boxes} show={showBoxes} /></div>
              ) : mode === 'fade' ? (
                <div className="overlay">
                  <img src={d.aUrl} />
                  <div className="top" style={{ opacity: fade / 100 }}><img src={d.bUrl} /></div>
                </div>
              ) : (
                <Slider d={d} pos={slider} setPos={setSlider} />
              )}
            </div>
          );
        })}
        {state.loading && <div className="empty-state" style={{ height: 'auto' }}><div className="spinner" />{state.loading}</div>}
      </div>
    </div>
  );
}
