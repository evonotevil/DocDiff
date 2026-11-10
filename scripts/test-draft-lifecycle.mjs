// 审阅稿同步的生命周期时序（1.8 beta.5）：用真实 DraftSync，替换掉 Worker 和主进程写盘，按确定的顺序推进。
// node scripts/test-draft-lifecycle.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'draft-lifecycle.test.mjs');
await esbuild.build({ stdin: { contents: "export { DraftSync, flushDrafts, pendingDrafts, mutePending } from './renderer/src/lib/draft/client';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: out, logLevel: 'warning' });

// 假的主进程：一个文件系统（路径 → {mtime,size}），draftSave 按真实规则校验 expect；可以让写盘挂起
const disk = new Map(); let clock = 1; const records = {}; let hold = null;
const draftSave = async ({ path: p, data, expect }) => {
  if (hold) await hold;
  const cur = disk.get(p) || null;
  if (cur && !expect) return { ok: false, code: 'exists' };
  if (cur && expect && (cur.mtime !== expect.mtime || cur.size !== expect.size)) return { ok: false, code: 'modified' };
  if (expect && !cur) return { ok: false, code: 'gone' };
  const st = { mtime: clock++, size: data.length }; disk.set(p, st); return { ok: true, stat: st };
};
const settingsStore = {};
globalThis.window = { api: { settingsGet: () => settingsStore, settingsSet: async (k, v) => { settingsStore[k] = v; return { ok: true }; }, reviewGet: (k) => records[k] || null, reviewIndex: () => ({}), reviewSave: (k, v) => { records[k] = v; return Promise.resolve({ ok: true }); }, exists: async (p) => disk.has(p), draftSave, draftStat: async (p) => ({ stat: disk.get(p) || null, locked: false }) } };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { DraftSync, flushDrafts, pendingDrafts, mutePending } = await import('file://' + out);
const deferred = () => { let r; const p = new Promise((x) => (r = x)); return { p, r }; };
const ctx = (pk) => ({ pk, bPath: '/w/合同.docx', bName: '合同.docx', bData: new Uint8Array([1]), plan: {}, reviewer: 'T', initials: 'T', theirs: 'O', theirsDate: 0, pattern: '{name}-我方意见' });
const built = (n = 3) => ({ bytes: new Uint8Array(n), unwritten: [], priorRevisions: 0, ms: {} });
const tick = () => new Promise((r) => setTimeout(r, 0));

// 1.9.2：离开界面（实例被替换）时已经在生成的审阅稿照样写完、登记（以前会丢掉，导致审阅稿漏写）
test('disposed while building: the build is still written and registered (1.9.2)', async () => {
  disk.clear(); const s = new DraftSync(ctx('a')); const b = deferred(); s.build = () => b.p;
  const run = s.run(); await tick(); s.dispose(); b.r(built()); await run;
  assert.equal(disk.size, 1);
  assert.equal(records.a?.draft?.path, [...disk.keys()][0]);
});
test('disposed while the write is in flight: the committed write is still registered', async () => {
  disk.clear(); const s = new DraftSync(ctx('b')); s.build = async () => built();
  const h = deferred(); hold = h.p;
  const run = s.run(); await tick(); await tick(); s.dispose(); hold = null; h.r(); await run;
  assert.equal(disk.size, 1);
  const [p, st] = [...disk.entries()][0];
  assert.equal(records.b?.draft?.path, p, 'path registered');
  assert.deepEqual(records.b?.draft?.stat, st, 'stat registered');
});
test('new instance during the old write: waits, then writes with the registered state (no false "modified")', async () => {
  disk.clear(); const old = new DraftSync(ctx('c')); old.build = async () => built(3);
  const h = deferred(); hold = h.p;
  const r1 = old.run(); await tick(); await tick();
  old.dispose();
  const nu = new DraftSync(ctx('c')); nu.build = async () => built(5);
  const r2 = nu.run(); await tick();
  hold = null; h.r(); await r1; await r2;
  assert.equal(nu.state.s, 'saved', `state ${nu.state.s}`);
  assert.equal(disk.size, 1, 'same file, no "(2)" copy');
  assert.equal([...disk.values()][0].size, 5);
});

// beta.7：审阅稿手动开始
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test('manual start: decisions alone write nothing', async () => {
  disk.clear(); const s = new DraftSync(ctx('m1')); s.build = async () => built();
  s.update({ 1: { v: 'a' }, 2: { v: 'r' } });
  await wait(400);
  assert.equal(disk.size, 0, 'no file before “生成审阅稿”');
  assert.equal(s.state.s, 'none');
  assert.equal(s.isStarted, false);
  s.dispose();
});
test('manual start: start() writes once with the decisions so far, marks fresh, then keeps syncing', async () => {
  disk.clear(); const s = new DraftSync(ctx('m2')); let n = 0; s.build = async () => built(3 + n++);
  s.update({ 1: { v: 'a' } });
  await s.start();
  assert.equal(s.state.s, 'saved'); assert.equal(s.state.fresh, true); assert.equal(disk.size, 1);
  s.update({ 1: { v: 'a' }, 2: { v: 'h' } });
  await wait(400);
  assert.equal(s.state.s, 'saved'); assert.equal(s.state.fresh, false, 'tip only after the manual start');
  assert.equal([...disk.values()][0].size, 4, 'second write synced automatically');
  s.dispose();
});
test('manual start: the same pair reopened keeps syncing without another click', async () => {
  disk.clear(); const a = new DraftSync(ctx('m3')); a.build = async () => built(3);
  await a.start(); a.dispose();
  const b = new DraftSync(ctx('m3')); b.build = async () => built(6);
  assert.equal(b.isStarted, true);
  b.update({ 1: { v: 'r' } }); await wait(400);
  assert.equal(disk.size, 1); assert.equal([...disk.values()][0].size, 6);
  b.dispose();
});
test('manual start: a new pair (next round) is not started', async () => {
  const c = new DraftSync(ctx('m4-new-round')); c.build = async () => built();
  assert.equal(c.isStarted, false); c.dispose();
});
test('final without a draft: saved next to the other side’s file, no draft written', async () => {
  disk.clear(); const s = new DraftSync(ctx('m5')); s.build = async () => built(2);
  const p = await s.saveFinal(built(2), '{name}-定稿');
  assert.equal(p, '/w/合同-定稿.docx'); assert.equal(disk.size, 1); assert.equal(s.state.s, 'none');
  s.dispose();
});
test('library copy without a draft: final asks for a folder; cancel throws "cancel"', async () => {
  disk.clear(); window.api.pickFolder = async () => null;
  const s = new DraftSync({ ...ctx('m6'), noDir: true }); s.build = async () => built(2);
  await assert.rejects(() => s.saveFinal(built(2), '{name}-定稿'), /cancel/);
  window.api.pickFolder = async () => '/picked';
  assert.equal(await s.saveFinal(built(2), '{name}-定稿'), '/picked/合同-定稿.docx');
  await s.start(); assert.equal(s.state.path, '/picked/合同-我方意见.docx');
  s.dispose();
});

// ---------- 1.9.2：快速审阅后立即离开 ----------
const textOf = (decs) => new Uint8Array(JSON.stringify(decs).length); // 用长度代表“写进去的是哪一份决定”
test('1.9.2 left during the debounce: the last batch is written right away with the final decisions', async () => {
  disk.clear(); const s = new DraftSync(ctx('l1')); s.build = async (_m, _o, d) => ({ ...built(), bytes: textOf(d) });
  s.update({}); await s.start();
  const final = {}; for (let i = 1; i <= 40; i++) final[i] = { v: 'r' };
  s.update(final);           // 0.25 秒合并还没到
  s.dispose();               // 立刻离开
  await wait(50);
  assert.equal([...disk.values()][0].size, JSON.stringify(final).length, 'final 40 decisions written');
  assert.deepEqual(pendingDrafts(), {}, 'nothing left pending');
});
test('1.9.2 old snapshot never overwrites newer decisions of the reopened pair', async () => {
  disk.clear(); const old = new DraftSync(ctx('l2')); old.build = async (_m, _o, d) => ({ ...built(), bytes: textOf(d) });
  old.update({}); await old.start();
  const h = deferred(); hold = h.p;
  const d40 = {}; for (let i = 1; i <= 40; i++) d40[i] = { v: 'r' };
  old.update(d40); old.flush(); await tick(); await tick();       // 写盘挂在主进程
  old.update({ ...d40, 41: { v: 'r' } });                           // 写盘期间又多了一个决定
  old.dispose();                                                    // 离开：还要再写一次
  const nu = new DraftSync(ctx('l2')); nu.build = async (_m, _o, d) => ({ ...built(), bytes: textOf(d) });
  const newest = { ...d40, 41: { v: 'r' }, 1: { v: 'a' } };
  nu.update({ ...d40, 41: { v: 'r' } }); nu.update(newest);        // 回到这一对，改了一处
  hold = null; h.r();
  await wait(400);
  assert.equal([...disk.values()][0].size, JSON.stringify(newest).length, 'last write is the newest decisions');
  assert.equal(nu.state.s, 'saved');
  nu.dispose();
});
test('1.9.2 cannot write on quit: reported and recorded; reopening recovers', async () => {
  disk.clear(); const s = new DraftSync(ctx('l3')); s.build = async (_m, _o, d) => ({ ...built(), bytes: textOf(d) });
  s.update({}); await s.start();
  const p = [...disk.keys()][0]; disk.set(p, { mtime: 999, size: 1 }); // 被别人改过
  s.update({ 1: { v: 'r' }, 2: { v: 'r' } });
  const left = await flushDrafts(500);
  assert.equal(left.length, 1); assert.equal(left[0].behind, 2); assert.equal(left[0].s, 'modified');
  assert.equal(pendingDrafts().l3.behind, 2, 'pending recorded for restart');
  s.dispose();
  // 重启后（这里直接新实例）：用户处理了冲突（改回登记的状态），打开这一对时自动补写
  disk.set(p, records.l3.draft.stat);
  const r = new DraftSync(ctx('l3')); r.build = async (_m, _o, d) => ({ ...built(), bytes: textOf(d) });
  assert.equal(r.state.recovering, true);
  r.update({ 1: { v: 'r' }, 2: { v: 'r' } });
  await wait(100);
  assert.equal(r.state.s, 'saved'); assert.deepEqual(pendingDrafts(), {}, 'pending cleared after recovery');
  r.dispose();
});

// 1.9.5：启动提示勾了“不再提示”后，只在没写进去的决定数不变时保持安静；数字变多就重新提示
test('mute holds only while the unwritten count does not grow (1.9.5)', async () => {
  disk.clear(); const pk = 'mute-195';
  const s = new DraftSync(ctx(pk)); s.build = async () => built();
  await s.start();
  const save0 = window.api.draftSave;
  window.api.draftSave = async () => ({ ok: false, code: 'locked' });
  try {
    s.update({ 1: { v: 'a' } });
    await flushDrafts(300);
    assert.equal(pendingDrafts()[pk]?.behind, 1);
    mutePending([pk]);
    assert.equal(pendingDrafts()[pk]?.muted, true);
    await flushDrafts(300);
    assert.equal(pendingDrafts()[pk]?.muted, true, 'same count: stays quiet');
    s.update({ 1: { v: 'a' }, 2: { v: 'r' } });
    await flushDrafts(300);
    assert.equal(pendingDrafts()[pk]?.behind, 2);
    assert.ok(!pendingDrafts()[pk]?.muted, 'count grew: prompts again');
  } finally { window.api.draftSave = save0; s.dispose(); }
});

// 1.9.5：回复 / 不带入的批注变了也算没写进去，写进去后清掉
test('comment replies count as unwritten until written (1.9.5)', async () => {
  disk.clear(); const s = new DraftSync(ctx('cm-195')); let seen = null; s.build = async () => { seen = s.cm; return built(); };
  s.setComments({ replies: [], drop: [] });
  await s.start();
  assert.equal(s.behindCount(), 0);
  s.setComments({ replies: [{ parent: '10', text: '好', at: 1 }], drop: [] });
  assert.equal(s.behindCount(), 1);
  await s.flush();
  assert.equal(s.behindCount(), 0);
  assert.equal(seen.replies[0].text, '好');
  s.dispose();
});
