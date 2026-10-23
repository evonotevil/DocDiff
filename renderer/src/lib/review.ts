// 审阅决定：谁、什么时候、怎么判断的、为什么。按“两份文件的 SHA-256”保存在本机，
// 关掉应用、改比较设置都不会丢（见 insight.changeFingerprints）。
import type { Change } from './engine';
import { changeFingerprints } from './insight';
import { setPersistStatus } from './persist';

export type Verdict = 'a' | 'r' | 'h'; // 接受 / 拒绝 / 待议
export interface Dec { v?: Verdict; by: string; at: number; note?: string }
export type DecMap = Record<number, Dec>;

interface Stored { updated: number; total: number; decided: number; recs: Record<string, Dec> }
const LEGACY_KEY = 'reviews-v1';
const api = (window as any).api || {};

// 1.7.3：记录存到应用数据目录（每组比较一个文件，主进程原子写入）。
// 不再自动删除旧记录；写失败会显示警告，审阅栏标“未保存”。
let indexCache: Record<string, { updated: number; total: number; decided: number }> | null = null;
function readOne(pk: string): Stored | null {
  try { return api.reviewGet ? api.reviewGet(pk) : null; } catch { return null; }
}
function index() {
  if (!indexCache) { try { indexCache = api.reviewIndex ? api.reviewIndex() || {} : {}; } catch { indexCache = {}; } }
  return indexCache!;
}
let saveSeq = 0;
function writeOne(pk: string, st: Stored | null) {
  const ix = index();
  if (st) ix[pk] = { updated: st.updated, total: st.total, decided: st.decided }; else delete ix[pk];
  const seq = ++saveSeq;
  if (!api.reviewSave) { setPersistStatus('review', 'no-storage'); return; }
  Promise.resolve(api.reviewSave(pk, st))
    .then((r: any) => { if (seq === saveSeq || r?.ok === false) setPersistStatus('review', r?.ok === false ? r.error || 'unknown' : null); })
    .catch((e: any) => setPersistStatus('review', String(e?.message || e)));
}

/** 第一次运行 1.7.3：把旧版存在 localStorage 里的记录搬到应用数据目录，搬成功才删旧的 */
export function migrateLegacyReviews(): { moved: number; error?: string } {
  let raw: string | null = null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch {}
  if (!raw || !api.reviewImport) return { moved: 0 };
  let all: any;
  try { all = JSON.parse(raw); } catch { return { moved: 0 }; }
  const r = api.reviewImport(all);
  if (!r?.ok) { setPersistStatus('review', r?.error || 'import failed'); return { moved: 0, error: r?.error }; }
  try { localStorage.removeItem(LEGACY_KEY); } catch {}
  indexCache = null;
  return { moved: r.n || 0 };
}

/** 重新从磁盘读索引（清理记录之后） */
export function refreshReviewIndex() { indexCache = null; }

export const pairKey = (a?: string, b?: string) => (a && b ? `${a}|${b}` : '');

/** 读回这一对文件的决定，并按指纹对到当前的变更编号上；lost = 保存过、但这次的结果里找不到的决定数 */
export function loadDecisions(pk: string, changes: Change[]): { map: DecMap; lost: number } {
  if (!pk) return { map: {}, lost: 0 };
  const st = readOne(pk);
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
  const prev = readOne(pk)?.recs || {};
  const fps = changeFingerprints(changes);
  const recs: Record<string, Dec> = { ...prev };
  for (const c of changes) {
    const fp = fps.get(c.id)!;
    const d = map[c.id];
    if (d && (d.v || d.note)) recs[fp] = d; else delete recs[fp];
  }
  const decided = changes.filter((c) => map[c.id]?.v).length;
  writeOne(pk, Object.keys(recs).length ? { updated: Date.now(), total: changes.length, decided, recs } : null);
}

/** “最近比较”里显示的审阅进度 */
export function reviewProgress(pk: string): { total: number; decided: number } | null {
  const st = index()[pk];
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
