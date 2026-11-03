// 对对的本机记录（1.9）：图鉴里见过哪些、比较了多少份、第一次打开的日期、休息提醒。只存这台电脑，不上传。
// 计时类的频率限制也在这里：非用户触发的出场 30 秒内最多一次；同一种成功提示 30 秒内最多一次。
const KEY = 'docdiff.mascot.v1';
function today() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
interface Data { seen: string[]; compares: number; since: number; care?: { day: string; n: number; off?: boolean }; day?: { d: string; n: number } }

let data: Data = (() => {
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && Array.isArray(d.seen)) return { compares: 0, since: Date.now(), ...d }; } catch { /* 读不到就从头记 */ }
  return { seen: [], compares: 0, since: Date.now() };
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 存不下就算了，不影响使用 */ } };
save();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const mascotData = () => data;
/** 记进图鉴（第一次见到时返回 true） */
export function markSeen(id: string): boolean {
  if (data.seen.includes(id)) return false;
  data = { ...data, seen: [...data.seen, id] }; save(); emit();
  return true;
}
export const seen = (id: string) => data.seen.includes(id);
/** 每完成一次比较 +1，返回新的总数 */
export function countCompare(): number {
  const d = today(); const n = data.day?.d === d ? data.day.n + 1 : 1;
  data = { ...data, compares: data.compares + 1, day: { d, n } }; save(); emit(); return data.compares;
}
/** 今天比较了几份 */
export const todayCount = () => (data.day?.d === today() ? data.day.n : 0);
export function resetMascot() { data = { seen: [], compares: 0, since: data.since }; save(); emit(); }

// ---- 休息提醒：一天最多两次；“今天不提醒”当天不再出现 ----
export function careAllowed(): boolean { const c = data.care; return !c || c.day !== today() || (!c.off && c.n < 2); }
export function careShown() { const c = data.care?.day === today() ? data.care : { day: today(), n: 0 }; data = { ...data, care: { ...c, n: c.n + 1 } }; save(); }
export function careOffToday() { data = { ...data, care: { day: today(), n: 2, off: true } }; save(); }

// ---- 频率限制 ----
const last: Record<string, number> = {};
/** kind 这种出场在 ms 内只放行一次 */
export function gate(kind: string, ms = 30000): boolean {
  const now = Date.now();
  if (last[kind] && now - last[kind] < ms) return false;
  last[kind] = now;
  return true;
}
/** 非用户触发的出场（过半、完成一件事、里程碑……）：任意种类合计 30 秒内最多一次 */
export const ambient = (kind: string) => !(last.ambient && Date.now() - last.ambient < 30000) && gate(kind) && gate('ambient');
