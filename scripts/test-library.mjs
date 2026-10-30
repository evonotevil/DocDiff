// 模板 / 往来稿的纯逻辑测试：段落指纹、版本识别（并列时不替用户选）、上轮提示、条款历史。node scripts/test-library.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'library.test.mjs');
await esbuild.build({ stdin: { contents: "export * from './renderer/src/lib/library'; export * from './renderer/src/lib/hints';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: out, logLevel: 'warning' });
const L = await import('file://' + out);
const p = (t) => ({ kind: 'p', runs: [{ t }] });
const doc = (...ts) => ts.map(p);

test('fingerprint ignores whitespace and short lines, dedupes', () => {
  const a = L.fingerprint(doc('第一条 本合同由双方订立。', '第一条  本合同由双方 订立。', '1.', ''));
  assert.equal(a.length, 1);
});
test('overlap and pick: picks the version the other side used; tie → no pick', () => {
  const v1 = { id: 'v1', fp: L.fingerprint(doc('甲甲甲甲一', '乙乙乙乙二', '丙丙丙丙三', '丁丁丁丁四')) };
  const v2 = { id: 'v2', fp: L.fingerprint(doc('甲甲甲甲一', '乙乙乙乙改', '丙丙丙丙改', '丁丁丁丁四')) };
  const vendor = L.fingerprint(doc('甲甲甲甲一', '乙乙乙乙二', '丙丙丙丙三', '对方新加的段落'));
  const r = L.pick(vendor, [v1, v2]);
  assert.equal(r.best.item.id, 'v1'); assert.equal(r.tie, false);
  const same = L.pick(vendor, [v1, { id: 'v1b', fp: v1.fp }]);
  assert.equal(same.tie, true);
  assert.equal(L.pick(L.fingerprint(doc('完全不同的一段话', '另一段毫不相干')), [v1]).best, null);
});
test('versionLabel avoids collisions', () => {
  const ms = new Date(2026, 2, 5).getTime();
  assert.equal(L.versionLabel(ms, []), '2026-03');
  assert.equal(L.versionLabel(ms, ['2026-03']), '2026-03-05');
  assert.equal(L.versionLabel(ms, ['2026-03', '2026-03-05']), '2026-03-05 (2)');
});
test('hints: reverted beats related; repeat offers reuse; related has no reuse', () => {
  const th = { id: 't', versions: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }, { id: 'd', n: 4 }], rounds: [
    { a: 'a', b: 'b', items: [
      { clause: '第八条', before: '百分之二十', after: '百分之十五', v: 'r' },
      { clause: '第五条', before: '三十', after: '六十', v: 'h' },
      { clause: '第九条', before: '三年', after: '五年', v: 'a' } ] } ] };
  const ch = [
    { id: 1, kind: 'mod', before: '百分之 二十', after: '百分之十五' },
    { id: 2, kind: 'mod', before: '三十', after: '六十' },
    { id: 3, kind: 'mod', before: '五年', after: '十年' },
    { id: 4, kind: 'ins', before: '', after: '全新条款' } ];
  const cl = new Map([[1, '第八条'], [2, '第五条'], [3, '第九条'], [4, null]]);
  const h = L.hintsFor(ch, cl, th, 'd');
  assert.equal(h.get(1).kind, 'reverted'); assert.equal(h.get(1).reuse, 'r');
  assert.equal(h.get(2).kind, 'repeat'); assert.equal(h.get(2).reuse, 'h');
  assert.equal(h.get(3).kind, 'related'); assert.equal(h.get(3).reuse, undefined);
  assert.equal(h.has(4), false);
  // 只看这一轮之前的轮次
  assert.equal(L.hintsFor(ch, cl, th, 'b').size, 0);
  assert.equal(L.clauseHistory(th, '第八条', 'd').length, 1);
  assert.equal(L.clauseHistory(th, '第八条', 'b').length, 0);
});
test('home recognition: two near-identical negotiations → ambiguous, offers both (beta.5)', () => {
  const base = ['甲方应在收到发票后三十日内付款', '乙方保证所供货物符合国家标准', '违约金为合同总额的百分之二十', '本合同自双方签字盖章之日起生效', '争议提交甲方所在地人民法院'];
  const th = (id, extra) => ({ id, name: id, versions: [{ id: id + 'v1', n: 1, fp: L.fingerprint(doc(...base, extra)) }], rounds: [] });
  const fp = L.fingerprint(doc(...base, '附件一 报价单'));
  const m = L.matchThreads(fp, [th('A', '附件二 交货计划'), th('B', '附件三 售后条款')]);
  assert.ok(m && m.alt, 'ambiguous');
  const m2 = L.matchThreads(L.fingerprint(doc(...base, '附件二 交货计划')), [th('A', '附件二 交货计划'), th('B', '附件三 售后条款')]);
  assert.equal(m2.th.id, 'A'); assert.equal(m2.alt, undefined);
});
