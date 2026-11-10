// 1.9.5 批注：解析、挂到比较结果上、写进审阅稿（回复线程、不带入）。只用 make-comments-195.py 的虚构夹具。
// python3 scripts/make-comments-195.py && node scripts/test-comments-195.mjs   （SOFFICE=1 时再用 LibreOffice 核对回复线程）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'work/comments-195');
const bundle = path.join(root, '.cache', 'comments.test.mjs');
await esbuild.build({ entryPoints: [path.join(root, 'scripts/comments.entry.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: bundle, logLevel: 'warning' });
{
  const El = Object.getPrototypeOf(new DOMParser().parseFromString('<a><b/></a>', 'application/xml').documentElement);
  const nextEl = (n) => { while (n && n.nodeType !== 1) n = n.nextSibling; return n || null; };
  Object.defineProperty(El, 'firstElementChild', { get() { return nextEl(this.firstChild); } });
  Object.defineProperty(El, 'nextElementSibling', { get() { return nextEl(this.nextSibling); } });
  globalThis.DOMParser = DOMParser;
}
const X = await import('file://' + bundle);
const io = { parse: (s) => new DOMParser().parseFromString(s, 'application/xml'), serialize: (d) => new XMLSerializer().serializeToString(d) };
const load = async (p) => { const data = new Uint8Array(fs.readFileSync(p)); return X.parseDocx({ path: p, name: path.basename(p), ext: 'docx', size: data.length, mtime: 0, birthtime: 0, data }); };
const OPTS = { ignoreCase: false, ignoreWhitespace: true, precision: 'word', formatting: true, detectMoves: true, normPunct: false, mergeParas: true };

const A = await load(path.join(FIX, 'cm-A.docx')), B = await load(path.join(FIX, 'cm-B.docx'));
const RA = { ...A, blocks: X.compareBlocks(A) }, RB = { ...B, blocks: X.compareBlocks(B) };
const res = X.diffDocsSec(RA.blocks, RB.blocks, OPTS);
const ours = ['王同事（示例）', '赵经理（示例）'];
const th = X.buildThreads(RA, RB, res, { ours, reviewer: '测试审阅人', rowClause: X.rowClauses(res, RA.blocks, RB.blocks) });
const get = (k) => th.find((x) => x.key === k);

test('parse: ranges, quotes, replies, resolved, deleted text, table cell, multi-paragraph', () => {
  const c = Object.fromEntries(B.comments.map((x) => [x.id, x]));
  assert.equal(c['10'].quote, '十五日内');
  assert.equal(c['11'].parent, '10');
  assert.equal(c['13'].done, true);
  assert.equal(c['16'].quote, ''); assert.equal(c['16'].delText, '乙方可单方解除合同。');
  assert.deepEqual([c['19'].from.c, c['19'].quote], [1, '十二万元']);
  assert.equal(c['20'].quote, '本合同一式两份。\n双方各执一份。');
  assert.equal(c['18'].text, '这里先别松口，等财务确认后再回。\n内部意见，勿外发。');
});
test('parse: comment markers never leak into the text or change block counts', async () => {
  const plain = await load(path.join(FIX, 'cm-plain-B.docx'));
  assert.equal(B.blocks.length, plain.blocks.length);
  assert.deepEqual(B.blocks.map((b) => JSON.stringify(b)), plain.blocks.map((b) => JSON.stringify(b)));
});
test('threads: attach to the change under the commented text', () => {
  assert.deepEqual(get('b:10').cids, [res.changes.find((x) => x.before === '三十').id]);
  assert.equal(get('b:16').onDeleted, true); assert.equal(get('b:16').cids.length, 1);
  assert.equal(get('b:19').marks[0].c, 1);
});
test('threads: comments on unchanged text are plain; our-draft comments map to the revised text', () => {
  assert.equal(get('b:15').plain, true); assert.equal(get('b:20').plain, true); assert.equal(get('b:20').marks.length, 2);
  const a1 = get('a:1');
  assert.equal(a1.plain, true); assert.equal(a1.changedByThem, false);
  assert.deepEqual(a1.bMarks.map((m) => [m.s, m.e]), [[8, 14]]);
  assert.equal(get('a:2').changedByThem, true); assert.equal(get('a:2').gone, false);
});
test('threads: owner by name, internal only for our team in their draft (not the reviewer)', () => {
  assert.equal(get('b:10').owner, 'theirs'); assert.equal(get('b:18').owner, 'ours'); assert.equal(get('b:18').internal, true);
  assert.equal(get('b:10').replied, true, 'a reply by our team counts as replied');
  assert.equal(get('b:13').replied, true, 'a reply by the reviewer counts too');
  const ints = X.internalComments(RB, th, { ours, reviewer: '测试审阅人' }).map((x) => x.id).sort();
  assert.deepEqual(ints, ['11', '18']);
  const th2 = X.buildThreads(RA, RB, res, { ours: [], reviewer: '测试审阅人', overrides: { 'b:18': 'ours' } });
  assert.equal(th2.find((x) => x.key === 'b:18').owner, 'ours', 'manual override wins');
});
test('groups and counts', () => {
  const g = Object.fromEntries(th.map((x) => [x.key, X.groupOf(x)]));
  assert.equal(g['a:2'], 'changed'); assert.equal(g['b:13'], 'resolved'); assert.equal(g['b:18'], 'ours'); assert.equal(g['b:15'], 'plain');
  assert.equal(th.filter(X.live).length, 8);
});
test('redline: replies become Word replies; dropped comments disappear with their markers; verify still passes', async () => {
  const plan = X.buildPlan(res, RA.blocks, RB.blocks);
  const out = await X.writeReview({ base: B.file.data, plan, decisions: { 1: { v: 'a' }, 3: { v: 'h', note: '再议' } }, mode: 'draft', reviewer: '测试审阅人', reviewerInitials: 'CS', theirs: 'O', theirsDate: 0, now: Date.UTC(2026, 10, 10), io,
    replies: [{ parent: '10', text: '同意改为十五日。', at: 1 }, { parent: '15', text: '从终止起算。\n第二行', at: 2 }], dropComments: ['18', '11'] });
  assert.deepEqual(out.unwritten, []);
  const dir = path.join(FIX, 'out'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'draft-test.docx'); fs.writeFileSync(f, out.bytes);
  const D = await load(f);
  const byText = (s) => D.comments.find((c) => c.text.startsWith(s));
  assert.equal(byText('同意改为').parent, '10'); assert.equal(byText('同意改为').quote, '十五日内');
  assert.equal(byText('从终止起算').parent, '15');
  assert.ok(!D.comments.some((c) => c.id === '18' || c.id === '11'));
  assert.ok(D.comments.some((c) => c.text === '待议：再议'));
  if (process.env.SOFFICE) {
    execFileSync('soffice', ['--headless', '--convert-to', 'fodt', '--outdir', dir, f], { stdio: 'ignore', timeout: 120000 });
    const fodt = fs.readFileSync(f.replace(/\.docx$/, '.fodt'), 'utf8');
    assert.ok((fodt.match(/loext:parent-name=/g) || []).length >= 2, 'LibreOffice shows the replies as replies');
  }
});
test('final: still drops every comment', async () => {
  const plan = X.buildPlan(res, RA.blocks, RB.blocks);
  const out = await X.writeReview({ base: B.file.data, plan, decisions: {}, mode: 'final', pending: 'b', reviewer: 'T', theirs: 'O', theirsDate: 0, now: 0, io, replies: [{ parent: '10', text: 'x', at: 1 }] });
  const f = path.join(FIX, 'out', 'final-test.docx'); fs.writeFileSync(f, out.bytes);
  const D = await load(f);
  assert.equal(D.comments, undefined);
});
// 1.9.6：Word 的 w:date 是本地钟点（带 Z 但不是 UTC）。读的时候按本地钟点理解，写的时候写本地钟点
test('dates: w:date is local wall time when reading and writing (TZ=' + (process.env.TZ || 'local') + ')', async () => {
  const c10 = B.comments.find((c) => c.id === '10');
  const d = new Date(c10.date);
  assert.deepEqual([d.getDate(), d.getHours(), d.getMinutes()], [8, 14, 20], 'shown as 14:20 local, like Word shows it');
  const plan = X.buildPlan(res, RA.blocks, RB.blocks);
  const at = new Date(2026, 10, 10, 9, 5, 0).getTime(); // 本地 9:05
  const out = await X.writeReview({ base: B.file.data, plan, decisions: { 1: { v: 'h', note: '再议', at } }, mode: 'draft', reviewer: 'T', theirs: 'O', theirsDate: 0, now: at, io, replies: [{ parent: '10', text: '好', at }] });
  const JSZip = (await import('jszip')).default;
  const z = await JSZip.loadAsync(out.bytes);
  const cx = await z.file('word/comments.xml').async('string');
  const dx = await z.file('word/document.xml').async('string');
  assert.match(cx, /w:author="T" w:date="2026-11-10T09:05:00Z"/, 'reply and note written as local wall time');
  assert.ok(!/w:date="2026-11-10T0[01]:05:00Z"/.test(cx) || new Date().getTimezoneOffset() === 0);
  assert.match(dx, /w:date="2026-11-10T09:05:00Z"|w:date="19(69|70)/, "revisions use the same convention");
});
