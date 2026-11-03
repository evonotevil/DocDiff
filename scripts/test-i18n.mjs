// 英文单复数（1.8.1）。node scripts/test-i18n.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'i18n.test.mjs');
await esbuild.build({ stdin: { contents: "export { plural } from './renderer/src/lib/i18n';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: out, logLevel: 'warning' });
globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.window = globalThis;
const { plural } = await import('file://' + out);
const cases = [
  ['Header 1 differences', { n: 1 }, 'Header 1 difference'], ['Header 2 differences', { n: 2 }, 'Header 2 differences'],
  ['0 differences', { n: 0 }, '0 differences'], ['11 differences', { n: 11 }, '11 differences'],
  ['1 pages', { n: 1 }, '1 page'], ['21 paragraphs', { n: 21 }, '21 paragraphs'], ['1 paragraphs', { n: 1 }, '1 paragraph'],
  ['Add 1 more file(s)', { n: 1 }, 'Add 1 more file'], ['Add 2 more file(s)', { n: 2 }, 'Add 2 more files'],
  ['All 1 changes handled', { n: 1 }, 'All 1 change handled'], ['2.1 pages', { n: 2.1 }, '2.1 pages'],
  ['1 open items — consider resolving them first', { n: 1 }, '1 open item — consider resolving them first'], ['3 open items', { n: 3 }, '3 open items'], ['1 unchanged paragraphs', { n: 1 }, '1 unchanged paragraph'],
];
for (const [s, v, want] of cases) test(`${s} (${JSON.stringify(v)})`, () => assert.equal(plural(s, v), want));
