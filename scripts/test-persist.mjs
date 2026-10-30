// 本机存储的故障注入（1.8 beta.5）：主文件坏了、.bak 完好时，下一次保存在改名前失败，.bak 必须仍然可读。node scripts/test-persist.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createStore } = require('../electron/persist.cjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dd-persist-'));
const failRename = (target, fn) => { const r = fs.renameSync; fs.renameSync = (a, b) => { if (b === target) throw Object.assign(new Error('simulated interruption before rename'), { code: 'EIO' }); return r(a, b); }; try { return fn(); } finally { fs.renameSync = r; } };

test('corrupt main + valid backup: failed save keeps the backup readable', () => {
  const d = tmp(); const f = path.join(d, 'review.json');
  fs.writeFileSync(f, '{broken'); fs.writeFileSync(f + '.bak', JSON.stringify({ v: 'reject' }));
  const s = createStore(d);
  assert.deepEqual(s.read('review.json', null), { v: 'reject' });
  assert.throws(() => failRename(f, () => s.write('review.json', { v: 'accept' })));
  assert.deepEqual(s.read('review.json', null), { v: 'reject' }, 'backup still valid');
  assert.equal(fs.readFileSync(f + '.bak', 'utf8'), JSON.stringify({ v: 'reject' }));
  // 之后保存成功：新主文件生效
  s.write('review.json', { v: 'accept' });
  assert.deepEqual(s.read('review.json', null), { v: 'accept' });
});
test('valid main is rotated to backup before replacing', () => {
  const d = tmp(); const s = createStore(d); const f = path.join(d, 'a.json');
  s.write('a.json', { n: 1 }); s.write('a.json', { n: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f + '.bak', 'utf8')), { n: 1 });
  assert.throws(() => failRename(f, () => s.write('a.json', { n: 3 })));
  assert.deepEqual(s.read('a.json', null), { n: 2 }, 'main untouched when rename fails');
});
test('main corrupted on disk after a good write is not rotated over the backup', () => {
  const d = tmp(); const s = createStore(d); const f = path.join(d, 'b.json');
  s.write('b.json', { n: 1 }); s.write('b.json', { n: 2 });
  fs.writeFileSync(f, '{bro'); // 外部损坏（大小、时间都变了）
  assert.throws(() => failRename(f, () => s.write('b.json', { n: 3 })));
  assert.deepEqual(JSON.parse(fs.readFileSync(f + '.bak', 'utf8')), { n: 1 });
});
