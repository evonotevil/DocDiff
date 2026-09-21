import React, { useRef } from 'react';
import type { DocModel } from '../lib/model';
import type { DiffResult } from '../lib/engine';
import { redlinePieces, Decision } from '../lib/exportDocx';
import { BlockGroup, RTok } from '../components/DocBlock';
import { useScrollToChange } from './RichView';

const CLS: Record<string, string> = { del: 'r-del', ins: 'r-ins', mdel: 'r-mdel', mins: 'r-mins' };

export function RedlineView({ A, B, res, selCid, onSel, decisions, innerRef }: {
  A: DocModel; B: DocModel; res: DiffResult; selCid: number | null; onSel: (id: number) => void;
  decisions: Record<number, 'a' | 'r'>; innerRef: React.RefObject<HTMLDivElement>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollToChange(ref, selCid, (cid) => res.changes.find((c) => c.id === cid)?.row);
  const dec = (cid?: number): Decision => (cid === undefined ? undefined : decisions[cid]);
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-cid]') as HTMLElement | null;
    if (el?.dataset.cid) onSel(Number(el.dataset.cid));
  };
  return (
    <div className="scroll" ref={ref} onClick={onClick}>
      <div className="redline-wrap">
        <div className="redline doc" ref={innerRef}>
          {res.rows.map((r, i) => {
            const rp = redlinePieces(r, dec, false);
            if (!rp) return null;
            const list = rp.block === 'a' ? (r.aList || [r.ai!]) : (r.bList || [r.bi!]);
            const blocks = list.map((i) => (rp.block === 'a' ? A.blocks[i] : B.blocks[i])).filter(Boolean);
            if (!blocks.length) return null;
            const toks: RTok[] = rp.pieces.map((p) => {
              let cls = p.mark ? CLS[p.mark] : undefined;
              if (!cls && p.fmt) cls = 'r-fmt';
              return { tok: { t: p.t, st: p.st, c: p.cell, key: '', ws: false, sep: p.sep, blk: p.blk }, cls, cid: cls ? p.cid : undefined, title: cls === 'r-fmt' ? p.fmt : undefined, style: p.st };
            });
            const pend = r.cids.length && dec(r.cids[0]) === undefined;
            const bcls = pend && (r.kind === 'removed') ? 'bdel' : pend && r.kind === 'added' ? 'bins' : pend && r.kind.startsWith('moved') ? 'bmove' : '';
            const whole = r.kind === 'removed' || r.kind === 'added' || r.kind.startsWith('moved');
            const selRow = selCid != null && (whole ? r.cids.includes(selCid) : r.blockCid === selCid);
            return <div key={i} data-row={i} className={selRow ? 'sel-row' : undefined}><BlockGroup blocks={blocks} toks={toks} selCid={whole ? null : selCid} className={bcls} /></div>;
          })}
        </div>
      </div>
    </div>
  );
}
