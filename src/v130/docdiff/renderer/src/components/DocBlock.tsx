import React from 'react';
import type { Block, Run } from '../lib/model';
import type { Tok } from '../lib/engine';

export interface RTok { tok: Tok; cls?: string; cid?: number; title?: string; style?: Run; mi?: number }

/** 文档原有的文字颜色 / 突出显示用 CSS 变量传递：浅色模式原样显示，深色模式由 CSS 调亮 / 调淡（导出 PDF 时仍是原色） */
export function runStyle(st: Run, withHl = true): React.CSSProperties {
  const s: any = {};
  if (st.b) s.fontWeight = 700;
  if (st.i) s.fontStyle = 'italic';
  const dec = [st.u && 'underline', st.s && 'line-through'].filter(Boolean).join(' ');
  if (dec) s.textDecoration = dec;
  if (st.sz) s.fontSize = `${Math.min(34, Math.max(7, st.sz)) * 1.3}px`;
  if (st.color && st.color !== '#000000') s['--rc'] = st.color;
  if (withHl && st.hl) s['--rh'] = st.hl;
  return s;
}

function TokSpan({ r, selCid }: { r: RTok; selCid?: number | null }) {
  const t = r.tok;
  if (t.sep || t.psep) return null;
  const st = r.style || t.st;
  const hasC = !!(st.color && st.color !== '#000000'), hasH = !r.cls && !!st.hl;
  const cls = [r.cls, hasC ? 'rc' : '', hasH ? 'rh' : '', r.cid !== undefined && r.cid === selCid ? 'sel-cid' : ''].filter(Boolean).join(' ') || undefined;
  if (st.img) {
    return <span className={['img-tok', cls].filter(Boolean).join(' ')} data-cid={r.cid} data-mi={r.mi} title={r.title || `图片 ${st.img}`}>🖼 图片</span>;
  }
  return <span className={cls} style={runStyle(st, !r.cls)} data-cid={r.cid} data-mi={r.mi} title={r.title}>{t.t}</span>;
}

export function BlockView({ block, toks, selCid, className, extra }: { block: Block; toks: RTok[]; selCid?: number | null; className?: string; extra?: React.ReactNode }) {
  const al = block.align && block.align !== 'left' ? ` al-${block.align}` : '';
  if (block.kind === 'tr') {
    const n = Math.max(1, block.cells?.length || 1);
    const cells: RTok[][] = Array.from({ length: n }, () => []);
    for (const r of toks) if (!r.tok.sep) (cells[Math.min(n - 1, r.tok.c)] ||= []).push(r);
    return (
      <div className={`blk tr ${className || ''}`} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {cells.map((c, i) => <div className="td" key={i}>{c.map((r, k) => <TokSpan key={k} r={r} selCid={selCid} />)}</div>)}
        {extra}
      </div>
    );
  }
  const body = toks.map((r, k) => <TokSpan key={k} r={r} selCid={selCid} />);
  if (block.kind === 'li') {
    return (
      <div className={`blk li${al} ${className || ''}`} style={{ paddingLeft: (block.level || 0) * 22 }}>
        <span className="mk">{block.marker || '•'}</span><span>{body}</span>{extra}
      </div>
    );
  }
  const k = block.kind === 'h' ? `h h${block.level || 1}` : 'p';
  return <div className={`blk ${k}${al} ${className || ''}`}>{body.length ? body : ' '}{extra}</div>;
}

/** 一侧可能由多个段落组成（段落被拆分/合并时），按 tok.blk 分组逐段渲染 */
export function BlockGroup({ blocks, toks, selCid, className }: { blocks: Block[]; toks: RTok[]; selCid?: number | null; className?: string }) {
  if (blocks.length === 1) return <BlockView block={blocks[0]} toks={toks} selCid={selCid} className={className} />;
  return (
    <>
      {blocks.map((b, k) => <BlockView key={k} block={b} toks={toks.filter((r) => (r.tok.blk || 0) === k)} selCid={selCid} className={className} />)}
    </>
  );
}
