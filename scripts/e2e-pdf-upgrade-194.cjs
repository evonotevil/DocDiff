// 1.9.4 升级测试：用 1.9.3 在同一批 PDF 对上做好并保存审阅决定，再用 1.9.4 打开。
//   - 能可靠认回的决定保留（条款、文字、结论都和 1.9.3 时一样）；
//   - 认不回的在画布顶部明确提示数量（Figma G7），不能挂到别的条款上；
//   - 再打开一次不再提示，结果不变（没认回的旧决定不会之后又被认到别处）。
// 只用合成夹具（文件名 Document A / B）。
// 用法：OLD=<1.9.3 源码目录（已 vite build）> xvfb-run -a node scripts/e2e-pdf-upgrade-194.cjs [结果.json]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const NEW = process.env.APP || path.join(__dirname, '..');
const OLD = process.env.OLD;
if (!OLD) { console.error('需要 OLD=<1.9.3 目录>'); process.exit(2); }
const W = path.join(__dirname, '../work');
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info).slice(0, 500) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(app, files, cfg) {
  const a = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', app, ...files], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await a.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForFunction(() => !!document.querySelector('.tb-pos') || !!document.querySelector('.dlist'), null, { timeout: 120000 }).catch(() => {});
  await sleep(800);
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await sleep(800);
  await win.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click()); await sleep(500);
  return { a, win };
}
// 每一行：所在条款、显示的文字、结论
const rows = (win) => win.evaluate(() => [...document.querySelectorAll('.dlist .drow')].map((d) => {
  let g = d.previousElementSibling; while (g && !g.classList.contains('grp')) g = g.previousElementSibling;
  if (!g) { let p = d.parentElement; while (p && !g) { let s = p.previousElementSibling; while (s && !s.classList.contains('grp')) s = s.previousElementSibling; g = s; p = p.parentElement; } }
  const v = [...d.classList].find((c) => /^v-[arh]$/.test(c));
  const kind = [...d.classList].find((c) => c.startsWith('k-'));
  return { clause: (g?.innerText || '').trim(), kind, text: d.innerText.replace(/^\s*[\d✓✕?·]+\s*/, '').replace(/⚠.*$/s, '').replace(/\s+/g, ''), v: v ? v.slice(2) : '' };
}));
const key = (r) => `${r.clause}|${r.kind}|${r.text}`;

(async () => {
  const out = [];
  const cases = [
    ['单倍行距（段落不变）', 'pdf-align/base.pdf', 'pdf-align/narrow.pdf', 'all'],
    ['长段落 1.5 倍行距', 'pdf-align-long/base.pdf', 'pdf-align-long/lead15.pdf', 'some'],
    ['同一改动出现在两条里（第 9 条在 1.9.3 被切碎）', 'pdf-para/dup-A.pdf', 'pdf-para/dup-B.pdf', 'some'],
    ['同页混合行距', 'pdf-para/mixed-A.pdf', 'pdf-para/mixed-B.pdf', 'some'],
  ];
  for (const [name, fa, fb, expect] of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-upg-'));
    const A = path.join(dir, 'Document A.pdf'), B = path.join(dir, 'Document B.pdf');
    fs.copyFileSync(path.join(W, fa), A); fs.copyFileSync(path.join(W, fb), B);
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
    // ---- 1.9.3：每一处都做决定（接受 / 拒绝 / 待议轮流） ----
    let { a, win } = await open(OLD, [A, B], cfg);
    const n = await win.evaluate(() => document.querySelectorAll('.dlist .drow').length);
    for (let i = 0; i < n; i++) {
      await win.evaluate((i) => document.querySelectorAll('.dlist .drow')[i]?.click(), i); await sleep(120);
      await win.keyboard.press(['a', 'r', 'h'][i % 3]); await sleep(260);
    }
    await sleep(1200);
    const old = (await rows(win)).filter((r) => r.v);
    await a.close();
    // ---- 1.9.4 第一次打开 ----
    ({ a, win } = await open(NEW, [A, B], cfg));
    await sleep(600);
    const nt = await win.evaluate(() => [...document.querySelectorAll('.nt.bar')].map((x) => ({ tone: [...x.classList].find((c) => ['warn', 'info'].includes(c)), text: x.innerText.replace(/\s+/g, ' ') })));
    const now = (await rows(win)).filter((r) => r.v);
    await a.close();
    // ---- 1.9.4 再打开一次 ----
    ({ a, win } = await open(NEW, [A, B], cfg));
    await sleep(600);
    const nt2 = await win.evaluate(() => document.querySelectorAll('.nt.bar').length);
    const again = (await rows(win)).filter((r) => r.v);
    await a.close();

    const oldMap = new Map(old.map((r) => [key(r), r.v]));
    const wrong = now.filter((r) => oldMap.get(key(r)) !== r.v);
    const lost = old.length - now.length;
    out.push({ name, old: old.length, kept: now.length, lost, notice: nt, wrong });
    ok(`${name}: 1.9.3 做了 ${old.length} 个决定`, old.length > 0);
    ok(`${name}: 带回的 ${now.length} 个决定，条款、文字、结论都和 1.9.3 一样（没有挂到别的条款）`, wrong.length === 0, wrong.slice(0, 3));
    const upg = nt.find((x) => /段落读法更新/.test(x.text));
    if (lost > 0) ok(`${name}: 对不上的 ${lost} 个明确提示（留意色，写明数量）`, !!upg && upg.tone === 'warn' && upg.text.includes(`${lost} 个决定对不上`), nt);
    else ok(`${name}: 全部带回，只给信息提示`, !!upg && upg.tone === 'info' && upg.text.includes('都已带回'), nt);
    if (expect === 'all') ok(`${name}: 段落没变，全部决定都带回`, lost === 0, { old: old.length, now: now.length });
    ok(`${name}: 再打开一次不再提示`, nt2 === 0, { nt2 });
    ok(`${name}: 再打开一次带回的决定不变（没认回的不会之后被认到别处）`, again.length === now.length && again.every((r) => oldMap.get(key(r)) === r.v), { again: again.length, now: now.length });
  }
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  console.log(fail ? `\n${fail} 项不通过` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
