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
  /** 文件名规则，{name} = 对方文件名（不含扩展名） */
  pattern: string;
}

let worker: Worker | null = null;
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
export function draftName(pattern: string, bPath: string, suffix = '') {
  return clean((pattern || '{name}-我方意见').split('{name}').join(stem(bPath))) + suffix + '.docx';
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
  constructor(public ctx: DraftCtx) {
    this.meta = getDraftMeta(ctx.pk);
    if (this.meta) { this.set({ s: 'saved', path: this.meta.path, at: this.meta.at }); this.check(); }
  }
  subscribe(f: (s: DraftState) => void) { this.subs.add(f); f(this.state); return () => { this.subs.delete(f); }; }
  private set(p: Partial<DraftState>) { this.state = { ...this.state, ...p }; for (const f of this.subs) f(this.state); }
  dispose() { this.disposed = true; clearTimeout(this.timer); clearInterval(this.poll); this.subs.clear(); }

  /** 打开时、窗口回到前台时：看看审阅稿还在不在、有没有被别人改过、Word 是不是正开着 */
  async check() {
    if (!this.meta?.stat || this.busy) return;
    const r = await api.draftStat?.(this.meta.path);
    if (!r || this.disposed) return;
    if (!r.stat) this.set({ s: 'gone' });
    else if (Math.abs(r.stat.mtime - this.meta.stat.mtime) > 1 || r.stat.size !== this.meta.stat.size) this.set({ s: 'modified' });
    else if (r.locked) this.set({ s: 'locked' });
    else if (this.state.s === 'locked') this.schedule(0);
  }

  /** 决定变了。还没有审阅稿、也没有任何决定时什么都不做 */
  update(decisions: Record<number, Decision>) {
    this.decisions = decisions;
    const any = Object.values(decisions).some((d) => d?.v || d?.note);
    if (!this.meta && !any) return;
    if (this.state.s === 'modified' || this.state.s === 'gone' || this.state.s === 'nowrite') return; // 等用户处理
    this.schedule(250);
  }
  private schedule(ms: number) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms); }

  private async build(mode: 'draft' | 'final', o: { pending?: 'a' | 'b'; keepComments?: boolean } = {}) {
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
      const out = await this.build('draft');
      const tBuilt = performance.now();
      let path = this.meta?.path || (await freePath(this.meta?.dir || dirOf(this.ctx.bPath), draftName(this.ctx.pattern, this.ctx.bName)));
      let expect = this.meta?.stat || null;
      for (let tries = 0; tries < 5; tries++) {
        const res = await api.draftSave({ path, data: out.bytes, expect });
        if (this.disposed) return;
        if (res?.ok) {
          this.meta = { ...(this.meta || {}), path, stat: res.stat, at: Date.now() };
          setDraftMeta(this.ctx.pk, this.meta);
          clearInterval(this.poll); this.poll = null;
          this.set({ s: 'saved', path, at: this.meta.at, unwritten: out.unwritten, prior: out.priorRevisions, ms: Math.round(performance.now() - t0), parts: { worker: Math.round(tBuilt - t0), ...out.ms }, error: undefined });
          break;
        }
        const code = res?.code || 'error';
        if (code === 'exists' && !expect) { path = await freePath(dirOf(path), baseOf(path)); continue; }
        if (code === 'locked') {
          this.set({ s: 'locked', path, unwritten: out.unwritten });
          if (!this.poll) this.poll = setInterval(() => this.check(), 3000);
        } else if (code === 'modified') this.set({ s: 'modified', path });
        else if (code === 'gone') this.set({ s: 'gone', path });
        else if (code === 'nowrite') this.set({ s: 'nowrite', path });
        else this.set({ s: 'error', path, error: res?.error || code });
        break;
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
    this.meta = { dir: this.meta?.dir, path: await freePath(dir, draftName(this.ctx.pattern, this.ctx.bName)), at: 0 };
    await this.run();
  }
  /** 写不进对方文件所在的文件夹：换一个文件夹 */
  async chooseFolder(title: string) {
    const dir = await api.pickFolder?.({ title, defaultPath: dirOf(this.ctx.bPath) });
    if (!dir) return;
    this.meta = { dir, path: await freePath(dir, draftName(this.ctx.pattern, this.ctx.bName)), at: 0 };
    await this.run();
  }

  /** 生成定稿：另存一份干净的文件，返回路径 */
  async makeFinal(o: { pending: 'a' | 'b'; keepComments: boolean; pattern: string }): Promise<string> {
    const out = await this.build('final', o);
    const dir = this.meta?.dir || dirOf(this.meta?.path || this.ctx.bPath);
    let path = await freePath(dir, draftName(o.pattern, this.ctx.bName));
    for (let i = 0; i < 5; i++) {
      const res = await api.draftSave({ path, data: out.bytes, expect: null });
      if (res?.ok) return path;
      if (res?.code === 'exists') { path = await freePath(dir, baseOf(path)); continue; }
      throw new Error(res?.code === 'nowrite' ? 'nowrite' : res?.error || res?.code || 'error');
    }
    throw new Error('exists');
  }
}
