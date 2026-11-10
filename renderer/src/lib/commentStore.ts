// 1.9.5：每一对文件的批注状态（只在本机）：我方回复、手动改的作者归属、生成审阅稿时不带入的内部批注、
// “保留”（不再提示内部批注）、打开过的批注（审完最后一处修订时只提没打开过的）。
import { getSetting, setSetting } from './persist';
import type { Owner } from './comments';

export interface CmReply { text: string; at: number }
export interface CmState {
  replies: Record<string, CmReply>;
  own: Record<string, Owner>;
  /** 不带入审阅稿的批注（对方稿里的批注编号） */
  drop: string[];
  /** 选了“保留”：这一对文件不再提示内部批注 */
  keep?: boolean;
  seen: string[];
  at?: number;
}
const KEY = 'comments-v1';
const MAX = 300;
export const emptyCm = (): CmState => ({ replies: {}, own: {}, drop: [], seen: [] });

function all(): Record<string, CmState> { const v = getSetting<Record<string, CmState>>(KEY); return v && typeof v === 'object' ? v : {}; }
export function loadCm(pk: string): CmState {
  if (!pk) return emptyCm();
  const v = all()[pk];
  return v ? { ...emptyCm(), ...v } : emptyCm();
}
export function saveCm(pk: string, st: CmState) {
  if (!pk) return;
  const m = { ...all() };
  const empty = !Object.keys(st.replies).length && !Object.keys(st.own).length && !st.drop.length && !st.keep && !st.seen.length;
  if (empty) { if (!(pk in m)) return; delete m[pk]; }
  else m[pk] = { ...st, at: Date.now() };
  // 只留最近的 MAX 对
  const keys = Object.keys(m);
  if (keys.length > MAX) for (const k of keys.sort((x, y) => (m[x].at || 0) - (m[y].at || 0)).slice(0, keys.length - MAX)) delete m[k];
  setSetting(KEY, m);
}
