// 往来稿里反复切换版本（约 100 页）：内存会不会一直涨。xvfb-run -a node scripts/soak-thread-switch.cjs [次数]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..'); const N = +(process.argv[2] || 12);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-soak-'));
const F = (n, src) => { const p = path.join(dir, `大合同-${n}.docx`); fs.copyFileSync(path.join(R, 'work/review-fixtures', src), p); return p; };
const v1 = F('V1', 'large-A.docx'), v2 = F('V2', 'large-B.docx'), v3 = F('V3', 'large-A2.docx');
(async () => {
  const app = await _electron.launch({ executablePath: path.join(R, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--lang=zh-CN', '--js-flags=--expose-gc', R, v1, v2], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dd-c-')) } });
  const w = await app.firstWindow(); await w.setViewportSize({ width: 1440, height: 900 });
  const pick = (p) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, p);
  await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 120000 });
  await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await w.waitForTimeout(500);
  await w.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click());
  await w.evaluate(() => document.querySelector('.insp .sh .ibtn, .sh .ibtn.act')?.click()); await w.waitForTimeout(200);
  await w.evaluate(() => [...document.querySelectorAll('.pop .menu-item')].find((b) => /存为往来稿/.test(b.textContent))?.click());
  await w.waitForSelector('.ver-chip', { timeout: 20000 });
  await w.evaluate(() => document.querySelector('.ver-chip').click()); await w.waitForTimeout(200);
  await w.evaluate(() => [...document.querySelectorAll('.ver-pop .btn')].find((b) => /加入新版本/.test(b.textContent))?.click());
  await w.waitForSelector('.add-ver'); await pick(v3); await w.evaluate(() => document.querySelector('.add-ver .dlg-drop').click()); await w.waitForTimeout(600);
  await w.evaluate(() => [...document.querySelectorAll('.add-ver .acts .btn')].find((b) => /加入并比较/.test(b.textContent))?.click());
  await w.waitForFunction(() => /V2\s*→\s*V3/.test(document.querySelector('.ver-chip')?.innerText || ''), null, { timeout: 120000 });
  console.error('STEP added V3');
  const mem = async () => { await w.evaluate(() => { window.gc && window.gc(); }); await w.waitForTimeout(500); const h = await w.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576)); const m = await app.evaluate(async ({ webContents, app }) => { const wc = webContents.getAllWebContents()[0]; const i = wc.getOSProcessId(); const p = app.getAppMetrics().find((x) => x.pid === i); return Math.round((p?.memory?.workingSetSize || 0) / 1024); }); return { heap: h, rss: m }; };
  const out = [await mem()];
  const times = [];
  for (let i = 0; i < N; i++) {
    const target = i % 2 === 0 ? 1 : 2; // 点 V2（V1→V2）或 V3（V2→V3）
    const t0 = Date.now();
    await w.evaluate(() => document.querySelector('.ver-chip').click()); await w.waitForTimeout(150);
    await w.evaluate((k) => document.querySelectorAll('.ver-list .ver-row')[k].click(), target);
    const want = target === 1 ? 'V1\\s*→\\s*V2' : 'V2\\s*→\\s*V3';
    await w.waitForFunction((re) => new RegExp(re).test(document.querySelector('.ver-chip')?.innerText || '') && !!document.querySelector('.tb-prog'), want, { timeout: 120000 });
    times.push(Date.now() - t0); console.error('switch', i, times[i]);
    if (i % 4 === 3) out.push(await mem());
  }
  console.log(JSON.stringify({ switchMs: times, mem: out }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
