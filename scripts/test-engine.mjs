// 引擎回归测试：node scripts/test-engine.mjs
// 先用 esbuild 把 engine.ts 打成 ESM（引擎依赖 docx.ts / i18n.ts，都是纯逻辑），再跑 node:test。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'engine.test.mjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'renderer/src/lib/engine.ts')],
  bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: out, logLevel: 'warning',
});
const E = await import(path.toFileURL ? path.toFileURL(out).href : 'file://' + out);
const { diffDocs, tokenize, linesToBlocks } = E;

// ---------- 构造块的小工具 ----------
const O = (x = {}) => ({
  ignoreCase: false, ignoreWhitespace: false, precision: 'word',
  formatting: true, detectMoves: true, ...x,
});
const p = (t, st = {}) => ({ kind: 'p', runs: [{ t, ...st }] });
const mix = (...rs) => ({ kind: 'p', runs: rs });
const h = (t, level = 1) => ({ kind: 'h', level, runs: [{ t }] });
const tr = (...cells) => ({ kind: 'tr', runs: [], cells: cells.map((c) => [{ t: c }]) });
const S = (a, b, o) => diffDocs(a, b, O(o)).stats;
const kinds = (a, b, o) => diffDocs(a, b, O(o)).rows.map((r) => r.kind);

// ---------- 1. 基本判等 ----------
test('完全相同的文档不产生任何变更', () => {
  const a = [p('第一段'), p('第二段')];
  const r = diffDocs(a, [p('第一段'), p('第二段')], O());
  assert.deepEqual(r.stats, { del: 0, ins: 0, mod: 0, fmt: 0, move: 0 });
  assert.deepEqual(r.rows.map((x) => x.kind), ['equal', 'equal']);
  assert.equal(r.changes.length, 0);
});

test('空文档对空文档', () => {
  const r = diffDocs([], [], O());
  assert.equal(r.rows.length, 0);
  assert.equal(r.changes.length, 0);
});

// ---------- 2. 增删 ----------
test('末尾新增一段记为 ins', () => {
  const s = S([p('甲')], [p('甲'), p('乙')]);
  assert.equal(s.ins, 1);
  assert.equal(s.del, 0);
});

test('删除一段记为 del', () => {
  const s = S([p('甲'), p('乙')], [p('甲')]);
  assert.equal(s.del, 1);
  assert.equal(s.ins, 0);
});

test('中间插入一段不会把后面的段落全部标成改动', () => {
  const a = [p('一'), p('二'), p('三')];
  const b = [p('一'), p('新插入的一段'), p('二'), p('三')];
  const r = diffDocs(a, b, O());
  assert.equal(r.stats.ins, 1);
  assert.equal(r.stats.mod, 0);
  assert.equal(r.rows.filter((x) => x.kind === 'equal').length, 3);
});

// ---------- 3. 段内修改 ----------
test('段内改词记为 mod，并且只圈出变化的那部分', () => {
  const r = diffDocs([p('合同金额为一百万元')], [p('合同金额为两百万元')], O());
  assert.equal(r.stats.mod, 1);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].kind, 'modified');
  const c = r.changes[0];
  assert.equal(c.before, '一');
  assert.equal(c.after, '两');
});

test('英文按词切分，不会把一个单词切碎', () => {
  const toks = tokenize(p('the quick brown fox'), O()).filter((t) => !t.ws);
  assert.deepEqual(toks.map((t) => t.t), ['the', 'quick', 'brown', 'fox']);
});

test('中文逐字切分', () => {
  const toks = tokenize(p('合同金额'), O()).filter((t) => !t.ws);
  assert.deepEqual(toks.map((t) => t.t), ['合', '同', '金', '额']);
});

test('precision=char 下英文也逐字符切分', () => {
  const toks = tokenize(p('abc'), O({ precision: 'char' })).filter((t) => !t.ws);
  assert.deepEqual(toks.map((t) => t.t), ['a', 'b', 'c']);
});

// ---------- 4. 归一化选项 ----------
test('ignoreCase 打开后大小写差异不算变更', () => {
  assert.equal(S([p('Hello World')], [p('hello world')], { ignoreCase: true }).mod, 0);
  assert.ok(S([p('Hello World')], [p('hello world')], { ignoreCase: false }).mod > 0);
});

test('一段换一段即使毫不相似也左右配对，而不是拆成删除+新增', () => {
  const r = diffDocs([p('原来这里写的是甲方负责运输')], [p('完全换了一句无关的话')], O());
  assert.equal(r.rows.length, 1, '应当只有一行，左右对照');
  assert.equal(r.rows[0].kind, 'modified');
  assert.equal(r.stats.mod, 1);
  assert.equal(r.stats.del, 0);
  assert.equal(r.stats.ins, 0);
});

test('未配对的段落按先删后增排序', () => {
  // 左边两段都被删，右边两段都是新增，且彼此不相似：删除应排在新增前面
  const a = [p('保密义务与竞业限制'), p('违约金计算方式'), p('共同的结尾段落在这里')];
  const b = [p('alpha bravo charlie'), p('delta echo foxtrot'), p('共同的结尾段落在这里')];
  const r = diffDocs(a, b, O({ detectMoves: false }));
  const seq = r.rows.map((x) => x.kind).filter((k) => k === 'removed' || k === 'added');
  assert.deepEqual(seq, ['removed', 'removed', 'added', 'added']);
});

test('大区段会触发降级并在结果里标记出来', () => {
  // 构造左右各 220 段互不相同的内容：220*220 = 48400 > 40000，必然走回退分支
  const mk = (side) => Array.from({ length: 220 }, (_, i) => p(`${side} 第 ${i} 条独有内容，用来把区段撑大`));
  const r = diffDocs(mk('左'), mk('右'), O({ mergeParas: true }));
  assert.ok(r.degraded, '应当报告降级');
  assert.equal(r.degraded.pairFallback, true);
  assert.ok(r.degraded.maxRegion > 40000);
});

test('正常大小的文档不报降级', () => {
  const r = diffDocs([p('甲'), p('乙')], [p('甲'), p('丙')], O({ mergeParas: true }));
  assert.equal(r.degraded, undefined);
});

test('normPunct 把全角标点视为等同', () => {
  assert.equal(S([p('甲方，乙方')], [p('甲方,乙方')], { normPunct: true }).mod, 0);
  assert.ok(S([p('甲方，乙方')], [p('甲方,乙方')], { normPunct: false }).mod > 0);
});

test('ignoreWhitespace 吃掉多余空格', () => {
  assert.equal(S([p('a  b')], [p('a b')], { ignoreWhitespace: true }).mod, 0);
});

// ---------- 5. 格式差异 ----------
test('只加粗不改字，记为 fmt 而不是 mod', () => {
  const r = diffDocs([p('重要条款')], [p('重要条款', { b: true })], O());
  assert.equal(r.stats.mod, 0);
  assert.equal(r.stats.del, 0);
  assert.equal(r.stats.ins, 0);
  assert.equal(r.stats.fmt, 1);
  assert.equal(r.rows[0].kind, 'format');
});

test('formatting 关闭时忽略纯格式差异', () => {
  const s = S([p('重要条款')], [p('重要条款', { b: true })], { formatting: false });
  assert.deepEqual(s, { del: 0, ins: 0, mod: 0, fmt: 0, move: 0 });
});

test('标题级别变化记为格式变化', () => {
  const r = diffDocs([h('第一章', 1)], [h('第一章', 2)], O());
  assert.equal(r.stats.fmt, 1);
  assert.deepEqual(r.rows[0].blockDesc, { k: 'kind', a: 'h1', b: 'h2' });
});

test('对齐方式变化记为格式变化', () => {
  const a = [{ kind: 'p', align: 'left', runs: [{ t: '居左的文字' }] }];
  const b = [{ kind: 'p', align: 'center', runs: [{ t: '居左的文字' }] }];
  assert.equal(diffDocs(a, b, O()).stats.fmt, 1);
});

test('图片内容变化能被识别', () => {
  const a = [mix({ t: '', img: 'hash-aaa' })];
  const b = [mix({ t: '', img: 'hash-bbb' })];
  const s = diffDocs(a, b, O()).stats;
  assert.ok(s.mod + s.del + s.ins > 0, '换了一张图应当产生变更');
});

// ---------- 6. 移动检测 ----------
test('整段移动记为 move，不是一删一增', () => {
  const long = '本条款约定双方的保密义务与违约责任';
  const a = [p(long), p('甲'), p('乙')];
  const b = [p('甲'), p('乙'), p(long)];
  const r = diffDocs(a, b, O({ detectMoves: true }));
  assert.equal(r.stats.move, 1);
  assert.equal(r.stats.del, 0);
  assert.equal(r.stats.ins, 0);
  assert.ok(r.rows.some((x) => x.kind === 'moved-from'));
  assert.ok(r.rows.some((x) => x.kind === 'moved-to'));
});

test('detectMoves 关闭时退化成一删一增', () => {
  const long = '本条款约定双方的保密义务与违约责任';
  const r = diffDocs([p(long), p('甲')], [p('甲'), p(long)], O({ detectMoves: false }));
  assert.equal(r.stats.move, 0);
  assert.equal(r.stats.del + r.stats.ins, 2);
});

test('太短的段落不参与移动检测，避免误判', () => {
  const r = diffDocs([p('是'), p('甲')], [p('甲'), p('是')], O({ detectMoves: true }));
  assert.equal(r.stats.move, 0);
});

// ---------- 7. 段落拆分 / 合并 ----------
test('一段拆成两段能被识别为段落拆分', () => {
  const whole = '前半部分讲的是付款方式，后半部分讲的是验收标准';
  const a = [p(whole)];
  const b = [p('前半部分讲的是付款方式，'), p('后半部分讲的是验收标准')];
  const r = diffDocs(a, b, O({ mergeParas: true }));
  const row = r.rows[0];
  assert.ok(row.bList && row.bList.length === 2, '应把右侧两段并入同一行');
  assert.equal(row.blockDesc.k, 'split');
});

test('两段合并成一段能被识别', () => {
  const whole = '前半部分讲的是付款方式，后半部分讲的是验收标准';
  const a = [p('前半部分讲的是付款方式，'), p('后半部分讲的是验收标准')];
  const b = [p(whole)];
  const r = diffDocs(a, b, O({ mergeParas: true }));
  const row = r.rows[0];
  assert.ok(row.aList && row.aList.length === 2, '应把左侧两段并入同一行');
});

test('mergeParas 关闭时不做拆分合并识别', () => {
  const whole = '前半部分讲的是付款方式，后半部分讲的是验收标准';
  const r = diffDocs([p(whole)], [p('前半部分讲的是付款方式，'), p('后半部分讲的是验收标准')], O({ mergeParas: false }));
  assert.ok(!r.rows.some((x) => x.bList && x.bList.length > 1));
});

// ---------- 8. 表格 ----------
test('表格单元格各自比较，不会串格', () => {
  const r = diffDocs([tr('姓名', '张三')], [tr('姓名', '李四')], O());
  assert.equal(r.rows.length, 1);
  assert.equal(r.stats.mod, 1);
  assert.equal(r.changes[0].before, '张三');
  assert.equal(r.changes[0].after, '李四');
});

// ---------- 9. 纯文本路径 ----------
test('linesToBlocks + diff 覆盖纯文本模式', () => {
  const a = linesToBlocks('第一行\n第二行\n第三行');
  const b = linesToBlocks('第一行\n改过的第二行\n第三行');
  const r = diffDocs(a, b, O({ formatting: false, keepEmpty: true }));
  assert.equal(r.rows.length, 3);
  assert.ok(r.stats.mod + r.stats.ins + r.stats.del > 0);
  assert.equal(r.rows[0].kind, 'equal');
  assert.equal(r.rows[2].kind, 'equal');
});

test('keepEmpty 控制空行是否参与比较', () => {
  const a = linesToBlocks('甲\n\n乙');
  const b = linesToBlocks('甲\n乙');
  assert.equal(diffDocs(a, b, O({ keepEmpty: false })).stats.del, 0);
  assert.ok(diffDocs(a, b, O({ keepEmpty: true })).stats.del > 0);
});

// ---------- 10. 变更编号 ----------
test('变更编号连续且与行内 token 对应', () => {
  const a = [p('一处改动在这里'), p('另一处改动在那里')];
  const b = [p('一处修改在这里'), p('另一处修改在那里')];
  const r = diffDocs(a, b, O());
  assert.deepEqual(r.changes.map((c) => c.id), [1, 2]);
  for (const row of r.rows) for (const cid of row.cids) assert.ok(r.changes.some((c) => c.id === cid));
});

test('同一段里的多处改动分别编号', () => {
  const r = diffDocs([p('甲方应当在十日内付款给乙方')], [p('甲方应当在三十日内转款给乙方')], O());
  assert.ok(r.changes.length >= 2, `期望至少两处变更，实得 ${r.changes.length}`);
  assert.equal(new Set(r.changes.map((c) => c.id)).size, r.changes.length);
});

// ---------- 11. 引擎输出必须与语言无关 ----------
test('引擎不再产出本地化文案，只产出结构化描述', () => {
  const a = [p('重要条款'), { kind: 'p', align: 'left', runs: [{ t: '一段文字' }] }];
  const b = [p('重要条款', { b: true, sz: 14 }), { kind: 'p', align: 'center', runs: [{ t: '一段文字' }] }];
  const r = diffDocs(a, b, O());
  const blob = JSON.stringify(r);
  assert.ok(!/[一-鿿]/.test(JSON.stringify(r.rows.map((x) => x.blockDesc))), 'blockDesc 里不应有中文');
  for (const c of r.changes) if (c.desc) assert.ok(!/[一-鿿]/.test(JSON.stringify(c.desc)), 'change.desc 里不应有中文');
  // 样式签名应当是可解析的机器格式
  const sigs = r.rows.flatMap((x) => x.merged.map((m) => m.fmt)).filter(Boolean);
  assert.ok(sigs.length > 0, '应当有样式差异');
  for (const sig of sigs) assert.match(sig, /^[a-z]/);
  assert.ok(blob.length > 0);
});

test('样式签名能稳定地分组相同的格式变化', () => {
  const a = [mix({ t: '前' }, { t: '中' }, { t: '后' })];
  const b = [mix({ t: '前', b: true }, { t: '中', b: true }, { t: '后' })];
  const r = diffDocs(a, b, O());
  const sigs = [...new Set(r.rows[0].merged.map((m) => m.fmt).filter(Boolean))];
  assert.deepEqual(sigs, ['b+'], '同一种格式变化应当是同一个签名');
  assert.equal(r.stats.fmt, 1, '相邻的同种格式变化应当合成一处');
});
