import React, { useEffect, useRef, useState } from 'react';
import type { Block } from '../lib/model';
import type { DiffResult, Row } from '../lib/engine';
import { useScrollToChange } from './RichView';
import { t } from '../lib/i18n';

// 把相邻的「同类」token 合成一个 span。1.4.3 只给富文本视图做了这件事（DocBlock.coalesce），
// 纯文本 / OCR 视图漏了，1200 行的文档会生成约 15 万个 span，首屏要 30 秒以上。
function toks(r: Row, side: 'a' | 'b', selCid: number | null, highlight: boolean) {
  const out: React.ReactNode[] = [];
  let buf = '', bufCls: string | undefined, bufCid: number | undefined, key = 0;
  const flush = () => {
    if (!buf) return;
    out.push(<span key={key++} className={bufCls} data-cid={bufCid}>{buf}</span>);
    buf = '';
  };
  for (const m of r.merged) {
    const tk = m[side];
    if (!tk) continue;
    if (tk.sep) { flush(); out.push(<span key={key++}>{'\t'}</span>); continue; }
    let cls = '';
    if (highlight && !(m as any).wsOnly) cls = m.op === -1 ? 't-del' : m.op === 1 ? 't-ins' : '';
    if (m.cid !== undefined && m.cid === selCid && m.op !== 0) cls += ' sel-cid';
    const cl = cls || undefined;
    const cid = m.op !== 0 ? m.cid : undefined;
    if (buf && cl === bufCls && cid === bufCid) { buf += tk.t; continue; }
    flush();
    bufCls = cl; bufCid = cid; buf = tk.t;
  }
  flush();
  return out;
}

export function PlainView({ A, B, res, selCid, onSel, layout, wrap, hideUnchanged, context = 3 }: {
  A: Block[]; B: Block[]; res: DiffResult; selCid: number | null; onSel: (id: number) => void;
  layout: 'split' | 'unified'; wrap: boolean; hideUnchanged: boolean; context?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  useEffect(() => setExpanded(new Set()), [res]);
  const rowOfCid = (cid: number) => res.changes.find((c) => c.id === cid)?.row;
  useScrollToChange(ref, selCid, rowOfCid, (row) => { if (hideUnchanged) setExpanded((s) => new Set(s).add(row)); });
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

  const kindA = (r: Row) => (r.kind === 'equal' || r.kind === 'format' ? '' : r.kind === 'added' || r.kind === 'moved-to' ? 'empty' : 'del') + (r.kind.startsWith('moved') ? ' mv' : '');
  const kindB = (r: Row) => (r.kind === 'equal' || r.kind === 'format' ? '' : r.kind === 'removed' || r.kind === 'moved-from' ? 'empty' : 'ins') + (r.kind.startsWith('moved') ? ' mv' : '');

  return (
    <div className="scroll" ref={ref} onClick={onClick}>
      <div className={`code selectable ${layout === 'unified' ? 'unified' : ''} ${wrap ? '' : 'nowrap'}`}>
        {visible.map((v, vi) => {
          if (typeof v !== 'number') {
            return <div className="crow" key={'f' + vi}><div className="fold" onClick={() => setExpanded((st) => { const x = new Set(st); v.fold.forEach((i) => x.add(i)); return x; })}>{t('⋯ 显示 {n} 行未变化内容', { n: v.fold.length })}</div></div>;
          }
          const r = rows[v];
          const la = r.ai !== undefined ? r.ai + 1 : '';
          const lb = r.bi !== undefined ? r.bi + 1 : '';
          if (layout === 'split') {
            return (
              <div className="crow" key={v} data-row={v}>
                <div className={`cside ${kindA(r)}`}><span className="ln">{la}</span><span className="ct">{r.ai !== undefined ? toks(r, 'a', selCid, r.kind === 'modified') : ''}</span></div>
                <div className={`cside ${kindB(r)}`}><span className="ln">{lb}</span><span className="ct">{r.bi !== undefined ? toks(r, 'b', selCid, r.kind === 'modified') : ''}</span></div>
              </div>
            );
          }
          // unified
          if (r.kind === 'equal' || r.kind === 'format') {
            return <div className="crow" key={v} data-row={v}><div className="cside"><span className="ln">{la}</span><span className="ln">{lb}</span><span className="ct">{toks(r, 'b', selCid, false)}</span></div></div>;
          }
          return (
            <div className="crow" key={v} data-row={v}>
              {r.ai !== undefined && <div className={`cside del${r.kind.startsWith('moved') ? ' mv' : ''}`}><span className="ln">{la}</span><span className="ln"></span><span className="ct">{toks(r, 'a', selCid, r.kind === 'modified')}</span></div>}
              {r.bi !== undefined && <div className={`cside ins${r.kind.startsWith('moved') ? ' mv' : ''}`}><span className="ln"></span><span className="ln">{lb}</span><span className="ct">{toks(r, 'b', selCid, r.kind === 'modified')}</span></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
