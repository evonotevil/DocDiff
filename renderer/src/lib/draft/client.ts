// 审阅稿的同步（1.8）：决定一变，约 0.25 秒后在 Worker 里重写一份，交给主进程原子写盘。
// 状态：没有 / 保存中 / 已保存 / Word 正在用 / 被改过 / 被移走 / 写不进这个文件夹 / 出错。
// 绝不覆盖别人改过的审阅稿：主进程按我们上次写完时的修改时间和大小比对，不一致就停下来问。
import type { Plan } from './plan';
import type { Decision, Reason } from './ooxml';
import type { DraftReq, DraftRes } from './draft.worker';
import { getDraftMeta, setDraftMeta, type DraftMeta } from '../review';

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
/** 每组比较正在提交的写盘（beta.5）：同一份审阅稿的新任务要等旧任务写完、登记完再写，避免把自己的写入当成“被别人改过” */
const inflight = new Map<string, Promise<void>>();
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

export class DraftSync {
  state: DraftState = { s: 'none', unwritten: [], prior: 0 };
  private meta: DraftMeta | null;
  private timer: any = null;
  private poll: any = null;
  private busy = false;
  private again = false;
  private decisions: Record<number, Decision> = {};
  private subs = new Set<(s: DraftState) => void>();
  private disposed = false;
  /**
   * 审阅稿手动开始（beta.7）：点“生成审阅稿”之前，决定只记在 DocDiff 里，不写任何文件。
   * 这一对文件开始过（有登记）就一直自动同步；往来稿的新一轮是新的一对，要再点一次。
   */
  private started = false;
  private fresh = false;
  constructor(public ctx: DraftCtx) {
    this.meta = getDraftMeta(ctx.pk);
    this.started = !!this.meta;
    if (this.meta) { this.set({ s: 'saved', path: this.meta.path, at: this.meta.at }); this.check(); }
  }
  get isStarted() { return this.started; }
  /** 点了“生成审阅稿”：把已经做过的决定一次写进去，之后自动同步。对方文件不在用户文件夹里（库里的拷贝）时先选文件夹 */
  async start(folderTitle?: string) {
    if (this.started && this.meta) { this.schedule(0); return; }
    this.started = true;
    this.fresh = true;
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
  dispose() { this.disposed = true; clearTimeout(this.timer); clearInterval(this.poll); this.subs.clear(); }

  /** 打开时、窗口回到前台时：看看审阅稿还在不在、有没有被别人改过、Word 是不是正开着 */
  /** 不在修订审阅里（beta.7 · P2-3）：不检查、不重建；已经提交的写入照常完成 */
  paused = false;
  async check() {
    if (!this.meta?.stat || this.busy || this.paused) return;
    const r = await api.draftStat?.(this.meta.path);
    if (!r || this.disposed) return;
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
    this.decisions = decisions;
    if (!this.started) return;
    if (this.state.s === 'modified' || this.state.s === 'gone' || this.state.s === 'nowrite') return; // 等用户处理
    this.schedule(250);
  }
  private schedule(ms: number) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms); }

  private async build(mode: 'draft' | 'final', o: { pending?: 'a' | 'b'; keepComments?: boolean } = {}): Promise<Built> {
    const c = this.ctx;
    const r = await call({
      key: c.pk + ':' + c.bData.byteLength,
      base: c.bData, plan: c.plan, decisions: this.decisions, mode, pending: o.pending, keepComments: o.keepComments,
      reviewer: c.reviewer, reviewerInitials: c.initials, theirs: c.theirs, theirsDate: c.theirsDate, now: Date.now(),
    });
    if (r.kind === 'err') throw new Error(r.error);
    return r.out;
  }

  private async run() {
    if (this.disposed) return;
    if (this.busy) { this.again = true; return; }
    if (!this.meta && this.ctx.noDir) { this.set({ s: 'nowrite' }); return; }
    this.busy = true;
    const t0 = performance.now();
    this.set({ s: 'saving' });
    try {
      const pk = this.ctx.pk;
      // 上一个实例（切换文档、改比较设置时会新建实例）可能还在写同一份审阅稿：等它写完，用它登记的状态
      const prev = inflight.get(pk);
      if (prev) await prev;
      if (this.disposed) return;
      // 只有真的等过别的实例写盘时才换成它登记的状态（“另存为新审阅稿”等自己设定的新路径不能被覆盖）
      if (prev) { const latest = getDraftMeta(pk); if (latest && (!this.meta || (latest.at || 0) > (this.meta.at || 0))) this.meta = latest; }
      const out = await this.build('draft');
      const tBuilt = performance.now();
      // 提交前取消：已经不需要这份结果了，不写盘
      if (this.disposed) return;
      let release!: () => void;
      const committing = new Promise<void>((r) => { release = r; });
      inflight.set(pk, committing);
      try {
        let path = this.meta?.path || (await freePath(this.meta?.dir || dirOf(this.ctx.bPath), draftName(this.ctx.pattern, this.ctx.bName, '', this.vars())));
        let expect = this.meta?.stat || null;
        for (let tries = 0; tries < 5; tries++) {
          const res = await api.draftSave({ path, data: out.bytes, expect });
          if (res?.ok) {
            // 已经提交的写入：不管这个实例是否已被替换，都要登记路径和写完后的状态（否则下次会误判为“被改过”）
            this.meta = { ...(this.meta || {}), path, stat: res.stat, at: Date.now() };
            setDraftMeta(pk, this.meta);
            if (this.disposed) return;
            clearInterval(this.poll); this.poll = null;
            const regen = this.regenerating; this.regenerating = false;
            const fresh = this.fresh; this.fresh = false;
            this.set({ s: 'saved', wordOpen: false, regenerated: regen, fresh, path, at: this.meta.at, unwritten: out.unwritten, prior: out.priorRevisions, ms: Math.round(performance.now() - t0), parts: { worker: Math.round(tBuilt - t0), ...out.ms }, error: undefined });
            break;
          }
          if (this.disposed) return;
          const code = res?.code || 'error';
          if (code === 'exists' && !expect) { path = await freePath(dirOf(path), baseOf(path)); continue; }
          if (code === 'locked') {
            this.set({ s: 'locked', path, unwritten: out.unwritten });
            if (!this.poll) this.poll = setInterval(() => this.check(), 3000);
          } else if (code === 'modified') this.set({ s: 'modified', path });
          else if (code === 'gone') { if (this.ctx.onMissing !== 'ask' && expect) { expect = null; this.regenerating = true; continue; } this.set({ s: 'gone', path }); }
          else if (code === 'nowrite') this.set({ s: 'nowrite', path });
          else this.set({ s: 'error', path, error: res?.error || code });
          break;
        }
      } finally {
        release();
        if (inflight.get(pk) === committing) inflight.delete(pk);
      }
    } catch (e: any) {
      this.set({ s: 'error', error: String(e?.message || e) });
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.schedule(0); }
    }
  }

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
