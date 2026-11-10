// 1.9.4 PDF 段落重建验收（只用合成夹具，文件名一律 Document A / B）：
//   1) 报告的两组夹具（work/pdf-align 短段落、work/pdf-align-long 长段落）：唯一的文字修改“三十日 → 十五日”在第 6 条，
//      行距类变体没有新增 / 删除；字号变化只多出“格式”，文字类差异只有那一处修改。
//   2) work/pdf-para（scripts/make-pdf-para-194.py）：文字相同只改行距 / 栏宽不报文字差异；混合行距、双栏、表格、页眉页脚、
//      跨页续段、Word → PDF：逐段核对两侧重建出的段落（阅读顺序、段落边界）。
// 用法：python3 scripts/make-pdf-align.py && LONG=1 python3 scripts/make-pdf-align.py work/pdf-align-long && python3 scripts/make-pdf-para-194.py
//       xvfb-run -a node scripts/e2e-pdf-para-194.cjs [结果.json]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const W = path.join(__dirname, '../work');
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info).slice(0, 400) : ''}`); };
const norm = (s) => s.replace(/[\s\t]+/g, '');

async function compare(fa, fb) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-para-'));
  const A = path.join(dir, 'Document A.pdf'), B = path.join(dir, 'Document B.pdf');
  fs.copyFileSync(fa, A); fs.copyFileSync(fb, B);
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', ...(process.env.PACKAGED ? [] : [APP]), A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-')) } });
  const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForFunction(() => !!document.querySelector('.tb-pos') || !!document.querySelector('.rich .cell'), null, { timeout: 120000 }).catch(() => {});
  await win.waitForTimeout(900);
  const r = await win.evaluate(() => {
    const kinds = {};
    const rows = [...document.querySelectorAll('.dlist .drow')];
    for (const d of rows) { const k = [...d.classList].find((c) => c.startsWith('k-')) || 'k-?'; kinds[k] = (kinds[k] || 0) + 1; }
    const mods = rows.filter((d) => d.classList.contains('k-mod')).map((d) => {
      // 这一行所在的分组标题（条款）
      let g = d.previousElementSibling; while (g && !g.classList.contains('grp')) g = g.previousElementSibling;
      if (!g) { let p = d.parentElement; while (p && !g) { let s = p.previousElementSibling; while (s && !s.classList.contains('grp')) s = s.previousElementSibling; g = s; p = p.parentElement; } }
      return { text: d.innerText.replace(/\s+/g, ''), clause: g ? g.innerText.trim() : '' };
    });
    const blocks = (side) => [...document.querySelectorAll(`.rich .cell[data-side="${side}"]:not(.ph) .blk`)].map((b) => b.innerText);
    return { kinds, mods, a: blocks('a'), b: blocks('b'), total: rows.length };
  });
  await app.close();
  return r;
}
const textKinds = (k) => (k['k-del'] || 0) + (k['k-ins'] || 0) + (k['k-mod'] || 0) + (k['k-move'] || 0);
const isEdit = (m) => /三十/.test(m.text) && /十五/.test(m.text);

(async () => {
  const out = [];
  // ---- 1) 报告的两组夹具 ----
  const sets = [['pdf-align', ['same', 'size12', 'lead15', 'lead2', 'narrow', 'indent', 'pagebreak', 'spacing0']], ['pdf-align-long', ['lead14', 'lead15', 'spacing0lead15', 'lead15narrow', 'size12lead15', 'spacing0']]];
  if (!process.env.ONLY || process.env.ONLY === 'report') for (const [dir, vars] of sets) {
    for (const v of vars) {
      const r = await compare(path.join(W, dir, 'base.pdf'), path.join(W, dir, v + '.pdf'));
      const k = r.kinds;
      out.push({ set: dir, v, kinds: k, mods: r.mods, blocks: [r.a.length, r.b.length] });
      const edit = r.mods.filter(isEdit);
      ok(`${dir}/${v}: “三十日 → 十五日”是一处修改，在第 6 条`, edit.length === 1 && /第6条/.test(edit[0].clause + edit[0].text), { mods: r.mods });
      ok(`${dir}/${v}: 没有由行距引起的新增 / 删除`, !(k['k-del'] || k['k-ins']), k);
      ok(`${dir}/${v}: 文字类差异只有那一处修改（其余只能是格式）`, textKinds(k) === 1, k);
      if (/size12/.test(v)) ok(`${dir}/${v}: 字号变化只记为格式`, (k['k-fmt'] || 0) > 0 && textKinds(k) === 1, k);
    }
  }
  // ---- 2) 新夹具：逐段核对 ----
  if (!process.env.ONLY || process.env.ONLY === 'para') {
    const P = path.join(W, 'pdf-para');
    const ex = JSON.parse(fs.readFileSync(path.join(P, 'expected.json'), 'utf8'));
    const hf = (s) => /^示例公司|^第\s*\d+\s*页$/.test(s.trim());
    for (const [g, a, b, nText] of ex.pairs) {
      if (!fs.existsSync(path.join(P, b + '.pdf'))) { ok(`${g}: ${b}.pdf 存在`, false); continue; }
      const r = await compare(path.join(P, a + '.pdf'), path.join(P, b + '.pdf'));
      out.push({ group: g, a, b, kinds: r.kinds, blocks: [r.a.length, r.b.length] });
      ok(`${g} ${a} → ${b}: 文字差异 ${nText} 处`, textKinds(r.kinds) === nText, { kinds: r.kinds, mods: r.mods });
      if (nText === 1) ok(`${g} ${a} → ${b}: 那一处是“三十日 → 十五日”`, r.mods.filter(isEdit).length === 1, r.mods);
      for (const [side, name] of [['a', a], ['b', b]]) {
        const want = (ex.paras[g][name] || []).map(norm);
        const got = r[side].filter((s) => !hf(s)).map(norm).filter(Boolean);
        const same = want.length === got.length && want.every((w, i) => w === got[i]);
        let firstDiff = -1; for (let i = 0; i < Math.max(want.length, got.length); i++) if (want[i] !== got[i]) { firstDiff = i; break; }
        ok(`${g} ${name}: 段落边界和阅读顺序（${want.length} 段）`, same, same ? null : { got: got.length, want: want.length, at: firstDiff, gotText: (got[firstDiff] || '').slice(0, 40), wantText: (want[firstDiff] || '').slice(0, 40) });
      }
    }
  }
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  console.log(fail ? `\n${fail} 项不通过` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
