import React, { useRef } from 'react';
import type { DocModel } from '../lib/model';
import type { DiffResult } from '../lib/engine';
import type { DecMap } from '../lib/review';
import { redlinePieces, Decision } from '../lib/exportDocx';
import { BlockGroup, RTok } from '../components/DocBlock';
import { useScrollToChange } from './RichView';
import { fmtText } from '../lib/describe';
import { useSections, SecHead } from './sections';

const CLS: Record<string, string> = { del: 'r-del', ins: 'r-ins', mdel: 'r-mdel', mins: 'r-mins' };

export function RedlineView({ A, B, res, selCid, onSel, decisions, innerRef }: {
  A: DocModel; B: DocModel; res: DiffResult; selCid: number | null; onSel: (id: number) => void;
  decisions: DecMap; innerRef: React.RefObject<HTMLDivElement>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const secs = useSections(res);
  useScrollToChange(ref, selCid, (cid) => res.changes.find((c) => c.id === cid)?.row, (row) => secs.reveal(res.rows[row]?.sec));
  // 界面上：接受 → 新文字，拒绝 → 原文；待议和未处理都还是修订（待议多一层黄色底线）
  const dec = (cid?: number): Decision => { const v = cid === undefined ? undefined : decisions[cid]?.v; return v === 'a' || v === 'r' ? v : undefined; };
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-cid]') as HTMLElement | null;
    if (el?.dataset.cid) onSel(Number(el.dataset.cid));
  };
  return (
    <div className="scroll" ref={ref} onClick={onClick}>
      <div className="redline-wrap">
        <div className="redline doc" ref={innerRef}>
          {res.rows.map((r, i) => {
            const head = secs.headAt(i);
            if (secs.hidden(r.sec)) return head ? <SecHead key={'h' + i} {...head} /> : null;
            const rp = redlinePieces(r, dec, false);
            const body = (() => {
              if (!rp) return null;
              const list = rp.block === 'a' ? (r.aList || [r.ai!]) : (r.bList || [r.bi!]);
              const blocks = list.map((i) => (rp.block === 'a' ? A.blocks[i] : B.blocks[i])).filter(Boolean);
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
              return <div key={i} data-row={i} className={selRow ? 'sel-row' : undefined}><BlockGroup blocks={blocks} toks={toks} selCid={whole ? null : selCid} className={bcls} /></div>;
            })();
            return head ? <React.Fragment key={i}><SecHead {...head} />{body}</React.Fragment> : body;
          })}
        </div>
      </div>
    </div>
  );
}
