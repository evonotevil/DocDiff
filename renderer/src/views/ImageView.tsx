import React, { useEffect, useRef, useState } from 'react';
import type { DocModel } from '../lib/model';
import { forEachPagePair, diffPage, PageDiff, PageRange, rangeKey, imageCacheKey, getCachedDiffs, setCachedDiffs, revokeUrls } from '../lib/pages';
import { t } from '../lib/i18n';
import { Notice } from '../components/Panel';

export type ImgMode = 'split' | 'diff' | 'fade' | 'slider';

/**
 * 逐页比较两份文档（1.7.3 起不再有 300 页上限）。range 为 null 时不开始：等用户在大文件确认里选好范围。
 * 1.7.4：状态里分开记“选的范围（n 页）”“已完成几页”“是否全部完成”；可以停止，停止或出错后保留已比较的页，可以从下一页继续。
 */
export type ImgStatus = 'running' | 'done' | 'stopped' | 'error';
export interface ImgState { loading: string | null; error?: string; diffs: PageDiff[]; status: ImgStatus; done: number; n: number; stop?: () => void; resume?: () => void }
export function useImagePages(A: DocModel, B: DocModel, threshold: number, range: PageRange | null): ImgState {
  const [state, setState] = useState<Omit<ImgState, 'stop' | 'resume'> & { key?: string }>({ loading: t('正在准备页面…'), diffs: [], status: 'running', done: 0, n: 0 });
  // 状态属于哪一组文档 + 范围：换了文档后第一次渲染时，不能把上一组的结果（和“全部 n 页已比较”）显示出来
  const curKey = A && B && range ? imageCacheKey(A, B, threshold, range) : '';
  const [resumeTick, setResumeTick] = useState(0);
  const stopRef = useRef(false);
  const keep = useRef<{ key: string; diffs: PageDiff[]; n: number } | null>(null);  // 停止 / 出错时已比较的页，继续时接着用
  const rk = range ? rangeKey(range) : '';
  useEffect(() => {
    if (!A || !B || !range) return;
    const ck = imageCacheKey(A, B, threshold, range);
    const hit = getCachedDiffs(ck);
    if (hit) { setState({ key: ck, loading: null, diffs: hit, status: 'done', done: hit.length, n: hit.length }); return; }
    let alive = true;
    stopRef.current = false;
    const prev = keep.current && keep.current.key === ck ? keep.current : null;
    if (keep.current && !prev) revokeUrls(keep.current.diffs);   // 换了文档 / 范围：之前停下的那批不再用
    keep.current = null;
    let settled = false;   // 这一轮的图片已经交给缓存或 keep；否则卸载时释放
    const diffs: PageDiff[] = prev ? prev.diffs.slice() : [];
    let n = prev?.n || 0;
    const lastPage = diffs.length ? diffs[diffs.length - 1].page! : range.from - 1;
    const sub: PageRange = { from: lastPage + 1, to: range.to };
    setState({ key: ck, loading: prev ? t('正在接着比较…') : t('正在排版文档…'), diffs: diffs.slice(), status: 'running', done: diffs.length, n });
    (async () => {
      try {
        let last = 0;
        let finished = true;
        await forEachPagePair(A, B, 1.5, sub, async (a, b, i, m) => {
          if (!n) n = m;                    // 第一次运行：范围内共几对页
          if ((globalThis as any).__DD_TEST_FAIL_PAGE === i) throw new Error('simulated page failure (test)');
          const d = await diffPage(a, b, threshold);
          diffs.push({ ...d, page: i });
          const k = diffs.length;
          // 边比边显示：每 8 页刷新一次列表，进度一直在动
          if (alive && (k - last >= 8 || k === n)) { last = k; setState({ key: ck, loading: t('正在比对第 {i}/{n} 页', { i: k, n }), diffs: diffs.slice(), status: 'running', done: k, n }); }
          await new Promise((r) => setTimeout(r, 0));
        }, () => { if (alive && stopRef.current) finished = false; return alive && !stopRef.current; });
        if (!alive) { revokeUrls(diffs); return; }
        if (!n) n = diffs.length;
        if (!finished || diffs.length < n) {
          keep.current = { key: ck, diffs, n }; settled = true;
          setState({ key: ck, loading: null, diffs: diffs.slice(), status: 'stopped', done: diffs.length, n });
          return;
        }
        setCachedDiffs(ck, diffs); settled = true;
        setState({ key: ck, loading: null, diffs, status: 'done', done: diffs.length, n });
      } catch (e: any) {
        if (!alive) { revokeUrls(diffs); return; }
        keep.current = { key: ck, diffs, n }; settled = true;
        setState({ key: ck, loading: null, error: String(e?.message || e), diffs: diffs.slice(), status: 'error', done: diffs.length, n: n || diffs.length + 1 });
      }
    })();
    // 切走时还没比完：这一轮已经生成的页面图片没人再用，释放掉（1.7.3 会一直留在内存里）
    return () => { alive = false; setTimeout(() => { if (!settled) revokeUrls(diffs); }, 0); };
  }, [A, B, threshold, rk, resumeTick]);
  const cur = state.key === curKey ? state : { loading: t('正在准备页面…'), diffs: [] as PageDiff[], status: 'running' as ImgStatus, done: 0, n: 0 };
  return {
    ...cur,
    stop: cur.status === 'running' ? () => { stopRef.current = true; } : undefined,
    resume: cur.status === 'stopped' || cur.status === 'error' ? () => setResumeTick((x) => x + 1) : undefined,
  };
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

export function ImageView({ state, mode, zoom, fade, setFade, slider, setSlider, showBoxes, onlyDiff, scrollRef, head, suspect }: {
  head?: React.ReactNode; suspect?: Set<number>; state: ImgState; mode: ImgMode; zoom: number; fade: number; setFade: (n: number) => void; slider: number; setSlider: (n: number) => void; showBoxes: boolean; onlyDiff: boolean; scrollRef: React.RefObject<HTMLDivElement>;
}) {
  if (state.error && !state.diffs.length) return <div className="empty-state">{head}<Notice tone="err" title={t('页面渲染失败')}>{state.error}</Notice>{state.resume && <button className="btn sm" onClick={state.resume}>{t('重试')}</button>}</div>;
  if (state.loading && !state.diffs.length) return <div className="empty-state"><div className="spinner" />{state.loading}{state.stop && <button className="btn sm plain" onClick={state.stop}>{t('停止比较')}</button>}</div>;
  const width = mode === 'split' ? `${Math.round(100 * zoom)}%` : `${Math.round(62 * zoom)}%`;
  return (
    <div className="scroll" ref={scrollRef}>
      {head}
      <div className="imgview">
        {state.diffs.map((d, i) => {
          if (onlyDiff && d.pct < 0.001) return null;
          const pg = d.page ?? i + 1;
          const sus = !!suspect?.has(pg) && d.pct < 0.001;
          const same = d.pct < 0.001 && !sus;
          const missing = d.aMissing || d.bMissing;
          return (
            <div className="pagepair" key={i} id={`page-${i}`} style={{ width, minWidth: mode === 'split' ? 600 : 320 }}>
              <div className="ptitle">
                <span>{t('第 {n} 页', { n: d.page ?? i + 1 })}</span>
                <span className={`pct ${same ? 'same' : 'diff'}`}>{missing ? t(d.aMissing ? '仅修改后文档有此页' : '仅原始文档有此页') : sus ? t('有文字没能读出，可能缺字，未必相同') : same ? t('无差异') : t('差异 {p}% · {n} 处区域', { p: d.pct < 0.01 ? '<0.01' : d.pct.toFixed(2), n: d.boxes.length })}</span>
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
        {state.loading && <div className="empty-state" style={{ height: 'auto' }}><div className="spinner" />{state.loading}{state.stop && <button className="btn sm plain" onClick={state.stop}>{t('停止比较')}</button>}</div>}
        {state.error && <Notice tone="err" title={t('第 {p} 页比较失败', { p: (state.diffs[state.diffs.length - 1]?.page ?? 0) + 1 })}>{state.error}</Notice>}
      </div>
    </div>
  );
}
