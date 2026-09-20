import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DocModel } from '../lib/model';
import type { DiffResult, Row } from '../lib/engine';
import { BlockGroup, RTok } from '../components/DocBlock';
import { t } from '../lib/i18n';

function sideToks(r: Row, side: 'a' | 'b'): RTok[] {
  const out: RTok[] = [];
  r.merged.forEach((m, mi) => {
    const t = m[side];
    if (!t) return;
    let cls: string | undefined;
    let title: string | undefined;
    if (r.kind === 'modified' || r.kind === 'format' || r.kind === 'equal') {
      if (m.op === -1 && !(m as any).wsOnly) cls = 't-del';
      else if (m.op === 1 && !(m as any).wsOnly) cls = 't-ins';
      else if (m.fmt) { cls = 't-fmt'; title = m.fmt; }
    }
    out.push({ tok: t, cls, cid: m.cid, title, mi });
  });
  return out;
}

/** 选中某处变更时滚动到它；skipRef 为 true 时跳过一次（由点击文档本身触发时，不要把页面拽走） */
export function useScrollToChange(ref: React.RefObject<HTMLElement>, selCid: number | null, rowOf: (cid: number) => number | undefined, onExpand?: (row: number) => void, skipRef?: React.MutableRefObject<boolean>) {
  useEffect(() => {
    if (selCid == null || !ref.current) return;
    if (skipRef?.current) { skipRef.current = false; return; }
    const row = rowOf(selCid);
    if (row !== undefined) onExpand?.(row);
    requestAnimationFrame(() => {
      const root = ref.current;
      if (!root) return;
      const el = (root.querySelector(`[data-cid="${selCid}"]`) || (row !== undefined ? root.querySelector(`[data-row="${row}"]`) : null)) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const cell = el.closest('[data-row]') as HTMLElement | null;
        if (cell) { cell.classList.remove('row-flash'); void cell.offsetWidth; cell.classList.add('row-flash'); }
      }
    });
  }, [selCid]);
}

// ---------- 行框选 / 对齐 ----------
type Side = 'a' | 'b';
interface Box { top: number; left: number; width: number; height: number }
interface LineHit { row: number; side: Side; span: HTMLElement; rect: DOMRect; twin?: { span: HTMLElement; rect: DOMRect } }
interface Align { row: number; side: Side; px: number }

/** span 在 y 处的那一行的矩形（一个词可能折行成多段） */
function lineRectAt(span: HTMLElement, y?: number): DOMRect | null {
  const rs = Array.from(span.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  if (!rs.length) return null;
  if (y === undefined) return rs[0];
  return rs.find((r) => y >= r.top - 2 && y <= r.bottom + 2) || rs.reduce((a, b) => (Math.abs(a.top - y) < Math.abs(b.top - y) ? a : b));
}

export function RichView({ A, B, res, selCid, onSel, hideUnchanged }: { A: DocModel; B: DocModel; res: DiffResult; selCid: number | null; onSel: (id: number) => void; hideUnchanged: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const richRef = useRef<HTMLDivElement>(null);
  const skipScroll = useRef(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<{ a?: Box; b?: Box; side: Side } | null>(null);
  const [pinned, setPinned] = useState<{ a?: Box; b?: Box; row: number; ok: boolean } | null>(null);
  const [align, setAlign] = useState<Align | null>(null);
  const [tick, setTick] = useState(0);
  const anchor = useRef<{ span: HTMLElement; top: number; idx: number } | null>(null);
  useEffect(() => { setExpanded(new Set()); setAlign(null); setPinned(null); setHover(null); }, [res]);
  const rowOfCid = (cid: number) => res.changes.find((c) => c.id === cid)?.row;
  useScrollToChange(ref, selCid, rowOfCid, (row) => { if (hideUnchanged && !expanded.has(row)) setExpanded((s) => new Set(s).add(row)); }, skipScroll);

  const rows = res.rows;

  // 把屏幕坐标换算成 .rich 内的坐标（随内容一起滚动）
  const toBox = useCallback((rect: DOMRect, cell: HTMLElement): Box => {
    const base = richRef.current!.getBoundingClientRect();
    const blk = (cell.querySelector('.blk') as HTMLElement) || cell;
    const br = blk.getBoundingClientRect();
    return { top: rect.top - base.top - 3, left: br.left - base.left - 8, width: br.width + 16, height: rect.height + 6 };
  }, []);

  /** 找到鼠标所在的那一行，以及另一侧对应的位置 */
  const hitTest = useCallback((x: number, y: number, target: HTMLElement): LineHit | null => {
    const cell = target.closest('.cell[data-side]') as HTMLElement | null;
    if (!cell || cell.classList.contains('ph')) return null;
    let span = target.closest('[data-mi]') as HTMLElement | null;
    if (!span) {
      const cr = (document as any).caretRangeFromPoint?.(x, y) as Range | null;
      const node = cr?.startContainer;
      const el = node ? (node.nodeType === 3 ? node.parentElement : (node as HTMLElement)) : null;
      span = el?.closest('[data-mi]') as HTMLElement | null;
      if (span && !cell.contains(span)) span = null;
    }
    if (!span) {
      // 行尾空白处：取这一格里离 y 最近的一个词
      let best: HTMLElement | null = null, bd = 1e9;
      cell.querySelectorAll<HTMLElement>('[data-mi]').forEach((s) => { const r = lineRectAt(s, y); if (r) { const d = Math.abs((r.top + r.bottom) / 2 - y); if (d < bd) { bd = d; best = s; } } });
      if (!best || bd > 30) return null;
      span = best;
    }
    const rect = lineRectAt(span, y);
    if (!rect) return null;
    const row = Number(cell.dataset.row), side = cell.dataset.side as Side;
    const other: Side = side === 'a' ? 'b' : 'a';
    const otherCell = richRef.current!.querySelector(`.cell[data-row="${row}"][data-side="${other}"]`) as HTMLElement | null;
    const hit: LineHit = { row, side, span, rect };
    if (otherCell && !otherCell.classList.contains('ph')) {
      const merged = rows[row].merged;
      const mi = Number(span.dataset.mi);
      // 在合并序列里找离它最近、且另一侧有内容的词（相同的词优先，其次是被替换的词）
      for (let d = 0; d < merged.length; d++) {
        for (const k of d === 0 ? [mi] : [mi - d, mi + d]) {
          const t = merged[k]?.[other];
          if (!t || t.sep || t.psep || t.ws) continue;
          const s2 = otherCell.querySelector(`[data-mi="${k}"]`) as HTMLElement | null;
          const r2 = s2 && lineRectAt(s2);
          if (s2 && r2) { hit.twin = { span: s2, rect: r2 }; break; }
        }
        if (hit.twin) break;
      }
    }
    return hit;
  }, [rows]);

  const boxesOf = (hit: LineHit) => {
    const cell = hit.span.closest('.cell') as HTMLElement;
    const out: { a?: Box; b?: Box } = { [hit.side]: toBox(hit.rect, cell) };
    if (hit.twin) out[hit.side === 'a' ? 'b' : 'a'] = toBox(hit.twin.rect, hit.twin.span.closest('.cell') as HTMLElement);
    return out;
  };

  const raf = useRef(0);
  const onMove = (e: React.MouseEvent) => {
    const { clientX: x, clientY: y } = e;
    const target = e.target as HTMLElement;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (!richRef.current) return;
      const hit = hitTest(x, y, target);
      setHover(hit ? { ...boxesOf(hit), side: hit.side } : null);
    });
  };

  const onClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.movetag, button')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // 正在选中文字，不做对齐
    const target = e.target as HTMLElement;
    const hit = hitTest(e.clientX, e.clientY, target);
    const el = target.closest('[data-cid]') as HTMLElement | null;
    if (el?.dataset.cid) { skipScroll.current = true; onSel(Number(el.dataset.cid)); }
    if (!hit) { setPinned(null); return; }
    if (!hit.twin) {
      // 另一侧没有可对齐的内容：只保留所选这一行
      setPinned({ ...boxesOf(hit), row: hit.row, ok: false });
      return;
    }
    // 去掉当前这一行已有的偏移，得到“自然位置”，再决定把哪一侧往下推
    const off = (s: Side) => (align && align.row === hit.row && align.side === s ? align.px : 0);
    const other: Side = hit.side === 'a' ? 'b' : 'a';
    const natMine = hit.rect.top - off(hit.side);
    const natTwin = hit.twin.rect.top - off(other);
    const diff = Math.round(natMine - natTwin);
    const rs = Array.from(hit.span.getClientRects());
    anchor.current = { span: hit.span, top: hit.rect.top, idx: Math.max(0, rs.findIndex((r) => Math.abs(r.top - hit.rect.top) < 1)) };
    setTick((t) => t + 1);
    setAlign(Math.abs(diff) < 2 ? null : diff > 0 ? { row: hit.row, side: other, px: diff } : { row: hit.row, side: hit.side, px: -diff });
    setPinned({ row: hit.row, ok: true }); // 位置在布局后重新计算
  };

  // 对齐后：保持点击的那一行在屏幕上不动，并重新计算框的位置（只在点击后执行一次）
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a || !ref.current || !richRef.current) return;
    anchor.current = null;
    if (!a.span.isConnected) return;
    const lineOf = () => { const rs = a.span.getClientRects(); return rs[a.idx] || rs[0]; };
    const r1 = lineOf();
    if (!r1) return;
    const delta = r1.top - a.top;
    if (Math.abs(delta) > 0.5) ref.current.scrollTop += delta;
    const r2 = lineOf();
    const hit = hitTest(r2.left + 1, r2.top + r2.height / 2, a.span);
    if (hit) setPinned({ ...boxesOf(hit), row: hit.row, ok: !!hit.twin });
  }, [tick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAlign(null); setPinned(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const jump = (row: number) => {
    const el = ref.current?.querySelector(`[data-row="${row}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el) { el.classList.remove('row-flash'); void el.offsetWidth; el.classList.add('row-flash'); }
  };

  // 隐藏未变化：每个变化前后保留 1 段
  const visible: (number | { fold: number[] })[] = [];
  if (hideUnchanged) {
    const keep = new Array(rows.length).fill(false);
    rows.forEach((r, i) => { if (r.kind !== 'equal') for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < rows.length) keep[k] = true; });
    let buf: number[] = [];
    rows.forEach((_, i) => {
      if (keep[i] || expanded.has(i)) { if (buf.length) { visible.push({ fold: buf }); buf = []; } visible.push(i); }
      else buf.push(i);
    });
    if (buf.length) visible.push({ fold: buf });
  } else rows.forEach((_, i) => visible.push(i));

  const n = visible.length;
  const frame = (b: Box | undefined, cls: string) => b && <div className={`line-frame ${cls}`} style={{ top: b.top, left: b.left, width: b.width, height: b.height }} />;
  return (
    <>
      <div className="scroll" ref={ref} onClick={onClick} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <div className="rich doc" ref={richRef}>
          <div className="colhead"><span className={`badge ${A.type}`}>{A.type.toUpperCase()}</span>{A.file.name}</div>
          <div className="colhead"><span className={`badge ${B.type}`}>{B.type.toUpperCase()}</span>{B.file.name}</div>
          {visible.map((v, vi) => {
            const edge = (vi === 0 ? ' first' : '') + (vi === n - 1 ? ' last' : '');
            if (typeof v !== 'number') {
              const expand = () => setExpanded((st) => { const x = new Set(st); v.fold.forEach((i) => x.add(i)); return x; });
              return (
                <React.Fragment key={'f' + vi}>
                  <div className={`cell fold-cell${edge}`}><button className="btn sm plain block" onClick={expand}>{t('⋯ {n} 个未变化的段落', { n: v.fold.length })}</button></div>
                  <div className={`cell fold-cell${edge}`}><button className="btn sm plain block" onClick={expand}>{t('⋯ {n} 个未变化的段落', { n: v.fold.length })}</button></div>
                </React.Fragment>
              );
            }
            const r = rows[v];
            const la = r.ai !== undefined ? (r.aList || [r.ai]).map((i) => A.blocks[i]) : null;
            const lb = r.bi !== undefined ? (r.bList || [r.bi]).map((i) => B.blocks[i]) : null;
            const whole = r.kind === 'removed' || r.kind === 'added' || r.kind.startsWith('moved');
            const selRow = selCid != null && (whole ? r.cids.includes(selCid) : r.blockCid === selCid) ? ' sel-row' : '';
            const sc = whole ? null : selCid;
            const spacer = (s: Side) => align && align.row === v && align.side === s ? <div className="align-spacer" style={{ height: align.px }} /> : null;
            const moveTag = (side: Side) => {
              if (r.kind === 'moved-from' && side === 'a') return <span className="movetag" onClick={(e) => { e.stopPropagation(); jump(r.moveRow!); }}>{t('已移动')} {r.moveRow! > v ? '↓' : '↑'}</span>;
              if (r.kind === 'moved-to' && side === 'b') return <span className="movetag" onClick={(e) => { e.stopPropagation(); jump(r.moveRow!); }}>{t(r.moveRow! < v ? '从上方移来' : '从下方移来')} {r.moveRow! < v ? '↑' : '↓'}</span>;
              return null;
            };
            return (
              <React.Fragment key={v}>
                <div className={`cell k-${r.kind}${edge}${la ? selRow : ' ph'}`} data-row={v} data-side="a">
                  {spacer('a')}
                  {la ? <BlockGroup blocks={la} toks={sideToks(r, 'a')} selCid={sc} className={r.blockNote ? 'bnote' : ''} /> : <div className="phline" />}
                  {moveTag('a')}
                </div>
                <div className={`cell k-${r.kind}${edge}${lb ? selRow : ' ph'}`} data-row={v} data-side="b">
                  {spacer('b')}
                  {lb ? <BlockGroup blocks={lb} toks={sideToks(r, 'b')} selCid={sc} className={r.blockNote ? 'bnote' : ''} /> : <div className="phline" />}
                  {moveTag('b')}
                  {r.blockNote && <span className="movetag fmt" data-cid={r.blockCid} title={r.blockNote}>{r.blockTag || t('样式变化')}</span>}
                </div>
              </React.Fragment>
            );
          })}
          {hover && frame(hover[hover.side], 'hover')}
          {hover && frame(hover[hover.side === 'a' ? 'b' : 'a'], 'hover twin')}
          {pinned && frame(pinned.a, pinned.ok ? 'pinned' : 'pinned lone')}
          {pinned && frame(pinned.b, pinned.ok ? 'pinned' : 'pinned lone')}
        </div>
      </div>
      {(align || pinned) && (
        <div className="align-chip">
          {t(pinned && !pinned.ok ? '另一侧没有可对应的内容，已标记所选行' : align ? '已把两侧对齐到所选行' : '这一行两侧已经对齐')}
          <button className="btn sm plain" onClick={() => { setAlign(null); setPinned(null); }}>{t(align ? '撤销对齐' : '取消标记')}</button>
        </div>
      )}
    </>
  );
}
