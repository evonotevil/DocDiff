// 大文件先确认（1.7.3）：图像 / OCR 比较超过 300 页时，先说清楚页数和预计时间，
// 让用户选择比较全部，还是只比较一段页码。以前这里会静默截到前 300 页。
import React, { useState } from 'react';
import { t } from '../lib/i18n';
import type { PageRange } from '../lib/pages';
import { Mascot } from './Mascot';

/** 预计耗时（秒）：图像每对页约 0.4 秒；OCR 每页约 4 秒，两份都要识别 */
export function estimateSeconds(mode: 'image' | 'ocr', pages: number) {
  return mode === 'image' ? pages * 0.4 : pages * 2 * 4;
}
export function fmtDuration(sec: number) {
  if (sec < 90) return t('{n} 秒', { n: Math.max(1, Math.round(sec)) });
  const m = Math.round(sec / 60);
  if (m < 90) return t('{n} 分钟', { n: m });
  return t('{h} 小时 {m} 分钟', { h: Math.floor(m / 60), m: m % 60 });
}

export function PageRangeGate({ mode, pagesA, pagesB, initial, onConfirm }: {
  mode: 'image' | 'ocr'; pagesA: number; pagesB: number; initial?: PageRange; onConfirm: (r: PageRange) => void;
}) {
  const total = Math.max(pagesA, pagesB);
  const [from, setFrom] = useState(String(initial?.from ?? 1));
  const [to, setTo] = useState(String(initial?.to ?? Math.min(total, 300)));
  const f = parseInt(from, 10), e = parseInt(to, 10);
  const valid = Number.isFinite(f) && Number.isFinite(e) && f >= 1 && e >= f && e <= total;
  const verb = mode === 'image' ? t('逐页比较') : t('逐页识别');
  return (
    <div className="empty-state range-gate" role="region" aria-label={t('选择比较的页码范围')}>
      <Mascot mood="think" size={96} />
      <h2>{t('这两份文档一共 {n} 页', { n: total })}</h2>
      <div>
        {t('原始文档 {a} 页，修改后文档 {b} 页。', { a: pagesA, b: pagesB })}
        <br />
        {t('{v}全部页面预计需要约 {d}，期间可以随时取消。', { v: verb, d: fmtDuration(estimateSeconds(mode, total)) })}
      </div>
      <div className="gate-actions">
        <button type="button" className="btn primary big" onClick={() => onConfirm({ from: 1, to: total })}>{t('比较全部 {n} 页', { n: total })}</button>
        <div className="gate-or">{t('或者')}</div>
        <form className="gate-range" onSubmit={(ev) => { ev.preventDefault(); if (valid) onConfirm({ from: f, to: e }); }}>
          <label>{t('只比较第')}</label>
          <input className="inp num" type="number" min={1} max={total} value={from} onChange={(ev) => setFrom(ev.target.value)} aria-label={t('起始页')} />
          <label>{t('到')}</label>
          <input className="inp num" type="number" min={1} max={total} value={to} onChange={(ev) => setTo(ev.target.value)} aria-label={t('结束页')} />
          <label>{t('页')}</label>
          <button type="submit" className="btn" disabled={!valid}>{t('比较这些页')}</button>
        </form>
        {valid
          ? <small>{t('约 {d}', { d: fmtDuration(estimateSeconds(mode, e - f + 1)) })}</small>
          : <small className="danger-text">{t('请输入 1 到 {n} 之间的页码，起始页不大于结束页', { n: total })}</small>}
      </div>
    </div>
  );
}

/**
 * 页面模式顶部的一行：把“选了哪些页”和“做到哪一步”分开说（1.7.4）。
 * 1.7.3 只看选的范围，比较还在进行时就写“比较了全部 30 页”。
 * - pending：还没开始（OCR 等你点“开始识别”）——只说范围
 * - running：范围 + 已完成 x/n 页
 * - done：全部完成后才说“全部 n 页已比较”；只比一段时照旧写清其余页没有比较
 * - stopped / error：已完成几页、还有几页没有比较
 */
export type RangePhase = 'pending' | 'running' | 'done' | 'stopped' | 'error';
export interface RangeProgress { phase: RangePhase; done?: number; n?: number; ocr?: boolean; error?: string; onResume?: () => void }
export function RangeLine({ range, total, onChange, progress = { phase: 'done' } }: { range: PageRange; total: number; onChange?: () => void; progress?: RangeProgress }) {
  const all = range.from === 1 && range.to >= total;
  const to = Math.min(range.to, total);
  const scope = all ? t('全部 {n} 页', { n: total }) : t('第 {a}–{b} 页（共 {n} 页）', { a: range.from, b: to, n: total });
  const { phase, done = 0, n = to - range.from + 1, ocr } = progress;
  const left = Math.max(0, n - done);
  const doneText = ocr ? t('已识别 {d}/{n} 页（两份文档合计）', { d: done, n }) : t('已完成 {d}/{n} 页', { d: done, n });
  let text: string;
  let warn = !all;
  if (phase === 'pending') text = all ? t('比较范围：{s}', { s: scope }) : t('比较范围：{s}，其余页面不比较', { s: scope });
  else if (phase === 'running') text = t('比较范围：{s}；{d}', { s: scope, d: doneText });
  else if (phase === 'stopped') { warn = true; text = ocr ? t('已取消识别：{d}，没有生成比较结果', { d: doneText }) : t('已停止：比较范围 {s}，已完成 {d}/{n} 页，还有 {l} 页没有比较', { s: scope, d: done, n, l: left }); }
  else if (phase === 'error') { warn = true; text = ocr ? t('识别出错：{d}，没有生成比较结果', { d: doneText }) : t('比较出错停止：比较范围 {s}，已完成 {d}/{n} 页，还有 {l} 页没有比较', { s: scope, d: done, n, l: left }); }
  else text = all ? t(ocr ? '全部 {n} 页已识别并比较' : '全部 {n} 页已比较', { n: total }) : t('只比较了第 {a}–{b} 页，共 {n} 页；其余页面没有比较', { a: range.from, b: to, n: total });
  return (
    <div className={`range-line${warn ? ' partial' : ''}${phase === 'running' ? ' running' : ''}`} role="status" data-phase={phase}>
      {warn && <span className="rl-warn" aria-hidden="true">⚠</span>}
      {text}
      {progress.onResume && (phase === 'stopped' || phase === 'error') && <button type="button" className="link-btn" onClick={progress.onResume}>{phase === 'error' ? t('重试') : t('继续比较')}</button>}
      {onChange && <button type="button" className="link-btn" onClick={onChange}>{t('更改')}</button>}
    </div>
  );
}
