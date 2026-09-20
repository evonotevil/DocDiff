import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } from 'docx';
import type { Block, Run } from './model';
import type { Row } from './engine';

export type Decision = 'a' | 'r' | undefined;
export interface Piece { t: string; st: Run; mark?: 'del' | 'ins' | 'mdel' | 'mins'; cell: number; cid?: number; fmt?: string; sep?: boolean; blk: number }

/** 根据接受/拒绝状态计算某一行在修订稿中的显示内容；返回 null 表示整行不显示 */
export function redlinePieces(r: Row, dec: (cid?: number) => Decision, finalMode: boolean): { block: 'a' | 'b'; pieces: Piece[] } | null {
  const d = (cid?: number): Decision => { const x = dec(cid); return x ?? (finalMode ? 'a' : undefined); };
  const pieces: Piece[] = [];
  // 当前显示的是哪一侧的段落：用那一侧的段落编号给每个片段归段（删除的词跟随它前面的新段落）
  let side: 'a' | 'b' = 'b';
  let cur = 0;
  const track = (m: any) => { const t = m[side]; if (t) cur = t.blk || 0; };
  const push = (t: any, mark?: Piece['mark'], m?: any) => {
    if (!t || t.psep) return;
    if (!t.sep) pieces.push({ t: t.t, st: t.st, mark, cell: t.c, cid: m?.cid, fmt: m?.fmt, blk: cur });
    else pieces.push({ t: '', st: {} as Run, cell: t.c, sep: true, blk: cur });
  };
  switch (r.kind) {
    case 'equal': side = 'b'; r.merged.forEach((m) => { track(m); push(m.b, undefined, m); }); return { block: 'b', pieces };
    case 'format': {
      const blockDec = d(r.blockCid);
      side = blockDec === 'r' ? 'a' : 'b';
      r.merged.forEach((m) => { track(m); const x = m.fmt ? d(m.cid) : undefined; push(x === 'r' ? { ...m.b, st: m.a!.st } : m.b, undefined, x === undefined ? m : undefined); });
      return { block: side, pieces };
    }
    case 'removed': case 'moved-from': {
      const x = d(r.cids[0]);
      if (x === 'a') return null;
      side = 'a';
      r.merged.forEach((m) => { track(m); push(m.a, x === 'r' ? undefined : r.kind === 'removed' ? 'del' : 'mdel', m); });
      return { block: 'a', pieces };
    }
    case 'added': case 'moved-to': {
      const x = d(r.cids[0]);
      if (x === 'r') return null;
      side = 'b';
      r.merged.forEach((m) => { track(m); push(m.b, x === 'a' ? undefined : r.kind === 'added' ? 'ins' : 'mins', m); });
      return { block: 'b', pieces };
    }
    case 'modified': {
      // 段落结构：若全部被拒绝则按原文分段，否则按新文分段
      const allRejected = r.cids.length > 0 && r.cids.every((c) => d(c) === 'r');
      side = allRejected ? 'a' : 'b';
      for (const m of r.merged) {
        track(m);
        const x = d(m.cid);
        if (m.op === 0) push(m.fmt && x === 'r' ? { ...m.b, st: m.a!.st } : m.b, undefined, m.fmt && x === undefined ? m : undefined);
        else if ((m as any).wsOnly) { if (m.op === 1) push(m.b); }
        else if (m.op === -1) { if (x !== 'a') push(m.a, x === 'r' ? undefined : 'del', m); }
        else { if (x !== 'r') push(m.b, x === 'a' ? undefined : 'ins', m); }
      }
      return { block: side, pieces };
    }
  }
  return null;
}

function runOf(p: Piece): TextRun {
  const st = p.st || ({} as Run);
  const color = p.mark === 'del' ? 'C0341D' : p.mark === 'ins' ? '007A67' : p.mark === 'mdel' || p.mark === 'mins' ? '6E56CF' : st.color?.replace('#', '');
  const parts = p.t.split('\n');
  return new TextRun({
    children: parts.flatMap((x, i) => (i ? [new TextRun({ break: 1 }), x] : [x])) as any,
    bold: st.b, italics: st.i,
    underline: p.mark === 'ins' ? { type: 'single', color: '007A67' } as any : p.mark === 'mins' ? { type: 'double', color: '6E56CF' } as any : st.u ? {} : undefined,
    strike: p.mark === 'del' ? true : st.s,
    doubleStrike: p.mark === 'mdel' ? true : undefined,
    size: st.sz ? Math.round(st.sz * 2) : undefined,
    color,
  });
}

export async function buildDocx(rows: Row[], blocksA: Block[], blocksB: Block[], dec: (cid?: number) => Decision, finalMode: boolean, title: string): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];
  let tableRows: TableRow[] = [];
  const flushTable = () => {
    if (!tableRows.length) return;
    children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    tableRows = [];
  };
  for (const r of rows) {
    const rp = redlinePieces(r, dec, finalMode);
    if (!rp) continue;
    const list = rp.block === 'a' ? (r.aList || [r.ai!]) : (r.bList || [r.bi!]);
    for (let k = 0; k < list.length; k++) {
    const blk = rp.block === 'a' ? blocksA[list[k]] : blocksB[list[k]];
    if (!blk) continue;
    const pieces = rp.pieces.filter((p) => p.blk === k);
    if (blk.kind === 'tr') {
      const n = Math.max(1, blk.cells?.length || 1);
      const cells: Piece[][] = Array.from({ length: n }, () => []);
      pieces.forEach((p) => { if (p.t) cells[Math.min(n - 1, p.cell)].push(p); });
      tableRows.push(new TableRow({ children: cells.map((c) => new TableCell({ children: [new Paragraph({ children: c.map(runOf) })] })) }));
      continue;
    }
    flushTable();
    const runs = pieces.filter((p) => p.t).map(runOf);
    const heading = blk.kind === 'h' ? ([HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][(blk.level || 1) - 1]) : undefined;
    const alignment = blk.align === 'center' ? AlignmentType.CENTER : blk.align === 'right' ? AlignmentType.RIGHT : blk.align === 'justify' ? AlignmentType.JUSTIFIED : undefined;
    if (blk.kind === 'li') runs.unshift(new TextRun({ text: `${blk.marker || '•'}\t` }));
    children.push(new Paragraph({ children: runs, heading, alignment, indent: blk.kind === 'li' ? { left: 360 * ((blk.level || 0) + 1), hanging: 360 } : undefined }));
    }
  }
  flushTable();
  const doc = new Document({ creator: 'DocDiff', title, sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
