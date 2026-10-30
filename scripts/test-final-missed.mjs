// 定稿里没能落实的决定必须报出来（beta.5，评估 F1）。用真实的解析、比较、计划、写入器和 DraftSync.buildFinal，并检查输出 DOCX 的内容。
// 先 node scripts/make-header-fixtures.mjs；再 node scripts/test-final-missed.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'work/review-fixtures');
const b1 = path.join(root, '.cache', 'final-missed.writer.mjs'), b2 = path.join(root, '.cache', 'final-missed.client.mjs');
await esbuild.build({ entryPoints: [path.join(root, 'scripts/review-draft.entry.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: b1, logLevel: 'warning' });
await esbuild.build({ stdin: { contents: "export { DraftSync } from './renderer/src/lib/draft/client';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: b2, logLevel: 'warning' });
{
  const El = Object.getPrototypeOf(new DOMParser().parseFromString('<a><b/></a>', 'application/xml').documentElement);
  const nextEl = (n) => { while (n && n.nodeType !== 1) n = n.nextSibling; return n || null; };
  Object.defineProperty(El, 'firstElementChild', { get() { return nextEl(this.firstChild); } });
  Object.defineProperty(El, 'nextElementSibling', { get() { return nextEl(this.nextSibling); } });
  globalThis.DOMParser = DOMParser;
}
globalThis.window = { api: { reviewGet: () => null, reviewIndex: () => ({}), reviewSave: () => Promise.resolve({ ok: true }) } };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const X = await import('file://' + b1);
const { DraftSync } = await import('file://' + b2);
const io = { parse: (s) => new DOMParser().parseFromString(s, 'application/xml'), serialize: (d) => new XMLSerializer().serializeToString(d) };
const load = async (p) => { const data = new Uint8Array(fs.readFileSync(p)); return X.parseDocx({ path: p, name: path.basename(p), ext: 'docx', size: data.length, mtime: 1, birthtime: 1, data }); };
const OPTS = { ignoreCase: false, ignoreWhitespace: true, precision: 'word', formatting: true, detectMoves: true, normPunct: false, mergeParas: true };

async function finalFor(fa, fb, verdict, pending = 'b') {
  const A = await load(path.join(FIX, fa)), B = await load(path.join(FIX, fb));
  const ba = X.compareBlocks(A), bb = X.compareBlocks(B);
  const res = X.diffDocsSec(ba, bb, OPTS);
  const plan = X.buildPlan(res, ba, bb);
  const decisions = Object.fromEntries(res.changes.map((c) => [c.id, verdict ? { v: verdict, at: 1 } : {}]));
  const sync = new DraftSync({ pk: 'x', bPath: '/x/' + fb, bName: fb, bData: B.file.data, plan, reviewer: 'T', initials: 'T', theirs: 'O', theirsDate: 1, pattern: '{name}-定稿' });
  sync.update(decisions); sync.dispose(); // 只为把决定交给它；不写审阅稿
  // 真实写入器代替 Worker
  sync.build = (mode, o) => X.writeReview({ base: B.file.data, plan, decisions, mode, pending: o.pending, keepComments: false, reviewer: 'T', reviewerInitials: 'T', theirs: 'O', theirsDate: 1, now: 2, io });
  const r = await sync.buildFinal({ pending });
  const zip = await JSZip.loadAsync(r.out.bytes);
  const xml = async (re) => (await Promise.all(Object.keys(zip.files).filter((f) => re.test(f)).map((f) => zip.file(f).async('string')))).join('');
  return { res, r, header: await xml(/^word\/header\d*\.xml$/), body: await xml(/^word\/document\.xml$/) };
}

test('rejected header amount cannot be written → reported as missed; file content matches what we report', async () => {
  const { res, r, header } = await finalFor('header-V1.docx', 'header-V2.docx', 'r');
  const hc = res.changes.find((c) => c.sec === 'header');
  assert.ok(hc, 'header change detected');
  assert.deepEqual(r.missed.map((m) => m.cid), [hc.id], 'the rejected header change is reported');
  assert.equal(r.missed[0].reason, 'section');
  assert.ok(header.includes('198000') && !header.includes('120000'), 'output really still has their amount (so the warning is true)');
});
test('accepted header change: nothing to report (their text is the intended result)', async () => {
  const { r, header } = await finalFor('header-V1.docx', 'header-V2.docx', 'a');
  assert.equal(r.missed.length, 0);
  assert.ok(header.includes('198000'));
});
test('undecided header change: reported only when “改回我方原文” is chosen', async () => {
  assert.equal((await finalFor('header-V1.docx', 'header-V2.docx', null, 'b')).r.missed.length, 0);
  assert.equal((await finalFor('header-V1.docx', 'header-V2.docx', null, 'a')).r.missed.length, 1);
});
test('control: rejected body changes are written into the final file and not reported', async () => {
  const { r, body } = await finalFor('basic-A.docx', 'basic-B.docx', 'r');
  assert.equal(r.missed.length, 0);
  assert.ok(body.length > 0);
});
