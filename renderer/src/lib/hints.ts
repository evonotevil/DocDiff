// 往来稿（1.8）：上一轮的结论当作参考。保守匹配——宁可不提示，也不提示错。
import type { Change } from './engine';
import type { Verdict } from './review';
import type { Round, RoundItem, Thread } from './library';

const N = (s: string) => s.replace(/[\s　]+/g, '');
export type HintKind = 'reverted' | 'repeat' | 'related';
export interface Hint { kind: HintKind; item: RoundItem; round: Round; /** 可以一键沿用的结论 */ reuse?: Verdict }

/** 当前这一轮（a → b）之前的轮次，最近的在前 */
export function priorRounds(th: Thread, b: string): Round[] {
  const idx = (vid: string) => th.versions.findIndex((v) => v.id === vid);
  const bi = idx(b);
  return th.rounds.filter((r) => idx(r.b) >= 0 && idx(r.b) < bi).sort((x, y) => idx(y.b) - idx(x.b));
}

/**
 * 给这一轮的每处修订找上一轮的结论：
 * - reverted：上轮你拒绝了同样的修改，这一轮对方又改回来了（醒目，可一键沿用“拒绝”）；
 * - repeat：上轮出现过一模一样的修改，你已经有结论（可一键沿用）；
 * - related：同一条款上轮有结论，只作参考。
 */
export function hintsFor(changes: Change[], clauses: Map<number, string | null>, th: Thread, b: string): Map<number, Hint> {
  const out = new Map<number, Hint>();
  const rounds = priorRounds(th, b);
  if (!rounds.length) return out;
  // 先把上几轮有结论的处建成索引（最近一轮优先），每处修订只查一次表
  const exact = new Map<string, Hint>();   // before|after -> 提示（拒绝过的优先）
  const byClause = new Map<string, Hint>();
  for (const r of rounds) {
    for (const it of r.items || []) {
      if (!it.v) continue;
      const k = N(it.before) + '\u0000' + N(it.after);
      const prev = exact.get(k);
      if (it.v === 'r') { if (!prev || prev.kind !== 'reverted') exact.set(k, { kind: 'reverted', item: it, round: r, reuse: 'r' }); }
      else if (!prev) exact.set(k, { kind: 'repeat', item: it, round: r, reuse: it.v });
      if (it.clause && !byClause.has(it.clause)) byClause.set(it.clause, { kind: 'related', item: it, round: r });
    }
  }
  for (const c of changes) {
    if (c.kind === 'fmt' || c.kind === 'move') continue;
    const cb = N(c.before), ca = N(c.after);
    if (!cb && !ca) continue;
    const h = exact.get(cb + '\u0000' + ca);
    if (h) { out.set(c.id, h); continue; }
    const cl = clauses.get(c.id);
    if (cl && byClause.has(cl)) out.set(c.id, byClause.get(cl)!);
  }
  return out;
}

/** 条款历史：这个条款在各轮里的变化和结论（按时间先后） */
export function clauseHistory(th: Thread, clause: string | null, upTo: string): { round: Round; item: RoundItem }[] {
  if (!clause) return [];
  const idx = (vid: string) => th.versions.findIndex((v) => v.id === vid);
  const lim = idx(upTo);
  return th.rounds
    .filter((r) => idx(r.b) >= 0 && idx(r.b) < lim)
    .sort((x, y) => idx(x.b) - idx(y.b))
    .flatMap((r) => (r.items || []).filter((it) => it.clause === clause).map((item) => ({ round: r, item })));
}
