// 1.9.4 PDF 行距判段（renderer/src/lib/pdfPara.ts）的纯逻辑测试：按页常见行距、样本不足的保守回退、同页混合行距、表格行。
// node scripts/test-pdf-para.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'pdfpara.test.mjs');
await esbuild.build({ entryPoints: [path.join(root, 'renderer/src/lib/pdfPara.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: out, logLevel: 'warning' });
const P = await import('file://' + out);

const SIZE = 10.5;
/** 按“每段几行、行距倍数、段距”排出一页的行；每段最后一行短，其余写满（结尾 x = 520） */
function page(paras, { lead = 1.2, gap = 0.8, page = 1, y0 = 770 } = {}) {
  const lines = []; let y = y0;
  for (const n of paras) {
    for (let i = 0; i < n; i++) { lines.push({ y, x: 72, size: SIZE, page, text: '字'.repeat(i === n - 1 ? 12 : 40), _end: i === n - 1 ? 260 : 520 }); y -= SIZE * lead; }
    y -= SIZE * gap;
  }
  return lines;
}
const paraCount = (lines) => 1 + P.gapBreaks(lines).filter(Boolean).length;

test('单倍行距：和 1.9.3 的固定阈值一样分段', () => {
  assert.equal(paraCount(page([3, 4, 2, 5, 3])), 5);
});
test('1.5 倍、2 倍行距：不再每行一段', () => {
  assert.equal(paraCount(page([3, 4, 2, 5, 3], { lead: 2.0 })), 5);
  assert.equal(paraCount(page([3, 4, 2, 5, 3], { lead: 2.6 })), 5);
});
test('Word 2 倍行距 + 段后 6 磅（段距只比行距大约 20%）也能分开', () => {
  assert.equal(paraCount(page([3, 4, 3, 4], { lead: 2.88, gap: 0.57 })), 4);
});
test('样本不足的页面：页里的行距和全文一致才借用全文的值，否则退回固定阈值（宁可多切）', () => {
  const p1 = page([4, 5, 4, 5], { lead: 2.0 });
  const p2 = page([2], { lead: 2.0, page: 2 });
  const s = P.lineSpacingStats([...p1, ...p2]);
  assert.equal(s.pageSource.get(2), 'doc');
  const p3 = page([2], { lead: 1.2, page: 2 });
  const s2 = P.lineSpacingStats([...p1, ...p3]);
  assert.equal(s2.pageSource.get(2), 'fixed');
  // 全文也不够：固定阈值
  const s3 = P.lineSpacingStats(page([2], { lead: 2.0 }));
  assert.equal(s3.pageSource.get(1), 'fixed');
});
test('同页混合行距：前半单倍、后半 1.5 倍，段落边界都对', () => {
  const a = page([4, 3, 4], { lead: 1.2 });
  const b = page([4, 3, 4], { lead: 2.0, y0: a[a.length - 1].y - SIZE * 2 });
  assert.equal(paraCount([...a, ...b]), 6);
});
test('表格行（cols）不参与行距统计', () => {
  const l = page([4, 4], { lead: 2.0 });
  const rows = [0, 1, 2].map((i) => ({ y: l[l.length - 1].y - SIZE * (2 + i * 1.6), x: 72, size: SIZE, page: 1, text: '项目\t金额', cols: true, _end: 400 }));
  const s = P.lineSpacingStats([...l, ...rows]);
  assert.ok(Math.abs(s.pageTypical.get(1) - 2.0) < 0.01);
});
