import React, { useEffect, useRef, useState } from 'react';
import type { Row } from '../lib/engine';
import type { DocModel } from '../lib/model';
import type { DiffResult } from '../lib/engine';
import type { DecMap } from '../lib/review';
import { redlinePieces, Decision } from '../lib/exportDocx';
import { BlockGroup, RTok } from '../components/DocBlock';
import { useScrollToChange } from './RichView';
import { fmtText } from '../lib/describe';
import { useSections, SecHead } from './sections';

const STEP = 60;
const CLS: Record<string, string> = { del: 'r-del', ins: 'r-ins', mdel: 'r-mdel', mins: 'r-mins' };

export function RedlineView({ A, B, res, selCid, onSel, decisions, innerRef }: {
  A: DocModel; B: DocModel; res: DiffResult; selCid: number | null; onSel: (id: number) => void;
  decisions: DecMap; innerRef: React.RefObject<HTMLDivElement>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const secs = useSections(res);
  // 分批挂载（1.7.4）：先挂前 STEP 段，之后每帧再挂一批，直到全文。一次挂完整篇时，十几页 PDF 的渲染 + 排版是一个 0.4 秒以上的整块任务。
  // 跳到还没挂上的段落时，直接挂到那一段之后。
  const [limit, setLimit] = useState(STEP);
  useEffect(() => setLimit(STEP), [res]);
  useEffect(() => {
    if (limit >= res.rows.length) return;
    const id = requestAnimationFrame(() => setTimeout(() => setLimit((l) => l + STEP), 0));
    return () => cancelAnimationFrame(id);
  }, [limit, res]);
  useScrollToChange(ref, selCid, (cid) => res.changes.find((c) => c.id === cid)?.row, (row) => { secs.reveal(res.rows[row]?.sec); setLimit((l) => Math.max(l, row + STEP)); });
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-cid]') as HTMLElement | null;
    if (el?.dataset.cid) onSel(Number(el.dataset.cid));
  };
  return (
    <div className="scroll" ref={ref} onClick={onClick}>
      <div className="redline-wrap">
        <div className="redline doc" ref={innerRef}>
          {res.rows.map((r, i) => {
            if (i >= limit) return null;
            const head = secs.headAt(i);
            if (secs.hidden(r.sec)) return head ? <SecHead key={'h' + i} {...head} /> : null;
            const body = <RedlineRow key={i} i={i} r={r} A={A} B={B} decisions={decisions} selCid={selCid} />;
            return head ? <React.Fragment key={i}><SecHead {...head} />{body}</React.Fragment> : body;
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * 一段修订（1.7.4 拆出来并按值比较）：只有这一段涉及的差异的结论、或选中状态变了才重新渲染。
 * 以前切到修订审阅时整篇会连续渲染 3–4 次（选中第一处、读入结论…），十几页 PDF 每次约 150 ms。
 */
const RedlineRow = React.memo(function RedlineRow({ i, r, A, B, decisions, selCid }: { i: number; r: Row; A: DocModel; B: DocModel; decisions: DecMap; selCid: number | null }) {
  // 界面上：接受 → 新文字，拒绝 → 原文；待议和未处理都还是修订（待议多一层黄色底线）
  const dec = (cid?: number): Decision => { const v = cid === undefined ? undefined : decisions[cid]?.v; return v === 'a' || v === 'r' ? v : undefined; };
  const rp = redlinePieces(r, dec, false);
  if (!rp) return null;
  const list = rp.block === 'a' ? (r.aList || [r.ai!]) : (r.bList || [r.bi!]);
  const blocks = list.map((k) => (rp.block === 'a' ? A.blocks[k] : B.blocks[k])).filter(Boolean);
  if (!blocks.length) return null;
  const toks: RTok[] = rp.pieces.filter((p) => !p.anchor).map((p) => {
    let cls = p.mark ? CLS[p.mark] : undefined;
    if (!cls && p.fmt) cls = 'r-fmt';
    if (cls && p.cid !== undefined && decisions[p.cid]?.v === 'h') cls += ' r-hold';
    return { tok: { t: p.t, st: p.st, c: p.cell, key: '', ws: false, sep: p.sep, blk: p.blk }, cls, cid: cls ? p.cid : undefined, title: p.fmt && cls?.startsWith('r-fmt') ? fmtText(p.fmt) : undefined, style: p.st };
  });
  const pend = r.cids.length && dec(r.cids[0]) === undefined;
  const bcls = pend && (r.kind === 'removed') ? 'bdel' : pend && r.kind === 'added' ? 'bins' : pend && r.kind.startsWith('moved') ? 'bmove' : '';
  const whole = r.kind === 'removed' || r.kind === 'added' || r.kind.startsWith('moved');
  const selRow = selCid != null && (whole ? r.cids.includes(selCid) : r.blockCid === selCid);
  return <div data-row={i} className={selRow ? 'sel-row' : undefined}><BlockGroup blocks={blocks} toks={toks} selCid={whole ? null : selCid} className={bcls} /></div>;
}, (a, b) => {
  if (a.r !== b.r || a.A !== b.A || a.B !== b.B || a.i !== b.i) return false;
  const ids = b.r.blockCid !== undefined ? [...b.r.cids, b.r.blockCid] : b.r.cids;
  // 选中状态只影响包含这处差异的段落
  const relA = a.selCid != null && ids.includes(a.selCid) ? a.selCid : null;
  const relB = b.selCid != null && ids.includes(b.selCid) ? b.selCid : null;
  if (relA !== relB) return false;
  if (a.decisions === b.decisions) return true;
  for (const id of ids) if (a.decisions[id]?.v !== b.decisions[id]?.v) return false;
  return true;
});
