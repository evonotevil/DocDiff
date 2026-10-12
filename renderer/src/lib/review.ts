// 审阅决定：谁、什么时候、怎么判断的、为什么。按“两份文件的 SHA-256”保存在本机，
// 关掉应用、改比较设置都不会丢（见 insight.changeFingerprints）。
import type { Change } from './engine';
import { changeFingerprints } from './insight';

export type Verdict = 'a' | 'r' | 'h'; // 接受 / 拒绝 / 待议
export interface Dec { v?: Verdict; by: string; at: number; note?: string }
export type DecMap = Record<number, Dec>;

interface Stored { updated: number; total: number; decided: number; recs: Record<string, Dec> }
const KEY = 'reviews-v1';
const MAX = 120;

function readAll(): Record<string, Stored> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function writeAll(all: Record<string, Stored>) {
  const keys = Object.keys(all);
  if (keys.length > MAX) keys.sort((a, b) => all[a].updated - all[b].updated).slice(0, keys.length - MAX).forEach((k) => delete all[k]);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
}

export const pairKey = (a?: string, b?: string) => (a && b ? `${a}|${b}` : '');

/** 读回这一对文件的决定，并按指纹对到当前的变更编号上；lost = 保存过、但这次的结果里找不到的决定数 */
export function loadDecisions(pk: string, changes: Change[]): { map: DecMap; lost: number } {
  if (!pk) return { map: {}, lost: 0 };
  const st = readAll()[pk];
  if (!st) return { map: {}, lost: 0 };
  const fps = changeFingerprints(changes);
  const map: DecMap = {};
  const used = new Set<string>();
  for (const c of changes) {
    const fp = fps.get(c.id)!;
    const d = st.recs[fp];
    if (d) { map[c.id] = d; used.add(fp); }
  }
  const lost = Object.entries(st.recs).filter(([fp, d]) => d.v && !used.has(fp)).length;
  return { map, lost };
}

/** 保存：当前结果里的决定覆盖同指纹的旧记录；当前结果里没有的旧记录原样保留（改回设置后还能认回来） */
export function saveDecisions(pk: string, changes: Change[], map: DecMap) {
  if (!pk || !changes.length) return;
  const all = readAll();
  const prev = all[pk]?.recs || {};
  const fps = changeFingerprints(changes);
  const recs: Record<string, Dec> = { ...prev };
  for (const c of changes) {
    const fp = fps.get(c.id)!;
    const d = map[c.id];
    if (d && (d.v || d.note)) recs[fp] = d; else delete recs[fp];
  }
  const decided = changes.filter((c) => map[c.id]?.v).length;
  if (!Object.keys(recs).length) delete all[pk];
  else all[pk] = { updated: Date.now(), total: changes.length, decided, recs };
  writeAll(all);
}

/** “最近比较”里显示的审阅进度 */
export function reviewProgress(pk: string): { total: number; decided: number } | null {
  const st = readAll()[pk];
  return st && st.total ? { total: st.total, decided: st.decided } : null;
}

/** 姓名 → 缩写：中文取姓，英文取首字母 */
export function initialsOf(name: string): string {
  const n = name.trim();
  if (!n) return '';
  if (/^[㐀-鿿]/.test(n)) return n[0];
  const parts = n.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}
