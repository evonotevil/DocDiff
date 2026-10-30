// 审阅稿写盘的并发与外部修改（1.8 beta.5）：node scripts/test-draft-save.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { saveDraft, statOf } = require('../electron/draft-save.cjs');
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dd-ds-'));
const bytes = (s) => new TextEncoder().encode(s);

test('external edit while our temp file is being written → modified, external content kept', async () => {
  const d = dir(); const p = path.join(d, 'a-我方意见.docx');
  const r1 = await saveDraft({ path: p, data: bytes('ours-1'), expect: null });
  assert.ok(r1.ok);
  const r2 = await saveDraft({ path: p, data: bytes('ours-2'), expect: r1.stat }, { afterTemp: async () => { fs.writeFileSync(p, 'edited in Word!'); } });
  assert.equal(r2.code, 'modified');
  assert.equal(fs.readFileSync(p, 'utf8'), 'edited in Word!');
  assert.deepEqual(fs.readdirSync(d).filter((f) => f.endsWith('.ddtmp')), [], 'no temp files left');
});
test('two saves to the same path at once: serialized; the stale one is refused instead of overwriting', async () => {
  const d = dir(); const p = path.join(d, 'b.docx');
  const r0 = await saveDraft({ path: p, data: bytes('v0'), expect: null });
  const [a, b] = await Promise.all([
    saveDraft({ path: p, data: bytes('from-A'), expect: r0.stat }),
    saveDraft({ path: p, data: bytes('from-B'), expect: r0.stat }),
  ]);
  assert.ok(a.ok); assert.equal(b.code, 'modified');
  assert.equal(fs.readFileSync(p, 'utf8'), 'from-A');
});
test('first creation never overwrites an existing file', async () => {
  const d = dir(); const p = path.join(d, 'c.docx'); fs.writeFileSync(p, 'someone else');
  const r = await saveDraft({ path: p, data: bytes('x'), expect: null });
  assert.equal(r.code, 'exists'); assert.equal(fs.readFileSync(p, 'utf8'), 'someone else');
});
