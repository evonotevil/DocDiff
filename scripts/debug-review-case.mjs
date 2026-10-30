// 调试审阅稿写回的一个样本：打印包含某段文字的比较行（token 级）和对应的写入计划。
// node scripts/debug-review-case.mjs <夹具目录> <样本名> <要找的文字>   （先跑一次 test-review-draft.mjs 生成 .cache 里的打包）
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';
const El = Object.getPrototypeOf(new DOMParser().parseFromString('<a><b/></a>', 'application/xml').documentElement);
const nextEl = (n) => { while (n && n.nodeType !== 1) n = n.nextSibling; return n || null; };
Object.defineProperty(El, 'firstElementChild', { get() { return nextEl(this.firstChild); } });
Object.defineProperty(El, 'nextElementSibling', { get() { return nextEl(this.nextSibling); } });
globalThis.DOMParser = DOMParser;
const X = await import(new URL('../.cache/review-draft.test.mjs', import.meta.url).href);
const [dir, name, needle = ''] = process.argv.slice(2);
const ld = async (s) => { const data = new Uint8Array(fs.readFileSync(`${dir}/${name}-${s}.docx`)); return X.parseDocx({ path: 'x', name: 'x', ext: 'docx', size: 0, mtime: 0, birthtime: 0, data }); };
const A = await ld('A'), B = await ld('B');
const bA = X.compareBlocks(A), bB = X.compareBlocks(B);
const res = X.diffDocsSec(bA, bB, { ignoreCase: false, ignoreWhitespace: true, precision: 'word', formatting: true, detectMoves: true, normPunct: false, mergeParas: true });
const plan = X.buildPlan(res, bA, bB);
const strip = (s) => s.replace(/\s+/g, '');
const cids = new Set();
res.rows.forEach((r, i) => {
  const ta = (r.aList || (r.ai !== undefined ? [r.ai] : [])).map((k) => X.blockText(bA[k])).join(' / ');
  const tb = (r.bList || (r.bi !== undefined ? [r.bi] : [])).map((k) => X.blockText(bB[k])).join(' / ');
  if (needle && !strip(ta).includes(needle) && !strip(tb).includes(needle)) return;
  console.log(`#${i} ${r.kind} ai=${r.aList || r.ai} bi=${r.bList || r.bi}\n  A: ${ta}\n  B: ${tb}`);
  console.log('  ' + r.merged.map((m) => (m.op === 0 ? (m.b?.t ?? '') : m.op === -1 ? `[-${m.a.t}${m.cid ?? ''}${m.wsOnly ? 'w' : ''}]` : `[+${m.b.t}${m.cid ?? ''}${m.wsOnly ? 'w' : ''}]`)).join(''));
  r.cids.forEach((c) => cids.add(c));
});
for (const o of plan.ops.filter((o) => cids.has(o.cid))) console.log(' ', JSON.stringify(o).slice(0, 220));
