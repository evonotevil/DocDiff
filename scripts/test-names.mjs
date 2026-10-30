// 审阅稿 / 定稿文件名规则（beta.3）：标签 {name} {date} {date:YYYY-MM-DD} {ver} {who}，空标签连同分隔符省掉。node scripts/test-names.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'names.test.mjs');
await esbuild.build({ stdin: { contents: "export { fillName, draftName } from './renderer/src/lib/draft/client';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: out, logLevel: 'warning', define: { 'import.meta.url': '""' } });
globalThis.window = globalThis.window || {}; globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const N = await import('file://' + out);
const now = new Date(2026, 9, 28, 10).getTime();
test('old patterns still work', () => {
  assert.equal(N.draftName('{name}-定稿', '/x/合同-乙方.docx', '', { now }), '合同-乙方-定稿.docx');
  assert.equal(N.draftName('', '/x/合同.docx', '', { now }), '合同-我方意见.docx');
});
test('date tag in both formats, free text kept', () => {
  assert.equal(N.draftName('{date}-legal', '/x/a.docx', '', { now }), '20261028-legal.docx');
  assert.equal(N.draftName('{date:YYYY-MM-DD}-{name}-legal', '/x/合同.docx', '', { now }), '2026-10-28-合同-legal.docx');
});
test('name keeps no DocDiff suffix', () => {
  assert.equal(N.draftName('{date}-{name}', '/x/合同-我方意见 (2).docx', '', { now }), '20261028-合同.docx');
});
test('empty ver / who dropped with one separator', () => {
  assert.equal(N.draftName('{name}-{ver}-定稿', '/x/合同.docx', '', { now }), '合同-定稿.docx');
  assert.equal(N.draftName('{ver}-{name}', '/x/合同.docx', '', { now }), '合同.docx');
  assert.equal(N.draftName('{name}-{who}', '/x/合同.docx', '', { now }), '合同.docx');
  assert.equal(N.draftName('{name}-{ver}-{who}', '/x/合同.docx', '', { now, ver: 'V4', who: '法务' }), '合同-V4-法务.docx');
});
test('unsafe characters in values are replaced', () => {
  assert.equal(N.draftName('{name}-{who}', '/x/合同.docx', '', { now, who: 'a/b' }), '合同-a_b.docx');
});
