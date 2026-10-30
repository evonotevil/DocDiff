// 审阅稿同步的生命周期时序（1.8 beta.5）：用真实 DraftSync，替换掉 Worker 和主进程写盘，按确定的顺序推进。
// node scripts/test-draft-lifecycle.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'draft-lifecycle.test.mjs');
await esbuild.build({ stdin: { contents: "export { DraftSync } from './renderer/src/lib/draft/client';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: out, logLevel: 'warning' });

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
globalThis.window = { api: { reviewGet: (k) => records[k] || null, reviewIndex: () => ({}), reviewSave: (k, v) => { records[k] = v; return Promise.resolve({ ok: true }); }, exists: async (p) => disk.has(p), draftSave, draftStat: async (p) => ({ stat: disk.get(p) || null, locked: false }) } };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { DraftSync } = await import('file://' + out);
const deferred = () => { let r; const p = new Promise((x) => (r = x)); return { p, r }; };
const ctx = (pk) => ({ pk, bPath: '/w/合同.docx', bName: '合同.docx', bData: new Uint8Array([1]), plan: {}, reviewer: 'T', initials: 'T', theirs: 'O', theirsDate: 0, pattern: '{name}-我方意见' });
const built = (n = 3) => ({ bytes: new Uint8Array(n), unwritten: [], priorRevisions: 0, ms: {} });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('disposed while building: nothing is written', async () => {
  disk.clear(); const s = new DraftSync(ctx('a')); const b = deferred(); s.build = () => b.p;
  const run = s.run(); await tick(); s.dispose(); b.r(built()); await run;
  assert.equal(disk.size, 0);
  assert.equal(records.a?.draft ?? null, null);
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
