// 审阅决定：谁、什么时候、怎么判断的、为什么。按“两份文件的 SHA-256”保存在本机，
// 关掉应用、改比较设置都不会丢（见 insight.changeFingerprints）。
import type { Change } from './engine';
import { changeFingerprints } from './insight';
import { setPersistStatus } from './persist';

export type Verdict = 'a' | 'r' | 'h'; // 接受 / 拒绝 / 待议
export interface Dec { v?: Verdict; by: string; at: number; note?: string;
  /** 1.9.4：做决定时这处差异所在的条款（null = 开头部分）。认回时条款也要相同，同样的改动出现在别的条款里不会认错 */
  cl?: string | null;
  /** 1.9.4：PDF 段落读法更新后没能认回的旧决定：保留记录，但不再参与认回（以免以后挂到别的条款上） */
  stale?: number }
export type DecMap = Record<number, Dec>;

/** 审阅稿（1.8）：写在哪、我们上次写完时的修改时间和大小（用来判断有没有被别人改过） */
export interface DraftMeta { path: string; dir?: string; stat?: { mtime: number; size: number }; at: number }
interface Stored { updated: number; total: number; decided: number; recs: Record<string, Dec>; draft?: DraftMeta; /** 1.9.4：保存时的 PDF 段落读法版本（只有 PDF 有） */ pv?: number }
/** PDF 段落读法版本（和 pdf.ts 的 PDF_PARA_VER 一致；这里不引 pdf.ts，免得把 pdf.js 拉进来） */
export const PDF_PARA_VER = 2;
export interface LoadOpts { clauses?: Map<number, string | null>; pdf?: boolean }
/** PDF 段落读法更新后第一次打开：认回了几个、几个对不上 */
export interface Upgrade { kept: number; lost: number }
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
export function loadDecisions(pk: string, changes: Change[], opt: LoadOpts = {}): { map: DecMap; lost: number; upgrade?: Upgrade } {
  if (!pk) return { map: {}, lost: 0 };
  const st = readOne(pk);
  if (!st) return { map: {}, lost: 0 };
  const fps = changeFingerprints(changes);
  const base = (fp: string) => fp.replace(/#\d+$/, '');
  // PDF 段落读法变了（1.9.3 存的记录没有 pv）：旧记录要更严格地核对
  const upgrading = !!opt.pdf && (st.pv || 1) < PDF_PARA_VER && Object.values(st.recs).some((d) => d.v && !d.stale);
  const count = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) || 0) + 1); return m; };
  const curBase = count([...fps.values()].map(base));
  const recBase = count(Object.keys(st.recs).filter((k) => !st.recs[k].stale).map(base));
  const map: DecMap = {};
  const used = new Set<string>();
  for (const c of changes) {
    const fp = fps.get(c.id)!;
    const d = st.recs[fp];
    if (!d || d.stale) continue;
    if (d.cl !== undefined && opt.clauses) {
      // 1.9.4 起的记录：条款也要相同
      if (d.cl !== (opt.clauses.get(c.id) ?? null)) continue;
    } else if (upgrading) {
      // 旧记录没有条款：只有这段改前 / 改后文字在新旧结果里都只出现一次时才认回，出现多次一律算对不上（宁可重看，不挂到别的条款）
      const b = base(fp);
      if (curBase.get(b) !== 1 || recBase.get(b) !== 1) continue;
    }
    map[c.id] = d; used.add(fp);
  }
  const lost = Object.entries(st.recs).filter(([fp, d]) => d.v && !d.stale && !used.has(fp)).length;
  if (!upgrading) return { map, lost };
  // 记下这次的读法版本；没认回的旧决定标记为 stale（记录保留，但以后不再参与认回）
  const recs: Record<string, Dec> = {};
  for (const [fp, d] of Object.entries(st.recs)) recs[fp] = used.has(fp) || d.stale || !d.v ? d : { ...d, stale: PDF_PARA_VER };
  writeOne(pk, { ...st, recs, pv: PDF_PARA_VER });
  return { map, lost: 0, upgrade: { kept: Object.values(map).filter((d) => d.v).length, lost } };
}

/** 保存：当前结果里的决定覆盖同指纹的旧记录；当前结果里没有的旧记录原样保留（改回设置后还能认回来） */
export function saveDecisions(pk: string, changes: Change[], map: DecMap, opt: LoadOpts = {}) {
  if (!pk || !changes.length) return;
  const old = readOne(pk);
  const prev = old?.recs || {};
  const fps = changeFingerprints(changes);
  const recs: Record<string, Dec> = { ...prev };
  for (const c of changes) {
    const fp = fps.get(c.id)!;
    const d = map[c.id];
    // 1.9.4：同时记下所在条款
    if (d && (d.v || d.note)) { const { stale, ...rest } = d; recs[fp] = opt.clauses ? { ...rest, cl: opt.clauses.get(c.id) ?? null } : rest; }
    else {
      // 用户清掉了这一处的决定才删除；条款对不上（是别的条款的旧决定）或已标记 stale 的不动
      const o = prev[fp];
      if (o && !o.stale && (o.cl === undefined || !opt.clauses || o.cl === (opt.clauses.get(c.id) ?? null))) delete recs[fp];
    }
  }
  const decided = changes.filter((c) => map[c.id]?.v).length;
  const draft = draftCache.has(pk) ? draftCache.get(pk) || undefined : old?.draft;
  const pv = opt.pdf ? PDF_PARA_VER : old?.pv;
  writeOne(pk, Object.keys(recs).length || draft ? { updated: Date.now(), total: changes.length, decided, recs, ...(draft ? { draft } : {}), ...(pv ? { pv } : {}) } : null);
}

const draftCache = new Map<string, DraftMeta | null>();
export function getDraftMeta(pk: string): DraftMeta | null {
  if (!pk) return null;
  if (!draftCache.has(pk)) draftCache.set(pk, readOne(pk)?.draft || null);
  return draftCache.get(pk) || null;
}
export function setDraftMeta(pk: string, draft: DraftMeta | null) {
  if (!pk) return;
  draftCache.set(pk, draft);
  const st = readOne(pk) || { updated: Date.now(), total: 0, decided: 0, recs: {} };
  const next: Stored = { ...st, updated: Date.now() };
  if (draft) next.draft = draft; else delete next.draft;
  writeOne(pk, next);
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
