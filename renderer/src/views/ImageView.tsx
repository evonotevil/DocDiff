import React, { useEffect, useRef, useState } from 'react';
import type { DocModel } from '../lib/model';
import { forEachPagePair, diffPage, PageDiff, PageRange, rangeKey, imageCacheKey, getCachedDiffs, setCachedDiffs } from '../lib/pages';
import { t } from '../lib/i18n';
import { Notice } from '../components/Panel';

export type ImgMode = 'split' | 'diff' | 'fade' | 'slider';

/** 逐页比较两份文档（1.7.3 起不再有 300 页上限）。range 为 null 时不开始：等用户在大文件确认里选好范围。 */
export function useImagePages(A: DocModel, B: DocModel, threshold: number, range: PageRange | null) {
  const [state, setState] = useState<{ loading: string | null; error?: string; diffs: PageDiff[] }>({ loading: t('正在准备页面…'), diffs: [] });
  const rk = range ? rangeKey(range) : '';
  useEffect(() => {
    if (!A || !B || !range) return;
    const ck = imageCacheKey(A, B, threshold, range);
    const hit = getCachedDiffs(ck);
    if (hit) { setState({ loading: null, diffs: hit }); return; }
    let alive = true;
    setState({ loading: t('正在排版文档…'), diffs: [] });
    (async () => {
      try {
        const diffs: PageDiff[] = [];
        let last = 0;
        await forEachPagePair(A, B, 1.5, range, async (a, b, i, n) => {
          const d = await diffPage(a, b, threshold);
          diffs.push({ ...d, page: i });
          const k = i - range.from + 1;
          // 边比边显示：每 8 页刷新一次列表，进度一直在动
          if (alive && (k - last >= 8 || k === n)) { last = k; setState({ loading: t('正在比对第 {i}/{n} 页', { i: k, n }), diffs: diffs.slice() }); }
          await new Promise((r) => setTimeout(r, 0));
        }, () => alive);
        if (!alive) return;
        setCachedDiffs(ck, diffs);
        setState({ loading: null, diffs });
      } catch (e: any) {
        if (alive) setState({ loading: null, error: String(e?.message || e), diffs: [] });
      }
    })();
    return () => { alive = false; };
  }, [A, B, threshold, rk]);
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

export function ImageView({ state, mode, zoom, fade, setFade, slider, setSlider, showBoxes, onlyDiff, scrollRef, head }: {
  head?: React.ReactNode; state: ReturnType<typeof useImagePages>; mode: ImgMode; zoom: number; fade: number; setFade: (n: number) => void; slider: number; setSlider: (n: number) => void; showBoxes: boolean; onlyDiff: boolean; scrollRef: React.RefObject<HTMLDivElement>;
}) {
  if (state.error) return <div className="empty-state"><Notice tone="err" title={t('页面渲染失败')}>{state.error}</Notice></div>;
  if (state.loading && !state.diffs.length) return <div className="empty-state"><div className="spinner" />{state.loading}</div>;
  const width = mode === 'split' ? `${Math.round(100 * zoom)}%` : `${Math.round(62 * zoom)}%`;
  return (
    <div className="scroll" ref={scrollRef}>
      {head}
      <div className="imgview">
        {state.diffs.map((d, i) => {
          if (onlyDiff && d.pct < 0.001) return null;
          const same = d.pct < 0.001;
          const missing = d.aMissing || d.bMissing;
          return (
            <div className="pagepair" key={i} id={`page-${i}`} style={{ width, minWidth: mode === 'split' ? 600 : 320 }}>
              <div className="ptitle">
                <span>{t('第 {n} 页', { n: d.page ?? i + 1 })}</span>
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
