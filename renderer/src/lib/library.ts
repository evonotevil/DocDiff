// 模板与往来稿（1.8）：渲染进程这边的数据结构、段落指纹和版本识别。持久化在主进程（electron/library.cjs）。
import type { Block, DocModel } from './model';
import { blockText, compareBlocks } from './model';
import type { Verdict } from './review';

const api = (typeof window !== 'undefined' && (window as any).api) || {};

export interface LibFile { sha: string; ext: string; size: number; name: string; mtime: number }
export interface TplVersion { id: string; label: string; added: number; file: LibFile; fp: number[]; orig?: string }
export interface Template { id: string; name: string; created: number; updated: number; versions: TplVersion[]; deleted?: number }
export type Side = 'ours' | 'theirs';
export interface ThreadVersion { id: string; n: number; side: Side; added: number; file: LibFile; fp: number[]; orig?: string; tpl?: { tid: string; vid: string } }
/** 一轮审阅的摘要：上一版 → 这一版里每处修订的条款、前后文字和结论（用来做“上轮”提示和条款历史） */
export interface RoundItem { clause: string | null; before: string; after: string; v?: Verdict; note?: string }
/** items 只在打开这份往来稿后才读进来（单独的文件），首页只用前面几个数字 */
export interface Round { a: string; b: string; pk: string; total: number; decided: number; updated: number; items?: RoundItem[] }
export interface Thread { id: string; name: string; created: number; updated: number; versions: ThreadVersion[]; rounds: Round[]; tpl?: { tid: string; vid: string }; archived?: number; deleted?: number;
  /** 上次打开的比较（beta.5）：可能不是相邻两版，如 V1 → V3。首页点这份往来稿时回到它 */
  last?: { a: string; b: string } }
export interface Library { v: 1; templates: Template[]; threads: Thread[] }

export const EMPTY_LIB: Library = { v: 1, templates: [], threads: [] };
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** 删除后 10 秒内可以撤销；之后（或下次启动时）真正清掉 */
export const UNDO_MS = 10_000;

// 段落指纹在索引里存成 base64 的 Uint32 数组，比 JSON 数字列表小一半、读得快
function encFp(fp: number[]): string { const u = new Uint32Array(fp); let s = ''; const b = new Uint8Array(u.buffer); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }
function decFp(x: any): number[] { if (Array.isArray(x)) return x; if (typeof x !== 'string') return []; const s = atob(x); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return Array.from(new Uint32Array(b.buffer)); }
const mapFp = (ix: Library, f: (x: any) => any): Library => ({
  ...ix,
  templates: ix.templates.map((t) => ({ ...t, versions: t.versions.map((v) => ({ ...v, fp: f(v.fp) })) })),
  threads: ix.threads.map((t) => ({ ...t, versions: t.versions.map((v) => ({ ...v, fp: f(v.fp) })) })),
});
/** 一份往来稿各轮的结论摘要（打开往来稿时读） */
export async function loadRounds(id: string): Promise<Round[]> {
  try { return (await api.libRounds?.(id)) || []; } catch { return []; }
}
export async function loadLibrary(): Promise<Library> {
  try {
    const ix: Library = mapFp({ ...EMPTY_LIB, ...((await api.libGet?.()) || {}) }, decFp);
    const now = Date.now();
    const stale = ix.templates.some((t) => t.deleted && now - t.deleted > UNDO_MS) || ix.threads.some((t) => t.deleted && now - t.deleted > UNDO_MS);
    if (stale) {
      ix.templates = ix.templates.filter((t) => !(t.deleted && now - t.deleted > UNDO_MS));
      ix.threads = ix.threads.filter((t) => !(t.deleted && now - t.deleted > UNDO_MS));
      await api.libSave?.(mapFp(ix, encFp), true);
    }
    return ix;
  } catch { return { ...EMPTY_LIB }; }
}
export async function saveLibrary(ix: Library, purge = false): Promise<{ ok: boolean; error?: string }> {
  try { return (await api.libSave?.(mapFp(ix, encFp), purge)) || { ok: false, error: 'no-storage' }; } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}
/** 把磁盘上的文件拷进库 */
export async function putFile(path: string): Promise<LibFile> {
  const r = await api.libPut?.(path);
  if (!r?.ok) throw new Error(r?.error || 'copy failed');
  return r.file;
}
/** 读库里的一个版本（原文件还在且没变时读原文件） */
export async function readVersion(v: { file: LibFile; orig?: string }) {
  return api.libRead?.({ sha: v.file.sha, ext: v.file.ext, name: v.file.name, orig: v.orig });
}

// ---------------- 段落指纹 ----------------
const norm = (s: string) => s.replace(/[\s　]+/g, '').toLowerCase();
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** 每段（表格行）去掉空白后的哈希，太短的段落（编号、空行）不算；去重、排序 */
export function fingerprint(doc: DocModel | Block[]): number[] {
  const blocks = Array.isArray(doc) ? doc : compareBlocks(doc);
  const s = new Set<number>();
  for (const b of blocks) { const t = norm(blockText(b)); if (t.length >= 4) s.add(fnv(t)); }
  return [...s].sort((a, b) => a - b);
}
/** v 的段落有多少比例原样出现在 doc 里（0–1） */
export function overlap(v: number[], doc: number[]): number {
  if (!v.length) return 0;
  let i = 0, j = 0, n = 0;
  while (i < v.length && j < doc.length) { if (v[i] === doc[j]) { n++; i++; j++; } else if (v[i] < doc[j]) i++; else j++; }
  return n / v.length;
}

/** 至少这么像才认作“同一份文件的另一版” */
export const MATCH_MIN = 0.5;
/** 两个候选相差不到这么多时，不替用户选 */
export const TIE = 0.02;

export interface Match<T> { item: T; score: number }
/** 按相同段落比例排序的候选 */
export function rank<T extends { fp: number[] }>(fp: number[], items: T[]): Match<T>[] {
  return items.map((item) => ({ item, score: overlap(item.fp, fp) })).sort((a, b) => b.score - a.score);
}
/** 识别结果：最像的那个，以及是否需要用户在几个候选里挑 */
export function pick<T extends { fp: number[] }>(fp: number[], items: T[]): { best: Match<T> | null; ranked: Match<T>[]; tie: boolean } {
  const ranked = rank(fp, items);
  const best = ranked[0] && ranked[0].score >= MATCH_MIN ? ranked[0] : null;
  const tie = !!best && ranked.length > 1 && best.score - ranked[1].score < TIE;
  return { best, ranked, tie };
}

/** 版本名：按文件修改时间“2026-03 版”，同月已有时用日期 */
export function versionLabel(mtime: number, taken: string[]): string {
  const d = new Date(mtime || Date.now());
  const p = (x: number) => String(x).padStart(2, '0');
  const m = `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  if (!taken.includes(m)) return m;
  const day = `${m}-${p(d.getDate())}`;
  if (!taken.includes(day)) return day;
  let i = 2; while (taken.includes(`${day} (${i})`)) i++;
  return `${day} (${i})`;
}
export const stemOf = (name: string) => name.replace(/\.(docx|pdf|txt|md)$/i, '');
export const live = <T extends { deleted?: number }>(xs: T[]) => xs.filter((x) => !x.deleted);

/** 往来稿默认打开哪一对：上次用过的（两版都还在）；否则最新一版和它的上一版 */
export function defaultPair(th: Thread): { a: ThreadVersion; b: ThreadVersion } | null {
  const vs = th.versions;
  const la = th.last && vs.find((v) => v.id === th.last!.a), lb = th.last && vs.find((v) => v.id === th.last!.b);
  if (la && lb) return { a: la, b: lb };
  const b = vs[vs.length - 1], a = vs[vs.length - 2];
  return a && b ? { a, b } : null;
}
export const roundOf = (th: Thread, a: string, b: string) => th.rounds.find((r) => r.a === a && r.b === b) || null;

/**
 * 首页认往来稿（beta.5）：每份往来稿取最像的一版；最像的两份往来稿分数太接近时不替用户选，返回两份候选。
 */
export function matchThreads(fp: number[], threads: Thread[]): { th: Thread; tv: ThreadVersion; score: number; alt?: { th: Thread; tv: ThreadVersion; score: number } } | null {
  const per = threads.map((th) => { const r = pick(fp, th.versions).best; return r ? { th, tv: r.item, score: r.score } : null; })
    .filter(Boolean).sort((a, b) => b!.score - a!.score) as { th: Thread; tv: ThreadVersion; score: number }[];
  if (!per.length) return null;
  const [a, b] = per;
  return b && a.score - b.score < TIE ? { ...a, alt: b } : a;
}
