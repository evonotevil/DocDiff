// 审阅稿端到端（1.8 M1）：真实启动应用，在修订审阅里逐条决定，检查审阅稿的写入、状态片、Word 占用、被改过、生成定稿，
// 并记录每个决定从按键到“已保存”的耗时和期间主线程的长任务。只用合成夹具，日志里文件称 Document A / Document B。
// 用法：APP=<应用目录> xvfb-run -a node scripts/e2e-review-draft.cjs <case，默认 basic> [决定数，默认 12] [输出.json]
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const CASE = process.argv[2] || 'basic';
const N = +(process.argv[3] || 12);
const OUT = process.argv[4];
const FIX = path.join(__dirname, '../work/review-fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-draft-'));
const A = path.join(dir, `${CASE}-A.docx`), B = path.join(dir, `${CASE}-B.docx`);
fs.copyFileSync(path.join(FIX, `${CASE}-A.docx`), A); fs.copyFileSync(path.join(FIX, `${CASE}-B.docx`), B);
const result = { case: CASE, steps: [], checks: {} };
const ok = (k, v, info) => { result.checks[k] = { ok: !!v, ...(info || {}) }; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info) : ''}`); };
const drafts = () => fs.readdirSync(dir).filter((f) => f.endsWith('.docx') && f !== path.basename(A) && f !== path.basename(B) && !f.startsWith('~$'));

(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-')) } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; shell.openPath = async () => ''; });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForFunction(() => !!document.querySelector('.tb-pos') || !!document.querySelector('.tb-prog'), null, { timeout: 120000 });
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click());
  await win.waitForTimeout(800);
  // 第一次进修订审阅会问署名：点“好的”
  await win.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的|OK/.test(b.textContent))?.click());
  await win.evaluate(() => {
    window.__long = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: false }); } catch {}
  });
  const chip = () => win.evaluate(() => document.querySelector('.draft-chip')?.getAttribute('aria-label') || '');
  const total = await win.evaluate(() => { const m = /\/\s*(\d+)/.exec(document.querySelector('.tb-pos')?.textContent || ''); return m ? +m[1] : 0; });
  const keys = ['a', 'r', 'h'];
  for (let i = 0; i < Math.min(N, total); i++) {
    const before = drafts().map((f) => fs.statSync(path.join(dir, f)).mtimeMs).join();
    const t0 = Date.now();
    const tPerf = await win.evaluate(() => performance.now());
    await win.keyboard.press(keys[i % 3]);
    let saved = false;
    if (process.env.NODRAFT) { await win.waitForTimeout(600); saved = true; }
    else for (let k = 0; k < 200; k++) {
      await win.waitForTimeout(25);
      const c = await chip();
      const now = drafts().map((f) => fs.statSync(path.join(dir, f)).mtimeMs).join();
      if (/已保存|没写进/.test(c) && now !== before) { saved = true; break; }
    }
    const ms = Date.now() - t0;
    const writeMs = +(await win.evaluate(() => document.querySelector('.draft-chip')?.dataset.ms || 0));
    const parts = await win.evaluate(() => document.querySelector('.draft-chip')?.dataset.parts || '');
    const long = await win.evaluate((t) => window.__long.filter((x) => x[0] >= t), tPerf);
    result.steps.push({ i, key: keys[i % 3], ms, writeMs, parts, saved, maxLong: long.reduce((m, x) => Math.max(m, x[1]), 0) });
  }
  const stepMs = result.steps.map((s) => s.ms).sort((a, b) => a - b);
  if (process.env.NODRAFT) { const w = Math.max(...result.steps.map((s) => s.maxLong)); console.log('baseline long tasks per decision', JSON.stringify(result.steps.map((s) => s.maxLong)), 'worst', w); await app.close(); if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 1)); return; }
  ok('every decision saved', result.steps.every((s) => s.saved), { n: result.steps.length });
  const w = result.steps.map((s) => s.writeMs).filter(Boolean).sort((a, b) => a - b);
  ok('decision → saved (incl. 250ms debounce)', true, { median: stepMs[stepMs.length >> 1], max: stepMs[stepMs.length - 1] });
  ok('write time (worker + disk) median < 300ms', (w[w.length >> 1] || 0) < 300, { median: w[w.length >> 1], max: w[w.length - 1] });
  // 第一个决定时的那次长任务 1.7.5 就有（首次切换审阅状态），不算在审阅稿头上；单独记下来和基线对比
  ok('no main-thread task > 50ms during saves (after the first 3 decisions; 1.7.5 also has these)', result.steps.slice(3).every((s) => s.maxLong <= 50), { first3: result.steps.slice(0, 3).map((s) => s.maxLong), worstAfter: Math.max(0, ...result.steps.slice(3).map((s) => s.maxLong)) });
  const files = drafts();
  ok('one draft next to Document B', files.length === 1, { files: files.length });
  const draft = path.join(dir, files[0] || 'x');
  if (process.env.DOCX_VALIDATE && files[0]) {
    try { execFileSync('python3', [process.env.DOCX_VALIDATE, draft, '--original', B], { stdio: 'pipe' }); ok('draft passes OOXML validation', true); }
    catch (e) { ok('draft passes OOXML validation', false, { out: (e.stdout || '').toString().slice(0, 300) }); }
  }
  ok('Document B untouched', fs.readFileSync(B).equals(fs.readFileSync(path.join(FIX, `${CASE}-B.docx`))));

  // Word 占用：放一个 ~$ 文件，再做一个决定
  const lock = path.join(dir, '~$' + path.basename(draft).slice(2));
  fs.writeFileSync(lock, 'x');
  const mt0 = fs.statSync(draft).mtimeMs;
  await win.keyboard.press('u'); // 撤销上一个决定也会触发写入
  await win.waitForTimeout(1200);
  ok('Word lock → paused', /Word/.test(await chip()) && fs.statSync(draft).mtimeMs === mt0, { chip: await chip() });
  fs.unlinkSync(lock);
  let resumed = false;
  for (let k = 0; k < 40 && !resumed; k++) { await win.waitForTimeout(250); resumed = /已保存/.test(await chip()) && fs.statSync(draft).mtimeMs !== mt0; }
  ok('lock released → written', resumed);

  // 被改过：外部改写审阅稿，再做一个决定
  const fake = Buffer.concat([fs.readFileSync(draft), Buffer.from([0])]);
  fs.writeFileSync(draft, fake);
  await win.evaluate(() => window.dispatchEvent(new Event('focus')));
  await win.keyboard.press('a');
  await win.waitForTimeout(1500);
  ok('edited elsewhere → paused, not overwritten', /被改过/.test(await chip()) && fs.readFileSync(draft).equals(fake), { chip: await chip() });
  // 另存为新审阅稿
  await win.evaluate(() => document.querySelector('.draft-chip').click());
  await win.waitForTimeout(300);
  await win.evaluate(() => [...document.querySelectorAll('.draft-pop .btn')].find((b) => /另存为新审阅稿/.test(b.textContent))?.click());
  await win.waitForTimeout(2000);
  ok('save as new draft', drafts().length === 2 && /已保存|没写进/.test(await chip()), { files: drafts().length, chip: await chip() });

  // 生成定稿
  await win.evaluate(() => { if (!document.querySelector('.draft-pop')) document.querySelector('.draft-chip').click(); });
  await win.waitForTimeout(300);
  await win.evaluate(() => [...document.querySelectorAll('.draft-pop .btn')].find((b) => /生成定稿/.test(b.textContent))?.click());
  await win.waitForTimeout(400);
  const tf = Date.now();
  await win.evaluate(() => [...document.querySelectorAll('.final-dlg .acts .btn')].find((b) => /生成定稿/.test(b.textContent))?.click());
  let fin = null;
  for (let k = 0; k < 80 && !fin; k++) { await win.waitForTimeout(100); fin = drafts().find((f) => /定稿/.test(f)); }
  ok('final generated', !!fin, { ms: Date.now() - tf, dlg: fin ? undefined : await win.evaluate(() => document.querySelector('.final-dlg')?.innerText?.slice(0, 300) || document.querySelector('.draft-pop')?.innerText?.slice(0, 200) || 'no dialog') });
  if (fin && process.env.DOCX_VALIDATE) {
    try { execFileSync('python3', [process.env.DOCX_VALIDATE, path.join(dir, fin), '--original', B], { stdio: 'pipe' }); ok('final passes OOXML validation', true); }
    catch (e) { ok('final passes OOXML validation', false, { out: (e.stdout || '').toString().slice(0, 300) }); }
  }
  ok('no renderer errors', errs.length === 0, errs.length ? { errs: errs.slice(0, 3) } : undefined);
  await app.close();
  result.failed = Object.values(result.checks).filter((c) => !c.ok).length;
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  process.exit(result.failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
