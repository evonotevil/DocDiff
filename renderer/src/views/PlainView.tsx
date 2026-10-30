import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Block } from '../lib/model';
import type { DiffResult, Row } from '../lib/engine';
import { useScrollToChange } from './RichView';
import { t } from '../lib/i18n';

// 把相邻的「同类」token 合成一个 span。1.4.3 只给富文本视图做了这件事（DocBlock.coalesce），
// 纯文本 / OCR 视图漏了，1200 行的文档会生成约 15 万个 span，首屏要 30 秒以上。
function toks(r: Row, side: 'a' | 'b', selCid: number | null, highlight: boolean, low?: Set<number>) {
  const out: React.ReactNode[] = [];
  let buf = '', bufCls: string | undefined, bufCid: number | undefined, key = 0, off = 0;
  const flush = () => {
    if (!buf) return;
    out.push(<span key={key++} className={bufCls} data-cid={bufCid}>{buf}</span>);
    buf = '';
  };
  for (const m of r.merged) {
    const tk = m[side];
    if (!tk) continue;
    if (tk.sep) { flush(); out.push(<span key={key++}>{'\t'}</span>); off += 1; continue; }
    let cls = '';
    if (highlight && !(m as any).wsOnly) cls = m.op === -1 ? 't-del' : m.op === 1 ? 't-ins' : '';
    if (m.cid !== undefined && m.cid === selCid && m.op !== 0) cls += ' sel-cid';
    // OCR：没认准的字标虚线（low 是这一行里低置信度字符的位置）
    if (low && !tk.ws) { for (let k = 0; k < tk.t.length; k++) if (low.has(off + k)) { cls += ' ocr-low'; break; } }
    off += tk.t.length;
    const cl = cls || undefined;
    const cid = m.op !== 0 ? m.cid : undefined;
    if (buf && cl === bufCls && cid === bufCid) { buf += tk.t; continue; }
    flush();
    bufCls = cl; bufCid = cid; buf = tk.t;
  }
  flush();
  return out;
}

const CH = 120;           // 每块的条目数
const ALL_BELOW = 600;    // 条目少于这么多时整篇挂载
const HCACHE = new WeakMap<object, { h: Map<string, number>; unit: number }>();
/** 估算一个条目占几行（还没量过的块用）：不换行时就是 1 行；换行时按字数粗估 */
function unitsOf(v: number | { fold: number[] }, rows: Row[], wrap: boolean) {
  if (typeof v !== 'number') return 1.4;
  if (!wrap) return 1;
  const r = rows[v];
  let n = 0;
  for (const m of r.merged) n += Math.max(m.a?.t.length || 0, m.b?.t.length || 0);
  return 1 + Math.floor(n / 60);
}

export function PlainView({ A, B, res, selCid, onSel, layout, wrap, hideUnchanged, context = 3, lowWords }: {
  A: Block[]; B: Block[]; res: DiffResult; selCid: number | null; onSel: (id: number) => void;
  layout: 'split' | 'unified'; wrap: boolean; hideUnchanged: boolean; context?: number; lowWords?: [Map<number, Set<number>>, Map<number, Set<number>>];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  useEffect(() => setExpanded(new Set()), [res]);
  const rowOfCid = (cid: number) => res.changes.find((c) => c.id === cid)?.row;
  useScrollToChange(ref, selCid, rowOfCid, (row) => { if (hideUnchanged) setExpanded((s) => new Set(s).add(row)); }, undefined, res.rows.length > 600);
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-cid]') as HTMLElement | null;
    if (el?.dataset.cid) onSel(Number(el.dataset.cid));
  };

  const rows = res.rows;
  const visible: (number | { fold: number[] })[] = [];
  if (hideUnchanged) {
    const keep = new Array(rows.length).fill(false);
    rows.forEach((r, i) => { if (r.kind !== 'equal' && r.kind !== 'format') for (let k = i - context; k <= i + context; k++) if (k >= 0 && k < rows.length) keep[k] = true; });
    let buf: number[] = [];
    rows.forEach((_, i) => {
      if (keep[i] || expanded.has(i)) { if (buf.length) { visible.push({ fold: buf }); buf = []; } visible.push(i); }
      else buf.push(i);
    });
    if (buf.length) visible.push({ fold: buf });
  } else rows.forEach((_, i) => visible.push(i));

  // 整行增删才铺浅底色；改了几个词的行只画左侧色条，颜色留给改动的词（组件标准 · 纯文本差异行）
  const whole = (r: Row) => (r.kind === 'added' || r.kind === 'removed' ? ' whole' : '');
  const kindA = (r: Row) => (r.kind === 'equal' || r.kind === 'format' ? '' : r.kind === 'added' || r.kind === 'moved-to' ? 'empty' : 'del' + whole(r)) + (r.kind.startsWith('moved') ? ' mv' : '');
  const kindB = (r: Row) => (r.kind === 'equal' || r.kind === 'format' ? '' : r.kind === 'removed' || r.kind === 'moved-from' ? 'empty' : 'ins' + whole(r)) + (r.kind.startsWith('moved') ? ' mv' : '');

  const renderItem = (v: number | { fold: number[] }, vi: number) => {
    if (typeof v !== 'number') {
      return <div className="crow" key={'f' + v.fold[0]}><div className="fold" onClick={() => setExpanded((st) => { const x = new Set(st); v.fold.forEach((i) => x.add(i)); return x; })}>{t('⋯ 显示 {n} 行未变化内容', { n: v.fold.length })}</div></div>;
    }
    const r = rows[v];
    const la = r.ai !== undefined ? r.ai + 1 : '';
    const lb = r.bi !== undefined ? r.bi + 1 : '';
    if (layout === 'split') {
      return (
        <div className="crow" key={v} data-row={v}>
          <div className={`cside ${kindA(r)}`}><span className="ln">{la}</span><span className="ct">{r.ai !== undefined ? toks(r, 'a', selCid, r.kind === 'modified', r.ai !== undefined ? lowWords?.[0].get(r.ai) : undefined) : ''}</span></div>
          <div className={`cside ${kindB(r)}`}><span className="ln">{lb}</span><span className="ct">{r.bi !== undefined ? toks(r, 'b', selCid, r.kind === 'modified', r.bi !== undefined ? lowWords?.[1].get(r.bi) : undefined) : ''}</span></div>
        </div>
      );
    }
    if (r.kind === 'equal' || r.kind === 'format') {
      return <div className="crow" key={v} data-row={v}><div className="cside"><span className="ln">{la}</span><span className="ln">{lb}</span><span className="ct">{toks(r, 'b', selCid, false, r.bi !== undefined ? lowWords?.[1].get(r.bi) : undefined)}</span></div></div>;
    }
    return (
      <div className="crow" key={v} data-row={v}>
        {r.ai !== undefined && <div className={`cside del${whole(r)}${r.kind.startsWith('moved') ? ' mv' : ''}`}><span className="ln">{la}</span><span className="ln"></span><span className="ct">{toks(r, 'a', selCid, r.kind === 'modified', r.ai !== undefined ? lowWords?.[0].get(r.ai) : undefined)}</span></div>}
        {r.bi !== undefined && <div className={`cside ins${whole(r)}${r.kind.startsWith('moved') ? ' mv' : ''}`}><span className="ln"></span><span className="ln">{lb}</span><span className="ct">{toks(r, 'b', selCid, r.kind === 'modified', r.bi !== undefined ? lowWords?.[1].get(r.bi) : undefined)}</span></div>}
      </div>
    );
  };

  // ---------- 按需挂载（beta.7 · 性能 6）：和富文本视图一样，只挂视口上一屏、下两屏的块，其余用量过（或估算）高度的占位 ----------
  const windowed = visible.length > ALL_BELOW;
  const chunks: { key: string; from: number; to: number; units: number }[] = [];
  if (windowed) {
    for (let i = 0; i < visible.length; i += CH) {
      const to = Math.min(visible.length, i + CH);
      let u = 0;
      for (let k = i; k < to; k++) u += unitsOf(visible[k], rows, wrap);
      const k0 = visible[i], k1 = visible[to - 1];
      chunks.push({ key: `${to - i}|${typeof k0 === 'number' ? k0 : 'f' + k0.fold[0]}|${typeof k1 === 'number' ? k1 : 'f' + k1.fold[0]}`, from: i, to, units: u });
    }
  }
  const codeRef = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState({ lo: 0, hi: 1 });
  const [width, setWidth] = useState(0);
  const [selSpan, setSelSpan] = useState<null | 'all' | { lo: number; hi: number }>(null);
  const [, setMeasured] = useState(0);
  const cache = (() => { let c = HCACHE.get(res); if (!c) { c = { h: new Map(), unit: 20 }; HCACHE.set(res, c); } return c; })();
  const hKey = (c: { key: string }) => `${width}|${layout}|${wrap ? 'w' : 'n'}|${c.key}`;
  const estH = (c: { key: string; units: number }) => cache.h.get(hKey(c)) ?? Math.round(c.units * cache.unit);
  const selRow = selCid != null ? rowOfCid(selCid) : undefined;
  const isMounted = (ci: number, c: { from: number; to: number }) => {
    if (selSpan === 'all') return true;
    if (ci >= win.lo && ci <= win.hi) return true;
    if (selSpan && ci >= selSpan.lo && ci <= selSpan.hi) return true;
    if (selRow !== undefined) for (let k = c.from; k < c.to; k++) if (visible[k] === selRow) return true;
    return false;
  };
  const recompute = useCallback(() => {
    const sc = ref.current, code = codeRef.current;
    if (!sc || !code) return;
    const kids = Array.from(code.querySelectorAll<HTMLElement>(':scope > [data-chunk]'));
    if (!kids.length) return;
    const top = sc.scrollTop - sc.clientHeight, bottom = sc.scrollTop + sc.clientHeight * 2;
    let lo = -1, hi = -1;
    kids.forEach((el, i) => { const y = el.offsetTop, h = el.offsetHeight; if (y + h >= top && y <= bottom) { if (lo < 0) lo = i; hi = i; } });
    if (lo < 0) lo = hi = kids.length - 1;
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
  // 选中文字：两端之间的块都挂上；跨不出去（全选）时挂载全文，复制的内容才完整
  useEffect(() => {
    const onSelChange = () => {
      const code = codeRef.current, sel = window.getSelection();
      if (!code || !sel || sel.isCollapsed || !sel.rangeCount) { setSelSpan((x) => (x ? null : x)); return; }
      const r = sel.getRangeAt(0);
      if (!r.intersectsNode(code)) { setSelSpan((x) => (x ? null : x)); return; }
      const ci = (n: Node | null) => { const el = n && (n.nodeType === 3 ? n.parentElement : (n as HTMLElement)); const c = el?.closest?.('[data-chunk]') as HTMLElement | null; return c && code.contains(c) ? Number(c.dataset.chunk) : null; };
      const a = ci(r.startContainer), b = ci(r.endContainer);
      if (a === null || b === null) { setSelSpan((x) => (x === 'all' ? x : 'all')); return; }
      const lo = Math.min(a, b), hi = Math.max(a, b);
      setSelSpan((x) => (x && x !== 'all' && x.lo === lo && x.hi === hi ? x : { lo, hi }));
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, []);
  // 量挂着的块，更新缓存和平均行高；第一次挂上后按真实位置重算一次窗口
  useLayoutEffect(() => {
    if (!windowed || !width || !codeRef.current) return;
    let changed = false, sumH = 0, sumU = 0;
    codeRef.current.querySelectorAll<HTMLElement>(':scope > [data-chunk]').forEach((el) => {
      if (el.dataset.ph) return;
      const c = chunks[Number(el.dataset.chunk)];
      if (!c) return;
      const h = el.offsetHeight, k = hKey(c);
      if (cache.h.get(k) !== h) { cache.h.set(k, h); changed = true; }
      sumH += h; sumU += c.units;
    });
    if (sumU > 0) { const u = sumH / sumU; if (Math.abs(u - cache.unit) / cache.unit > 0.05) { cache.unit = u; changed = true; } }
    if (changed) setMeasured((n) => n + 1);
  });
  useLayoutEffect(() => { if (windowed) recompute(); }, [windowed, res, hideUnchanged, layout, wrap, width]);

  return (
    <div className="scroll" ref={ref} onClick={onClick}>
      <div ref={codeRef} className={`code selectable ${layout === 'unified' ? 'unified' : ''} ${wrap ? '' : 'nowrap'}`}>
        {!windowed ? visible.map(renderItem) : chunks.map((c, ci) => isMounted(ci, c)
          ? <div key={c.key} data-chunk={ci} className="cchunk">{visible.slice(c.from, c.to).map((v, k) => renderItem(v, c.from + k))}</div>
          : <div key={c.key} data-chunk={ci} data-ph="1" className="cchunk ph" style={{ height: estH(c) }} />)}
      </div>
    </div>
  );
}
