// 审阅稿写回 · 本机自检（1.8）。在你自己的电脑上、用你自己的真实合同跑，文件不离开这台电脑。
// - 只读取你指定的文件夹；每个子文件夹放一组：两份 .docx（修改时间早的当“原始文档”，晚的当“修改后文档”）。
// - 每组按 6 种决定组合各生成一次审阅稿 / 定稿，写在系统临时目录，检查完立刻删除，不在你的文件夹里留拷贝。
// - 检查：写入器自检；重新打开后按“接受全部”和“拒绝全部”分别读出正文，必须和比较结果推出的预期一致；每个部件都是合法 XML。
// - 报告里没有文件名、路径和正文，只有“第 N 组”、差异处数、没写进的原因分类、用时。
// 运行方式见同目录的 自检审阅稿.command（macOS）/ 自检审阅稿.cmd（Windows）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { parseDocx } from '../../renderer/src/lib/docx';
import { compareBlocks } from '../../renderer/src/lib/model';
import { diffDocsSec } from '../../renderer/src/lib/engine';
import { buildPlan } from '../../renderer/src/lib/draft/plan';
import { writeReview, W } from '../../renderer/src/lib/draft/ooxml';

{
  const El = Object.getPrototypeOf(new DOMParser().parseFromString('<a><b/></a>', 'application/xml').documentElement);
  const nextEl = (n: any) => { while (n && n.nodeType !== 1) n = n.nextSibling; return n || null; };
  Object.defineProperty(El, 'firstElementChild', { get() { return nextEl(this.firstChild); } });
  Object.defineProperty(El, 'nextElementSibling', { get() { return nextEl(this.nextSibling); } });
  (globalThis as any).DOMParser = DOMParser;
}
const io = { parse: (s: string) => new DOMParser().parseFromString(s, 'application/xml') as unknown as Document, serialize: (d: Document) => new XMLSerializer().serializeToString(d as any) };
const OPTS = { ignoreCase: false, ignoreWhitespace: true, precision: 'word' as const, formatting: true, detectMoves: true, normPunct: false, mergeParas: true };

const REASON: Record<string, string> = { section: '页眉页脚脚注', mismatch: '文件对不上', field: '域', textbox: '文本框', image: '图片', cell: '表格单元格对不上', place: '位置放不下', range: '位置对不上' };
const stamp = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
const root = process.argv[2];
if (!root || !fs.existsSync(root)) { console.log('用法：把每组两份 .docx 放进同一个子文件夹，然后把总文件夹拖到这个窗口里。'); process.exit(2); }

const load = async (p: string) => {
  const data = new Uint8Array(fs.readFileSync(p));
  const st = fs.statSync(p);
  return parseDocx({ path: p, name: 'doc.docx', ext: 'docx', size: data.length, mtime: st.mtimeMs, birthtime: st.birthtimeMs, data });
};
const bytesModel = (data: Uint8Array) => parseDocx({ path: 'x', name: 'x.docx', ext: 'docx', size: data.length, mtime: 0, birthtime: 0, data });

/** 把审阅稿变成“拒绝全部修订”后的样子（去掉插入、恢复删除），再交给同一个解析器读 */
async function rejectAll(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const d = io.parse(await zip.file('word/document.xml')!.async('string'));
  const all = (local: string) => Array.from(d.getElementsByTagNameNS(W, local));
  for (const e of all('ins')) e.parentNode?.removeChild(e);
  for (const e of all('del')) { if (!e.firstChild) { e.parentNode?.removeChild(e); continue; } const p = e.parentNode!; while (e.firstChild) p.insertBefore(e.firstChild, e); p.removeChild(e); }
  for (const t of all('delText')) { const n = d.createElementNS(W, 'w:t'); n.appendChild(d.createTextNode(t.textContent || '')); t.parentNode!.replaceChild(n, t); }
  // 删除了的表格行（trPr 里的 ins 已去掉）不用管；插入的行整行去掉
  zip.file('word/document.xml', io.serialize(d));
  return zip.generateAsync({ type: 'uint8array' });
}
const bodyText = (m: any) => m.blocks.map((b: any) => (b.kind === 'tr' ? (b.cells || []).map((c: any) => c.map((r: any) => r.t).join('')).join('') : b.runs.map((r: any) => r.t).join(''))).join('').replace(/\[图片\]/g, '').replace(/\s+/g, '');

function expectView(res: any, act: (cid: number) => string, view: 'accept' | 'reject' | 'final') {
  const keepB = (cid: number) => { const a = act(cid); if (view === 'final') return a !== 'revert'; if (view === 'accept') return a !== 'mine'; return a === 'keep' || a === 'mine'; };
  const keepA = (cid: number) => { const a = act(cid); if (view === 'final') return a === 'revert'; if (view === 'accept') return a === 'mine'; return a === 'theirs'; };
  let s = '';
  for (const r of res.rows) {
    if ((r.sec || 'body') !== 'body') continue;
    for (const m of r.merged) {
      if (m.op === 0 || (m.wsOnly && m.b)) { if (m.b && !m.b.psep) s += m.b.t; continue; }
      if (m.wsOnly) continue;
      if (m.op === 1 && m.b) { if (m.cid === undefined || keepB(m.cid)) s += m.b.t; }
      else if (m.op === -1 && m.a) { if (m.cid !== undefined && keepA(m.cid)) s += m.a.t; }
    }
  }
  return s.replace(/\[图片\]/g, '').replace(/\s+/g, '');
}
async function xmlOk(bytes: Uint8Array): Promise<boolean> {
  const zip = await JSZip.loadAsync(bytes);
  for (const f of Object.values(zip.files)) {
    if (f.dir || !/\.(xml|rels)$/i.test(f.name)) continue;
    let bad = false;
    const p = new DOMParser({ errorHandler: { error: () => { bad = true; }, fatalError: () => { bad = true; } } } as any);
    p.parseFromString(await f.async('string'), 'application/xml');
    if (bad) return false;
  }
  return true;
}

const SCEN: [string, (cids: number[]) => Record<number, any>, 'draft' | 'final', ('a' | 'b')?][] = [
  ['全部未决定', () => ({}), 'draft'],
  ['全部接受', (c) => Object.fromEntries(c.map((x) => [x, { v: 'a', by: '自检', at: Date.now() }])), 'draft'],
  ['全部拒绝', (c) => Object.fromEntries(c.map((x) => [x, { v: 'r', by: '自检', at: Date.now() }])), 'draft'],
  ['混合 + 批注', (c) => Object.fromEntries(c.map((x, i) => [x, { v: ['a', 'r', 'h', undefined][i % 4], note: i % 3 ? undefined : '自检备注', by: '自检', at: Date.now() }])), 'draft'],
  ['定稿 · 待议按对方', (c) => Object.fromEntries(c.map((x, i) => [x, { v: ['a', 'r', 'h', undefined][i % 4], by: '自检', at: Date.now() }])), 'final', 'b'],
  ['定稿 · 待议按原文', (c) => Object.fromEntries(c.map((x, i) => [x, { v: ['a', 'r', 'h', undefined][i % 4], by: '自检', at: Date.now() }])), 'final', 'a'],
];

(async () => {
  const groups = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name)).sort();
  const lines: string[] = [];
  const log = (s: string) => { console.log(s); lines.push(s); };
  log(`DocDiff 审阅稿自检 · ${stamp()} · ${os.platform()} ${os.arch()} · ${os.cpus().length} 核`);
  log(`找到 ${groups.length} 组。只在本机运行，生成的文件写在临时目录、检查完即删除。\n`);
  let pass = 0, fail = 0, k = 0;
  const reasons: Record<string, number> = {};
  for (const g of groups) {
    k++;
    const files = fs.readdirSync(g).filter((f) => /\.docx$/i.test(f) && !f.startsWith('~$')).map((f) => path.join(g, f));
    if (files.length !== 2) { log(`第 ${k} 组：跳过（需要正好两份 .docx，现在有 ${files.length} 份）`); continue; }
    files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-selfcheck-'));
    try {
      const A = await load(files[0]), B = await load(files[1]);
      const bA = compareBlocks(A), bB = compareBlocks(B);
      const res = diffDocsSec(bA, bB, OPTS);
      const plan = buildPlan(res, bA, bB);
      const cids = [...new Set(plan.ops.map((o) => o.cid))];
      const problems: string[] = [];
      const ms: number[] = [];
      let un = 0;
      for (const [label, mk, mode, pending] of SCEN) {
        const decisions = mk(cids);
        const t0 = Date.now();
        let out;
        try {
          out = await writeReview({ base: B.file.data, plan, decisions, mode, pending, reviewer: '自检', reviewerInitials: '检', theirs: '对方', theirsDate: Date.now(), now: Date.now(), io });
        } catch (e: any) { problems.push(`${label}：写入器自检未通过（${String(e?.message || e).slice(0, 40)}）`); continue; }
        ms.push(Date.now() - t0);
        fs.writeFileSync(path.join(tmp, 'out.docx'), out.bytes); // 只为确认能落盘，随后删除
        un = Math.max(un, out.unwritten.length);
        for (const u of out.unwritten) reasons[u.reason] = (reasons[u.reason] || 0) + 1;
        const skip = new Set(out.unwritten.map((u) => u.cid));
        const act = (cid: number) => {
          if (skip.has(cid)) return 'keep';
          const v = decisions[cid]?.v;
          if (mode === 'draft') return v === 'a' ? 'keep' : v === 'r' ? 'mine' : 'theirs';
          return v === 'a' ? 'keep' : v === 'r' ? 'revert' : pending === 'a' ? 'revert' : 'keep';
        };
        if (!(await xmlOk(out.bytes))) problems.push(`${label}：有部件不是合法 XML`);
        const acc = bodyText(await bytesModel(out.bytes));
        if (acc !== expectView(res, act, mode === 'draft' ? 'accept' : 'final')) problems.push(`${label}：“接受全部”后的正文和预期不一致`);
        if (mode === 'draft') {
          const rej = bodyText(await bytesModel(await rejectAll(out.bytes)));
          if (rej !== expectView(res, act, 'reject')) problems.push(`${label}：“拒绝全部”后的正文和预期不一致`);
        }
      }
      ms.sort((a, b) => a - b);
      const head = `第 ${k} 组：${res.changes.length} 处差异，${un ? `${un} 处没写进` : '全部写进'}，写入用时中位 ${ms[ms.length >> 1] ?? '-'} ms`;
      if (problems.length) { fail++; log(`✗ ${head}\n    ` + problems.join('\n    ')); }
      else { pass++; log(`✓ ${head}`); }
    } catch (e: any) {
      fail++; log(`✗ 第 ${k} 组：读取或比较失败（${String(e?.message || e).slice(0, 60)}）`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  log(`\n通过 ${pass} 组，未通过 ${fail} 组。`);
  if (Object.keys(reasons).length) log('没写进的原因（累计）：' + Object.entries(reasons).map(([r, n]) => `${REASON[r] || r} ${n}`).join('，'));
  const rep = path.join(root, `审阅稿自检报告-${stamp()}.txt`);
  fs.writeFileSync(rep, lines.join('\n') + '\n');
  console.log(`\n报告已保存：${rep}\n（报告里没有文件名和正文，可以直接发给开发者。）`);
  process.exit(fail ? 1 : 0);
})();
