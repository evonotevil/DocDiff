// 审阅稿的同步（1.8）：决定一变，约 0.25 秒后在 Worker 里重写一份，交给主进程原子写盘。
// 状态：没有 / 保存中 / 已保存 / Word 正在用 / 被改过 / 被移走 / 写不进这个文件夹 / 出错。
// 绝不覆盖别人改过的审阅稿：主进程按我们上次写完时的修改时间和大小比对，不一致就停下来问。
// 1.9.2：离开界面（新建比较、切版本、退出）时，还没写进审阅稿的决定不再丢掉：
//   - 实例被替换后转到后台，立刻把最后一批决定写完（不等 0.25 秒合并）；
//   - 同一份审阅稿（同一对文件）的生成和写盘按顺序排队，跨实例也一样，旧快照不会盖掉新决定；
//   - 写不进去（Word 占用、被改过、出错、来不及）时记一笔“待补写”，提示用户；下次打开这一对文件时自动补写。
import { getSetting, setSetting } from '../persist';
import type { Plan } from './plan';
import type { Decision, Reason } from './ooxml';
import type { DraftReq, DraftRes } from './draft.worker';
import { getDraftMeta, setDraftMeta, type DraftMeta } from '../review';
import { isEn } from '../i18n';

const api = (window as any).api || {};

export type DraftKind = 'none' | 'saving' | 'saved' | 'locked' | 'modified' | 'gone' | 'nowrite' | 'error';
export interface DraftState {
  s: DraftKind;
  path?: string;
  at?: number;
  unwritten: { cid: number; reason: Reason }[];
  prior: number;
  error?: string;
  /** 最近一次写入用时（毫秒，含 Worker 和写盘），以及各段用时 */
  ms?: number;
  parts?: Record<string, number>;
  /** 原来的审阅稿不见了，刚刚在原位置重新生成（beta.6，设置为“自动重新生成”时） */
  regenerated?: boolean;
  /** 刚刚手动开始（点了“生成审阅稿”）后的第一次写好（beta.7）：工具栏据此弹一次“审阅稿已生成” */
  fresh?: boolean;
  /** Word 正打开着审阅稿，但决定都已写进去（1.8）：不算“没写完”，只在弹出层里说明 */
  wordOpen?: boolean;
  /** 1.9.2：还没写进审阅稿的决定数（> 0 时审阅稿不算“可以发给对方”） */
  behind?: number;
  /** 1.9.2：上次离开 / 退出时没写完，这次打开要补写 */
  recovering?: boolean;
}
export interface DraftCtx {
  pk: string;
  bPath: string;
  /** 用来起文件名的对方文件名（往来稿里读的是库里的拷贝时，路径里的名字是哈希） */
  bName: string;
  /** 对方文件不在用户的文件夹里（库里的拷贝）：第一次保存时先问放哪 */
  noDir?: boolean;
  bData: Uint8Array;
  plan: Plan;
  reviewer: string;
  initials: string;
  theirs: string;
  theirsDate: number;
  /** 文件名规则，见 fillName */
  pattern: string;
  /** 以前的审阅稿被删或挪走：auto = 自动在原位置重新生成；ask = 显示“审阅稿不见了”，等用户点 */
  onMissing?: 'auto' | 'ask';
  /** 往来稿里对方这一版的版本号（V4），文件名标签 {ver} 用 */
  ver?: string;
}

let worker: Worker | null = null;
/**
 * 每份审阅稿（按 pk）一条队列（1.9.2，替代 beta.5 的 inflight）：生成 + 写盘整段排队，跨实例也按先后执行。
 * owner 记下是哪个实例排的，后来的实例等过别人的任务后要换成它登记的状态。
 */
const chains = new Map<string, { p: Promise<unknown>; owner: DraftSync }>();
function serial<T>(pk: string, owner: DraftSync, fn: (waitedOther: boolean) => Promise<T>): Promise<T> {
  const prev = chains.get(pk);
  const waitedOther = !!prev && prev.owner !== owner;
  const p = (prev ? prev.p.catch(() => {}) : Promise.resolve()).then(() => fn(waitedOther));
  const entry = { p, owner };
  chains.set(pk, entry);
  p.finally(() => { if (chains.get(pk) === entry) chains.delete(pk); }).catch(() => {});
  return p;
}
/** 还活着的实例（包括已离开界面、正在后台写完的） */
const alive = new Set<DraftSync>();
export interface DraftBehind { pk: string; path?: string; name: string; behind: number; s: DraftKind; error?: string }
let bgListener: ((e: DraftBehind) => void) | null = null;
/** 离开界面后在后台没能写完时通知（App 用来提示） */
export function onDraftBackground(f: ((e: DraftBehind) => void) | null) { bgListener = f; }

/** “待补写”登记（设置里的 draft-pending）：重启后提示，打开这一对文件时自动补写 */
type PendingRec = { path?: string; name: string; behind: number; at: number; s: DraftKind; /** 1.9.4：用户勾了“以后启动时不再提示”。记录还在，再打开时照样补写 */ muted?: boolean;
  /** 1.9.5：静音时没写进去的决定数。再次登记时只有数字没变多才保持安静 */ mutedBehind?: number };
const PENDING = 'draft-pending';
export function pendingDrafts(): Record<string, PendingRec> { const v = getSetting<Record<string, PendingRec>>(PENDING); return v && typeof v === 'object' ? { ...v } : {}; }
/** 1.9.4：启动时的提示里勾了“以后启动时不再提示”：这几条以后启动时不再弹 */
export function mutePending(pks: string[]) {
  const all = pendingDrafts();
  let n = 0;
  for (const pk of pks) if (all[pk] && (!all[pk].muted || all[pk].mutedBehind !== all[pk].behind)) { all[pk] = { ...all[pk], muted: true, mutedBehind: all[pk].behind }; n++; }
  if (n) setSetting(PENDING, all);
}
function markPending(pk: string, rec: PendingRec | null) {
  const all = pendingDrafts();
  // 同一份审阅稿再次登记时，保留“不再提示”——但只在没写进去的决定数没有变多时（1.9.5）：
  // 数字变多说明又有新的决定没写进去，当作新情况，启动时重新提示。换了审阅稿也重新提示。
  if (rec) {
    const old = all[pk];
    const quiet = !!old?.muted && old.path === rec.path && rec.behind <= (old.mutedBehind ?? old.behind);
    all[pk] = quiet ? { ...rec, muted: true, mutedBehind: old!.mutedBehind ?? old!.behind } : rec;
  } else { if (!(pk in all)) return; delete all[pk]; }
  setSetting(PENDING, all);
}

/** 测试钩子（只在测试里由页面设置）：生成前 / 生成后、写盘前各等一下，用来卡住某个时机 */
const hooks = () => ((window as any).__ddDraftHooks || {}) as { beforeBuild?: (pk: string) => Promise<void>; afterBuild?: (pk: string) => Promise<void>; debounceMs?: number };

/**
 * 退出前：把所有还没写进审阅稿的决定写完（最多等 ms 毫秒）。返回仍没写进去的（等用户处理或写失败的）。
 */
export async function flushDrafts(ms = 6000): Promise<DraftBehind[]> {
  const jobs = [...alive].filter((x) => x.behindCount() > 0).map((x) => x.flush());
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, ms))]);
  const left = [...alive].filter((x) => x.behindCount() > 0).map((x) => x.report());
  for (const l of left) markPending(l.pk, { path: l.path, name: l.name, behind: l.behind, at: Date.now(), s: l.s });
  return left;
}
let seq = 0;
const waiting = new Map<number, (r: DraftRes) => void>();
function call(req: Omit<DraftReq, 'id'>): Promise<DraftRes> {
  if (!worker) {
    worker = new Worker(new URL('./draft.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<DraftRes>) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data); };
  }
  const id = ++seq;
  return new Promise((res) => { waiting.set(id, res); worker!.postMessage({ ...req, id }); });
}

const sep = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
export const dirOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));
export const baseOf = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
/** 文件名去掉扩展名，以及 DocDiff 自己加的后缀（避免“-定稿-定稿”“-我方意见-我方意见”） */
export const cleanStem = (p: string) => baseOf(p).replace(/\.(docx|pdf|txt|md)$/i, '').replace(/( \(\d+\))+$/, '').replace(/(-(我方意见|定稿|our comments|final))+$/i, '') || baseOf(p);
const stem = cleanStem;
const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'DocDiff';
/** 文件名里可用的标签（beta.3）：{name} 对方文件名、{date} 日期（{date:YYYY-MM-DD} 带横线）、{ver} 版本号、{who} 审阅人 */
export interface NameVars { now?: number; ver?: string; who?: string }
export function fillName(pattern: string, bPath: string, v: NameVars = {}) {
  const d = new Date(v.now ?? Date.now());
  const y = String(d.getFullYear()), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  const E = '\u0000';
  let s = (pattern || '{name}-我方意见').replace(/\{(name|date|ver|who)(?::([^}]*))?\}/g, (_, k: string, f?: string) => {
    const val = k === 'name' ? stem(bPath) : k === 'date' ? (f && /-/.test(f) ? `${y}-${m}-${dd}` : `${y}${m}${dd}`) : k === 'ver' ? (v.ver || '') : (v.who || '');
    return clean2(val) || E;
  });
  // 没有值的标签连同一侧的分隔符一起去掉，不会出现“--”
  s = s.replace(/([-_ ·])?\u0000([-_ ·])?/g, (_, a?: string, b?: string) => (a && b ? a : ''));
  return s;
}
const clean2 = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
export function draftName(pattern: string, bPath: string, suffix = '', v: NameVars = {}) {
  return clean(fillName(pattern, bPath, v)) + suffix + '.docx';
}
async function freePath(dir: string, name: string): Promise<string> {
  const s = sep(dir + '/');
  const base = name.replace(/\.docx$/i, '');
  for (let i = 1; i < 100; i++) {
    const p = dir + s + (i === 1 ? name : `${base} (${i}).docx`);
    if (!(await api.exists?.(p))) return p;
  }
  return dir + s + `${base} (${Date.now()}).docx`;
}

type Built = Extract<DraftRes, { kind: 'ok' }>['out'];
const sameDec = (x?: Decision, y?: Decision) => (x?.v || '') === (y?.v || '') && (x?.note || '') === (y?.note || '');

export class DraftSync {
  state: DraftState = { s: 'none', unwritten: [], prior: 0 };
  private meta: DraftMeta | null;
  private timer: any = null;
  private poll: any = null;
  private busy = false;
  private again = false;
  private decisions: Record<number, Decision> = {};
  /** 1.9.5：对方批注的回复、不带入的内部批注；变了也要重写审阅稿 */
  private cm: { replies: { parent: string; text: string; at: number }[]; drop: string[] } = { replies: [], drop: [] };
  private cmSig = '';
  private cmDirty = false;
  private subs = new Set<(s: DraftState) => void>();
  private disposed = false;
  /**
   * 审阅稿手动开始（beta.7）：点“生成审阅稿”之前，决定只记在 DocDiff 里，不写任何文件。
   * 这一对文件开始过（有登记）就一直自动同步；往来稿的新一轮是新的一对，要再点一次。
   */
  private started = false;
  private fresh = false;
  /** 1.9.2：从上次写进审阅稿以来，结论或备注变过的处 */
  private changed = new Set<number>();
  /** 1.9.2：已离开界面（实例被替换），只把剩下的写完 */
  private detached = false;
  /** 1.9.2：上次没写完，打开后第一次拿到决定时立刻补写 */
  private recover = false;
  constructor(public ctx: DraftCtx) {
    this.meta = getDraftMeta(ctx.pk);
    this.started = !!this.meta;
    const pend = pendingDrafts()[ctx.pk];
    this.recover = !!(pend && this.meta);
    alive.add(this);
    if (this.meta) { this.set({ s: this.recover ? 'saving' : 'saved', path: this.meta.path, at: this.meta.at, recovering: this.recover || undefined, behind: this.recover ? pend!.behind : 0 }); this.check(); }
  }
  /** 还没写进审阅稿的决定数（没开始审阅稿时不算） */
  behindCount() { return this.started ? this.changed.size + (this.recover ? 1 : 0) + (this.cmDirty ? 1 : 0) : 0; }
  /** 1.9.5：回复 / 不带入的批注变了。第一次设置（打开时）不算变化 */
  setComments(c: { replies: { parent: string; text: string; at: number }[]; drop: string[] }) {
    if (this.detached) return;
    const sig = JSON.stringify(c);
    if (sig === this.cmSig) return;
    const first = !this.cmSig && !this.cmDirty;
    this.cm = c; this.cmSig = sig;
    if (first || !this.started) return;
    this.cmDirty = true;
    if (this.state.s === 'saved') this.set({ s: 'saving', behind: this.changed.size + 1 });
    if (this.state.s === 'modified' || this.state.s === 'gone' || this.state.s === 'nowrite') return;
    this.schedule(hooks().debounceMs ?? 250);
  }
  report(): DraftBehind { return { pk: this.ctx.pk, path: this.meta?.path || this.state.path, name: this.meta?.path ? baseOf(this.meta.path) : draftName(this.ctx.pattern, this.ctx.bName, '', this.vars()), behind: (this.changed.size + (this.cmDirty ? 1 : 0)) || (this.recover ? this.state.behind || 1 : 0), s: this.state.s, error: this.state.error }; }
  get isStarted() { return this.started; }
  /** 旧实例（已离开界面）把没写完的交过来：用这个实例的决定（更新）再写一次 */
  takeOver() {
    if (this.detached) return;
    this.recover = true;
    if (this.state.s === 'saved') this.set({ s: 'saving' });
    if (this.state.s === 'saving' || this.state.s === 'error' || this.state.s === 'locked') this.schedule(0);
  }
  /** 立刻写（不等合并），直到都写进去、或遇到要用户处理的情况；最多试几轮 */
  async flush(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      if (!this.started || this.disposed || this.behindCount() === 0) return;
      if (this.state.s === 'modified' || this.state.s === 'gone' || this.state.s === 'nowrite') return; // 等用户处理
      if (i > 0 && (this.state.s === 'locked' || this.state.s === 'error')) return; // 写过一次还是不行
      clearTimeout(this.timer); this.timer = null;
      if (this.busy) { await this.current; continue; }
      await this.run();
    }
  }
  /** 点了“生成审阅稿”：把已经做过的决定一次写进去，之后自动同步。对方文件不在用户文件夹里（库里的拷贝）时先选文件夹 */
  async start(folderTitle?: string) {
    if (this.started && this.meta) { this.schedule(0); return; }
    this.started = true;
    this.fresh = true;
    this.firstUpdate = false;
    if (!this.meta && this.ctx.noDir) {
      const dir = await api.pickFolder?.({ title: folderTitle, defaultPath: dirOf(this.ctx.bPath) });
      if (!dir) { this.started = false; this.fresh = false; return; }
      this.meta = { dir, path: await freePath(dir, draftName(this.ctx.pattern, this.ctx.bName, '', this.vars())), at: 0 };
    }
    clearTimeout(this.timer);
    await this.run();
  }
  /** 完成页的“重新写入”：Word 占着时先看看关了没有，其余情况直接重写 */
  retry() { if (this.state.s === 'locked') this.check(); else this.schedule(0); }
  /** 署名等写入参数变了：已有审阅稿时重写一次 */
  touch() { if (this.meta && (this.state.s === 'saved' || this.state.s === 'locked')) this.schedule(250); }
  vars(): NameVars { return { ver: this.ctx.ver, who: this.ctx.reviewer }; }
  subscribe(f: (s: DraftState) => void) { this.subs.add(f); f(this.state); return () => { this.subs.delete(f); }; }
  private set(p: Partial<DraftState>) { this.state = { ...this.state, ...p }; for (const f of this.subs) f(this.state); }
  /**
   * 离开界面（1.9.2）：不再显示，但还没写进去的决定继续写完；写不完时登记“待补写”并通知。
   * 没开始审阅稿、或都已写完时直接结束。
   */
  dispose() {
    if (this.detached) return;
    this.detached = true;
    clearInterval(this.poll); this.poll = null;
    this.subs.clear();
    clearTimeout(this.timer); this.timer = null;
    // 没有没写进去的决定（打开时那次自愈重写还没开始也算）：直接结束
    if (!this.started || (this.behindCount() === 0 && !this.busy)) { this.end(); return; }
    if (this.busy) { this.again = this.again || this.behindCount() > 0; return; } // 正在写：写完后 finally 里接着写剩下的
    void this.run();
  }
  private end() { this.disposed = true; alive.delete(this); }
  /** 后台写完一轮之后：都写进去了就结束；写不进去就登记并通知 */
  private afterDetached() {
    if (!this.detached || this.busy || this.again) return;
    if (this.behindCount() === 0) { markPending(this.ctx.pk, null); this.end(); return; }
    const r = this.report();
    markPending(r.pk, { path: r.path, name: r.name, behind: r.behind, at: Date.now(), s: r.s });
    bgListener?.(r);
    this.end();
  }

  /** 打开时、窗口回到前台时：看看审阅稿还在不在、有没有被别人改过、Word 是不是正开着 */
  /** 不在修订审阅里（beta.7 · P2-3）：不检查、不重建；已经提交的写入照常完成 */
  paused = false;
  async check() {
    if (!this.meta?.stat || this.busy || this.paused || this.detached) return;
    // 别的实例（上一次打开这一对）还在写同一份审阅稿：等它写完，用它登记的状态比对，否则会把它的写入误判成“被改过”
    const q = chains.get(this.ctx.pk);
    if (q && q.owner !== this) { await q.p.catch(() => {}); const latest = getDraftMeta(this.ctx.pk); if (latest && (latest.at || 0) > (this.meta?.at || 0)) this.meta = latest; }
    if (!this.meta?.stat || this.busy || this.detached) return;
    const r = await api.draftStat?.(this.meta.path);
    if (!r || this.disposed || this.busy) return;
    if (!r.stat) { if (this.ctx.onMissing === 'ask') this.set({ s: 'gone' }); else this.regenerate(); }
    else if (Math.abs(r.stat.mtime - this.meta.stat.mtime) > 1 || r.stat.size !== this.meta.stat.size) this.set({ s: 'modified' });
    // Word 打开着不等于没写完：只有写入被挡住（状态已是 locked）时才算问题（1.8 · R2）
    else if (r.locked) { if (this.state.s !== 'locked' && !this.state.wordOpen) this.set({ wordOpen: true }); }
    else { if (this.state.wordOpen) this.set({ wordOpen: false }); if (this.state.s === 'locked') this.schedule(0); }
  }

  /** 原来的审阅稿不见了（设置为自动重新生成）：同一位置重新生成一份，所有决定都写进去 */
  private regenerating = false;
  private regenerate() {
    if (!this.meta) return;
    this.meta = { ...this.meta, stat: undefined as any, at: 0 };
    this.regenerating = true;
    this.schedule(0);
  }
  /** 决定变了。还没点过“生成审阅稿”时只记下来，不写文件 */
  update(decisions: Record<number, Decision>) {
    if (this.detached) return;
    const prev = this.decisions;
    for (const k of new Set([...Object.keys(prev), ...Object.keys(decisions)])) { const id = +k; if (!sameDec(prev[id], decisions[id])) this.changed.add(id); }
    this.decisions = decisions;
    if (!this.started) { this.changed.clear(); this.firstUpdate = false; return; }
    // 第一次拿到决定（打开时）不算变化；上次没写完时立刻补写
    // 打开时照旧按 DocDiff 里的决定重写一次（和 1.8 起一样，能自愈）；上次没写完时立刻补写
    if (this.firstUpdate) {
      this.firstUpdate = false; this.changed.clear();
      if (this.state.s === 'saving' || this.state.s === 'saved') this.schedule(this.recover ? 0 : 250);
      return;
    }
    // 有没写进去的决定时不显示“已保存”（过期的审阅稿不能看起来可以发给对方）
    if (this.changed.size) this.set(this.state.s === 'saved' ? { s: 'saving', behind: this.changed.size } : { behind: this.changed.size });
    if (this.state.s === 'modified' || this.state.s === 'gone' || this.state.s === 'nowrite') return; // 等用户处理
    if (this.changed.size) this.schedule(hooks().debounceMs ?? 250);
  }
  private firstUpdate = true;
  private schedule(ms: number) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms); }

  private async build(mode: 'draft' | 'final', o: { pending?: 'a' | 'b'; keepComments?: boolean } = {}, decisions = this.decisions): Promise<Built> {
    const c = this.ctx;
    const r = await call({
      key: c.pk + ':' + c.bData.byteLength,
      base: c.bData, plan: c.plan, decisions, mode, pending: o.pending, keepComments: o.keepComments,
      reviewer: c.reviewer, reviewerInitials: c.initials, theirs: c.theirs, theirsDate: c.theirsDate, now: Date.now(), openLabel: isEn() ? 'Open for discussion' : undefined,
      replies: mode === 'draft' ? this.cm.replies : undefined, dropComments: mode === 'draft' ? this.cm.drop : undefined,
    });
    if (r.kind === 'err') throw new Error(r.error);
    return r.out;
  }

  /**
   * 生成并写盘一次（1.9.2：整段按 pk 排队）。用的是排到时的决定快照；写好后只清掉快照里已经包含的变化。
   * 离开界面后照样写完：任务绑定这一对文件（pk）和这份审阅稿的路径，不会写到别的稿里。
   */
  private run(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.busy) { this.again = true; return this.current || Promise.resolve(); }
    if (!this.meta && this.ctx.noDir) { this.set({ s: 'nowrite' }); return Promise.resolve(); }
    this.busy = true;
    this.set({ s: 'saving' });
    const pk = this.ctx.pk;
    const job = serial(pk, this, async (waitedOther) => {
      const t0 = performance.now();
      // 只有真的等过别的实例写盘时才换成它登记的状态（“另存为新审阅稿”等自己设定的新路径不能被覆盖）
      if (waitedOther) { const latest = getDraftMeta(pk); if (latest && (!this.meta || (latest.at || 0) > (this.meta.at || 0))) this.meta = latest; }
      // 已离开界面、而这一对文件又被打开了（新实例的决定更新）：不再用旧快照写，交给新实例写一次，免得旧快照盖掉新决定
      if (this.detached) {
        const newer = [...alive].find((x) => x !== this && x.ctx.pk === pk && !x.detached && x.isStarted);
        if (newer) { this.changed.clear(); this.recover = false; newer.takeOver(); return; }
      }
      const snap = this.decisions;
      const cmSnap = this.cmSig;
      const recovering = this.recover;
      await hooks().beforeBuild?.(pk);
      const out = await this.build('draft', {}, snap);
      const tBuilt = performance.now();
      await hooks().afterBuild?.(pk);
      let path = this.meta?.path || (await freePath(this.meta?.dir || dirOf(this.ctx.bPath), draftName(this.ctx.pattern, this.ctx.bName, '', this.vars())));
      let expect = this.meta?.stat || null;
      for (let tries = 0; tries < 5; tries++) {
        const res = await api.draftSave({ path, data: out.bytes, expect });
        if (res?.ok) {
          // 已经提交的写入：不管这个实例是否已离开界面，都要登记路径和写完后的状态（否则下次会误判为“被改过”）
          this.meta = { ...(this.meta || {}), path, stat: res.stat, at: Date.now() };
          setDraftMeta(pk, this.meta);
          for (const id of [...this.changed]) if (sameDec(snap[id], this.decisions[id])) this.changed.delete(id);
          if (cmSnap === this.cmSig) this.cmDirty = false;
          if (recovering) this.recover = false;
          if (!this.changed.size && !this.recover && !this.cmDirty) markPending(pk, null);
          if (this.detached) return;
          clearInterval(this.poll); this.poll = null;
          const regen = this.regenerating; this.regenerating = false;
          const fresh = this.fresh; this.fresh = false;
          this.set({ s: 'saved', wordOpen: false, regenerated: regen, fresh, recovering: undefined, behind: this.changed.size + (this.cmDirty ? 1 : 0), path, at: this.meta.at, unwritten: out.unwritten, prior: out.priorRevisions, ms: Math.round(performance.now() - t0), parts: { worker: Math.round(tBuilt - t0), ...out.ms }, error: undefined });
          return;
        }
        const code = res?.code || 'error';
        if (code === 'exists' && !expect) { path = await freePath(dirOf(path), baseOf(path)); continue; }
        if (code === 'gone' && this.ctx.onMissing !== 'ask' && expect) { expect = null; this.regenerating = true; continue; }
        const behind = this.changed.size;
        if (code === 'locked') {
          this.set({ s: 'locked', path, unwritten: out.unwritten, behind });
          if (!this.poll && !this.detached) this.poll = setInterval(() => this.check(), 3000);
        } else if (code === 'modified') this.set({ s: 'modified', path, behind });
        else if (code === 'gone') this.set({ s: 'gone', path, behind });
        else if (code === 'nowrite') this.set({ s: 'nowrite', path, behind });
        else this.set({ s: 'error', path, error: res?.error || code, behind });
        return;
      }
    });
    const done = job.catch((e: any) => { this.set({ s: 'error', error: String(e?.message || e), behind: this.changed.size }); }).finally(() => {
      this.busy = false;
      this.current = null;
      if (this.again) {
        this.again = false;
        if (this.state.s === 'saving' || this.state.s === 'saved' || this.state.s === 'error') { if (this.detached) { void this.run(); return; } this.schedule(0); return; }
      }
      this.afterDetached();
    });
    this.current = done;
    return done;
  }
  private current: Promise<void> | null = null;

  /** 被别人改过 / 被移走之后：另存一份新的审阅稿，此后同步到新文件 */
  async saveAsNew() {
    const dir = this.meta?.dir || dirOf(this.meta?.path || this.ctx.bPath);
    this.meta = { dir: this.meta?.dir, path: await freePath(dir, draftName(this.ctx.pattern, this.ctx.bName, '', this.vars())), at: 0 };
    await this.run();
  }
  /** 写不进对方文件所在的文件夹：换一个文件夹 */
  async chooseFolder(title: string) {
    const dir = await api.pickFolder?.({ title, defaultPath: dirOf(this.ctx.bPath) });
    if (!dir) return;
    this.meta = { dir, path: await freePath(dir, draftName(this.ctx.pattern, this.ctx.bName, '', this.vars())), at: 0 };
    await this.run();
  }

  /**
   * 生成定稿第一步：在后台生成内容，但先不保存（beta.5）。
   * missed = 本该在定稿里“改回原文”却没能写进去的处（拒绝的、或选了“改回我方原文”的未决定处）。
   * 这些处在定稿里仍是对方的写法，必须让用户知道，不能直接报“已生成”。
   */
  async buildFinal(o: { pending: 'a' | 'b' }): Promise<{ out: Built; missed: { cid: number; reason: Reason }[] }> {
    const out = await this.build('final', { pending: o.pending, keepComments: false });
    const missed = out.unwritten.filter((u) => { const v = this.decisions[u.cid]?.v; return v === 'r' || (v !== 'a' && o.pending === 'a'); });
    return { out, missed };
  }
  /** 生成定稿第二步：保存，返回路径 */
  async saveFinal(out: Built, pattern: string, folderTitle?: string): Promise<string> {
    // 没开始审阅稿也能生成定稿（beta.7）；对方文件是库里的拷贝时先问放哪
    let dir = this.meta?.dir || (this.meta?.path ? dirOf(this.meta.path) : '');
    if (!dir) {
      if (this.ctx.noDir) { dir = await api.pickFolder?.({ title: folderTitle, defaultPath: dirOf(this.ctx.bPath) }); if (!dir) throw new Error('cancel'); }
      else dir = dirOf(this.ctx.bPath);
    }
    let path = await freePath(dir, draftName(pattern, this.ctx.bName, '', this.vars()));
    for (let i = 0; i < 5; i++) {
      const res = await api.draftSave({ path, data: out.bytes, expect: null });
      if (res?.ok) return path;
      if (res?.code === 'exists') { path = await freePath(dir, baseOf(path)); continue; }
      throw new Error(res?.code === 'nowrite' ? 'nowrite' : res?.error || res?.code || 'error');
    }
    throw new Error('exists');
  }
  /** 一步完成（测试用）：返回路径和没落实的处 */
  async makeFinal(o: { pending: 'a' | 'b'; keepComments?: boolean; pattern: string }): Promise<{ path: string; missed: { cid: number; reason: Reason }[] }> {
    const { out, missed } = await this.buildFinal(o);
    return { path: await this.saveFinal(out, o.pattern), missed };
  }
}
