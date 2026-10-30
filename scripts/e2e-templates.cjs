// 模板端到端（1.8 M2）：新建模板、上传新版本、只放对方文件时首页认出模板、用模板比较时自动选版本、改名、删除与撤销、重启后还在。
// 只用合成夹具（make-review-fixtures.py 的 tpl-*）。用法：APP=<应用目录> xvfb-run -a node scripts/e2e-templates.cjs [输出.json]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const FIX = path.join(__dirname, '../work/review-fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-tpl-'));
for (const n of ['v1', 'v2', 'vendor']) { const d = path.join(dir, `tpl-${n}.docx`); fs.copyFileSync(path.join(FIX, `tpl-${n}.docx`), d); const st = fs.statSync(path.join(FIX, `tpl-${n}.docx`)); fs.utimesSync(d, st.atime, st.mtime); }
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
const checks = {};
const ok = (k, v, info) => { checks[k] = { ok: !!v, ...(info || {}) }; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info) : ''}`); };

async function launch() {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1280, height: 860 });
  await win.waitForSelector('.lib-card, .home-intro', { timeout: 60000 }); // beta.7：第一次用时只有一行说明 + 新建模板
  const pickNext = (p) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, p);
  return { app, win, errs, pickNext };
}
const text = (win, sel) => win.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
const clickText = (win, sel, re) => win.evaluate(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); b?.click(); return !!b; }, [sel, re]);

(async () => {
  let { app, win, errs, pickNext } = await launch();
  // 1. 新建模板（2026-03 版）
  await pickNext(path.join(dir, 'tpl-v1.docx'));
  await clickText(win, '.lib-card .btn, .home-intro .btn', '新建模板');
  await win.waitForSelector('.lib-card[aria-label="模板"] .lib-row', { timeout: 15000 });
  ok('template created', /tpl-v1/.test(await text(win, '.lib-card[aria-label="模板"] .lib-row')), { row: await text(win, '.lib-card[aria-label="模板"] .lib-row') });
  // 2. 上传新版本（2026-09 版）
  await pickNext(path.join(dir, 'tpl-v2.docx'));
  await win.evaluate(() => document.querySelector('.lib-card[aria-label="模板"] .lib-row .btn.icon').click());
  await win.waitForTimeout(300);
  await clickText(win, '.pop .menu-item', '上传新版本');
  await win.waitForFunction(() => /2 个版本/.test(document.querySelector('.lib-card[aria-label="模板"] .lib-row')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
  ok('second version added', /2 个版本/.test(await text(win, '.lib-card[aria-label="模板"] .lib-row')), { row: await text(win, '.lib-card[aria-label="模板"] .lib-row') });
  // 3. 只放对方文件：首页认出模板
  await pickNext(path.join(dir, 'tpl-vendor.docx'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'open-right'));
  await win.waitForSelector('.lib-match', { timeout: 15000 }).catch(() => {});
  const m = await text(win, '.lib-match');
  ok('home recognises template and version', /tpl-v1/.test(m) && /2026-03/.test(m), { notice: m.replace(/\s+/g, ' ').slice(0, 120) });
  // 4. 用模板比较：自动选 2026-03
  const t0 = Date.now();
  await clickText(win, '.lib-match .btn', '用模板比较');
  await win.waitForSelector('.tpl-dlg', { timeout: 5000 });
  const dlg = await text(win, '.tpl-dlg');
  ok('dialog auto-picks the version the other side used', /自动选了 2026-03/.test(dlg), { ms: Date.now() - t0, dlg: dlg.replace(/\s+/g, ' ').slice(0, 160) });
  await clickText(win, '.tpl-dlg .acts .btn', '开始比较');
  await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
  const n = await win.evaluate(() => document.querySelector('.tb-pos')?.textContent || '');
  ok('compares template v1 with the vendor file', /共\s*\d+\s*处|\d+\s*\/\s*\d+/.test(n), { pos: n });
  await win.waitForSelector('.ver-chip', { timeout: 10000 }).catch(() => {});
  ok('template compare becomes a negotiation (V1 = template, V2 = theirs)', /V1\s*→\s*V2/.test(await text(win, '.ver-chip')), { chip: await text(win, '.ver-chip') });
  // 5. 回首页：改名、删除、撤销
  await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click());
  await win.waitForSelector('.lib-card[aria-label="模板"] .lib-row', { timeout: 15000 });
  await win.evaluate(() => document.querySelector('.lib-card[aria-label="模板"] .lib-row .btn.icon').click());
  await win.waitForTimeout(200);
  await clickText(win, '.pop .menu-item', '重命名');
  await win.waitForSelector('.lib-edit');
  await win.fill('.lib-edit', '云服务采购合同（标准版）');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(300);
  ok('rename', /云服务采购合同（标准版）/.test(await text(win, '.lib-card[aria-label="模板"] .lib-row')));
  await win.evaluate(() => document.querySelector('.lib-card[aria-label="模板"] .lib-row .btn.icon').click());
  await win.waitForTimeout(200);
  await clickText(win, '.pop .menu-item', '删除模板');
  await win.waitForTimeout(300);
  ok('delete hides it', !(await win.evaluate(() => !!document.querySelector('.lib-card[aria-label="模板"] .lib-row'))));
  await clickText(win, '.toast .toast-btn', '撤销');
  await win.waitForTimeout(300);
  ok('undo restores it', /云服务采购合同/.test(await text(win, '.lib-card[aria-label="模板"] .lib-row')));
  ok('no renderer errors', errs.length === 0, errs.length ? { errs: errs.slice(0, 3) } : undefined);
  await app.close();
  // 6. 重启后还在；原文件删掉后仍能用（存的是拷贝）
  fs.unlinkSync(path.join(dir, 'tpl-v1.docx'));
  ({ app, win, errs, pickNext } = await launch());
  ok('persists across restart', /云服务采购合同/.test(await text(win, '.lib-card[aria-label="模板"] .lib-row')) && /2 个版本/.test(await text(win, '.lib-card[aria-label="模板"] .lib-row')));
  await pickNext(path.join(dir, 'tpl-vendor.docx'));
  await win.evaluate(() => document.querySelector('.lib-card[aria-label="模板"] .lib-row').click());
  await win.waitForSelector('.tpl-dlg');
  await clickText(win, '.tpl-dlg .pair-row.pick', '选择');
  await win.waitForFunction(() => /自动选了/.test(document.querySelector('.tpl-dlg')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
  await clickText(win, '.tpl-dlg .acts .btn', '开始比较');
  const okCmp = await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 }).then(() => true).catch(() => false);
  ok('works after the original template file is deleted (library copy)', okCmp);
  ok('no renderer errors after restart', errs.length === 0, errs.length ? { errs: errs.slice(0, 3) } : undefined);
  await app.close();
  const failed = Object.values(checks).filter((c) => !c.ok).length;
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(checks, null, 1));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
