// 审阅稿写回的回归测试（只用 scripts/make-review-fixtures.py 生成的虚构文档）。
// node scripts/test-review-draft.mjs [夹具目录] [输出目录]
// 每对文件 × 每种决定组合：
//   1) 写入器自己的核对（按“接受全部修订”重读，逐块对上）；
//   2) pandoc 独立读一遍：接受全部 / 拒绝全部两种视图的文字都要等于从比较结果直接推出的预期；
//   3) OOXML 结构校验（XSD，环境变量 DOCX_VALIDATE 指向 validate.py 时）；
//   4) LibreOffice 能打开（环境变量 SOFFICE=1 时，转成 PDF）。
import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = process.argv[2] || path.join(root, 'work/review-fixtures');
const OUT = process.argv[3] || path.join(root, 'work/review-out');
fs.mkdirSync(OUT, { recursive: true });
const bundle = path.join(root, '.cache', 'review-draft.test.mjs');
await esbuild.build({ entryPoints: [path.join(root, 'scripts/review-draft.entry.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: bundle, logLevel: 'warning' });

// docx.ts 用浏览器的 DOMParser 和 firstElementChild；node 里用 xmldom 补上
{
  const El = Object.getPrototypeOf(new DOMParser().parseFromString('<a><b/></a>', 'application/xml').documentElement);
  const nextEl = (n) => { while (n && n.nodeType !== 1) n = n.nextSibling; return n || null; };
  Object.defineProperty(El, 'firstElementChild', { get() { return nextEl(this.firstChild); } });
  Object.defineProperty(El, 'nextElementSibling', { get() { return nextEl(this.nextSibling); } });
  globalThis.DOMParser = DOMParser;
}
const X = await import('file://' + bundle);
const io = { parse: (s) => new DOMParser().parseFromString(s, 'application/xml'), serialize: (d) => new XMLSerializer().serializeToString(d) };
const OPTS = { ignoreCase: false, ignoreWhitespace: true, precision: 'word', formatting: true, detectMoves: true, normPunct: false, mergeParas: true };

const load = async (p) => {
  const data = new Uint8Array(fs.readFileSync(p));
  const st = fs.statSync(p);
  return X.parseDocx({ path: p, name: path.basename(p), ext: 'docx', size: data.length, mtime: st.mtimeMs, birthtime: st.birthtimeMs, data });
};

// 从比较结果直接推出“接受全部 / 拒绝全部”后的正文（与写入器的实现无关）
function viewText(res, blocksA, blocksB, act, view) {
  const keepB = (cid) => { const a = act(cid); if (view === 'final') return a !== 'revert'; if (view === 'accept') return a !== 'mine'; return a === 'keep' || a === 'mine'; };
  const keepA = (cid) => { const a = act(cid); if (view === 'final') return a === 'revert'; if (view === 'accept') return a === 'mine'; return a === 'theirs'; };
  let s = '';
  for (const r of res.rows) {
    if ((r.sec || 'body') !== 'body') continue;
    for (const m of r.merged) {
      const ws = m.wsOnly;
      if (m.op === 0 || (ws && m.b)) { if (m.b && !m.b.psep) s += m.b.t; continue; }
      if (ws) continue;
      if (m.op === 1 && m.b) { if (m.cid === undefined || keepB(m.cid)) s += m.b.t; }
      else if (m.op === -1 && m.a) { if (m.cid !== undefined && keepA(m.cid)) s += m.a.t; }
    }
  }
  return s.replace(/\[图片\]/g, '').replace(/\s+/g, '');
}
function pandocText(file, mode) {
  const j = JSON.parse(execFileSync('pandoc', [file, '-f', 'docx', '-t', 'json', `--track-changes=${mode}`], { maxBuffer: 1 << 28 }).toString());
  let s = '';
  const walk = (x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== 'object') return;
    if (x.t === 'Note') return;
    if (x.t === 'Str') { s += x.c; return; }
    if (x.t === 'Code' || x.t === 'CodeBlock') { s += x.c[1]; return; }
    if (x.c !== undefined) walk(x.c);
  };
  walk(j.blocks);
  return s.replace(/\s+/g, '');
}

const cases = fs.readdirSync(FIX).filter((f) => f.endsWith('-A.docx')).map((f) => f.slice(0, -7)).sort();
const SCEN = {
  undecided: () => ({}),
  accept: (cids) => Object.fromEntries(cids.map((c) => [c, { v: 'a', by: '测试人', at: 1793000000000 }])),
  reject: (cids) => Object.fromEntries(cids.map((c) => [c, { v: 'r', by: '测试人', at: 1793000000000 }])),
  mixed: (cids) => Object.fromEntries(cids.map((c, i) => [c, { v: ['a', 'r', 'h', undefined][i % 4], note: i % 3 === 0 ? `备注 ${i}` : undefined, by: '测试人', at: 1793000000000 + i }])),
};
const FINAL = [['final-b', 'mixed', 'b', false], ['final-a', 'mixed', 'a', false], ['final-keepcm', 'mixed', 'b', true]];
let fail = 0, n = 0;
const VALIDATE = process.env.DOCX_VALIDATE;
const report = [];
for (const name of cases) {
  const A = await load(path.join(FIX, `${name}-A.docx`));
  const B = await load(path.join(FIX, `${name}-B.docx`));
  const bA = X.compareBlocks(A), bB = X.compareBlocks(B);
  const res = X.diffDocsSec(bA, bB, OPTS);
  const plan = X.buildPlan(res, bA, bB);
  const cids = [...new Set(plan.ops.map((o) => o.cid))];
  const runs = [...Object.keys(SCEN).map((s) => [s, s, null, false]), ...FINAL];
  for (const [label, scen, pending, keepCm] of runs) {
    n++;
    const decisions = SCEN[scen](cids);
    const mode = pending ? 'final' : 'draft';
    const file = path.join(OUT, `${name}-${label}.docx`);
    const row = { case: name, scen: label, changes: res.changes.length };
    try {
      const t0 = performance.now();
      const out = await X.writeReview({ base: B.file.data, plan, decisions, mode, pending: pending || undefined, keepComments: keepCm, reviewer: '测试人', reviewerInitials: '测', theirs: '对方', theirsDate: 1792000000000, now: 1793000000000, io });
      row.ms = Math.round(performance.now() - t0); row.parts = out.ms; row.unwritten = out.unwritten.map((u) => u.reason).join(',') || '-';
      fs.writeFileSync(file, out.bytes);
      const un = new Set(out.unwritten.map((u) => u.cid));
      const act = (cid) => {
        if (un.has(cid)) return 'keep';
        const v = decisions[cid]?.v;
        if (mode === 'draft') return v === 'a' ? 'keep' : v === 'r' ? 'mine' : 'theirs';
        return v === 'a' ? 'keep' : v === 'r' ? 'revert' : pending === 'a' ? 'revert' : 'keep';
      };
      const views = mode === 'draft' ? [['accept', 'accept'], ['reject', 'reject']] : [['final', 'accept']];
      for (const [v, pm] of views) {
        const want = viewText(res, bA, bB, act, v);
        const got = pandocText(file, pm);
        if (want !== got) {
          let i = 0; while (i < want.length && want[i] === got[i]) i++;
          throw new Error(`${v} 视图不一致 @${i}: 预期「${want.slice(Math.max(0, i - 15), i + 25)}」 实际「${got.slice(Math.max(0, i - 15), i + 25)}」`);
        }
      }
      if (VALIDATE) {
        try { execFileSync('python3', [VALIDATE, file, '--original', path.join(FIX, `${name}-B.docx`)], { stdio: 'pipe' }); row.xsd = 'ok'; }
        catch (e) { row.xsd = 'FAIL'; throw new Error('XSD: ' + (e.stdout?.toString() || '') + (e.stderr?.toString() || '')); }
      }
      row.ok = true;
    } catch (e) {
      fail++; row.ok = false; row.err = String(e.message || e).slice(0, 600);
    }
    report.push(row);
    console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${name.padEnd(8)} ${label.padEnd(13)} ${String(row.ms ?? '').padStart(5)}ms 没写进:${row.unwritten ?? ''} ${row.xsd ? 'xsd:' + row.xsd : ''} ${row.err ? '\n     ' + row.err : ''}`);
  }
}
if (process.env.SOFFICE) {
  const pdfDir = path.join(OUT, 'pdf'); fs.mkdirSync(pdfDir, { recursive: true });
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.docx')).map((f) => path.join(OUT, f));
  try { execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', pdfDir, ...files], { stdio: 'pipe', timeout: 600000 }); } catch (e) { console.log('soffice error', e.message); fail++; }
  const made = fs.readdirSync(pdfDir).filter((f) => f.endsWith('.pdf')).length;
  console.log(`LibreOffice 打开并转换：${made} / ${files.length}`);
  if (made !== files.length) fail++;
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(`\n${n - fail} / ${n} 通过`);
process.exit(fail ? 1 : 0);
