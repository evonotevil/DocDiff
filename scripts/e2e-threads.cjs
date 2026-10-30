// 往来稿端到端（1.8 M3）：普通比较存为往来稿、按版本链加新版本、首页认出往来稿并加为新版本、
// “上轮”提示（对方又改回来）和一键沿用、批量沿用、条款历史、归档 / 删除 / 撤销、重启后还在。
// 只用合成夹具 neg-V1..V4。用法：APP=<应用目录> xvfb-run -a node scripts/e2e-threads.cjs [输出.json]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const FIX = path.join(__dirname, '../work/review-fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-th-'));
const F = (n) => path.join(dir, `采购合同-${n}.docx`);
for (const n of ['V1', 'V2', 'V3', 'V4']) fs.copyFileSync(path.join(FIX, `neg-${n}.docx`), F(n));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
const checks = {};
const ok = (k, v, info) => { checks[k] = { ok: !!v, ...(info || {}) }; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info) : ''}`); };

async function launch(args = []) {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, ...args], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1360, height: 860 });
  const pickNext = (p) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, p);
  return { app, win, errs, pickNext };
}
const text = (win, sel) => win.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
const clickText = (win, sel, re) => win.evaluate(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); b?.click(); return !!b; }, [sel, re]);
const waitPos = (win) => win.waitForFunction(() => !!document.querySelector('.tb-prog') || !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
const toReview = async (win) => { await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await win.waitForTimeout(500); await win.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click()); };
const decideOn = async (win, re, key) => { await win.evaluate((r) => [...document.querySelectorAll('.dlist .drow')].find((x) => new RegExp(r).test(x.textContent))?.click(), re); await win.waitForTimeout(200); await win.keyboard.press(key); await win.waitForTimeout(400); };

(async () => {
  // 1. 普通比较 V1 → V2，审阅，存为往来稿
  let { app, win, errs, pickNext } = await launch([F('V1'), F('V2')]);
  await waitPos(win); await toReview(win);
  await decideOn(win, '十五', 'r');   // 违约金 20% → 15%：拒绝
  await decideOn(win, '六十', 'a');   // 付款 30 → 60 日：接受
  await win.evaluate(() => document.querySelector('.insp .sh .ibtn, .sh .ibtn.act')?.click());
  await win.waitForTimeout(200);
  ok('“存为往来稿” offered for a normal compare', await clickText(win, '.pop .menu-item', '存为往来稿'));
  await win.waitForSelector('.ver-chip', { timeout: 10000 }).catch(() => {});
  ok('toolbar shows merged version chip', /V1\s*→\s*V2/.test(await text(win, '.ver-chip')), { chip: await text(win, '.ver-chip') });
  await win.waitForTimeout(900); // 等这一轮的结论摘要写进往来稿
  // 2. 版本链里加入 V3（我方：违约金改回 20%）
  await win.evaluate(() => document.querySelector('.ver-chip').click());
  await win.waitForTimeout(200);
  await clickText(win, '.ver-pop .btn', '加入新版本');
  await win.waitForSelector('.tpl-dlg');
  await pickNext(F('V3'));
  await win.evaluate(() => document.querySelector('.tpl-dlg .dlg-drop').click());
  await win.waitForTimeout(400);
  const dlg = await text(win, '.tpl-dlg');
  ok('add-version dialog defaults to “我方” after their version', /我方改的/.test(dlg));
  await clickText(win, '.tpl-dlg .acts .btn', '加入并比较');
  await win.waitForFunction(() => /V2\s*→\s*V3/.test(document.querySelector('.ver-chip')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
  ok('V3 added and compared with V2', /V2\s*→\s*V3/.test(await text(win, '.ver-chip')));
  // 3. 回首页，只放对方的 V4：认出往来稿，加为 V4
  await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click());
  await win.waitForSelector('.lib-row', { timeout: 15000 });
  ok('home lists the negotiation', /采购合同-V2/.test(await text(win, '.lib-card')), { card: (await text(win, '.lib-card')).replace(/\s+/g, ' ').slice(0, 100) });
  await pickNext(F('V4'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'open-right'));
  await win.waitForSelector('.lib-match', { timeout: 15000 }).catch(() => {});
  const m = await text(win, '.lib-match');
  ok('home recognises the negotiation and offers “加为 V4”', /往来稿/.test(m) && /加为 V4/.test(m), { notice: m.replace(/\s+/g, ' ').slice(0, 140) });
  const t0 = Date.now();
  await clickText(win, '.lib-match .btn', '加为');
  await win.waitForFunction(() => /V3\s*→\s*V4/.test(document.querySelector('.ver-chip')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
  ok('V4 added and compared with V3', /V3\s*→\s*V4/.test(await text(win, '.ver-chip')), { ms: Date.now() - t0 });
  // 4. “上轮”提示：违约金又改回 15%
  await win.waitForTimeout(500);
  await win.evaluate(() => [...document.querySelectorAll('.dlist .drow')].find((x) => /十五/.test(x.textContent))?.click());
  await win.waitForTimeout(300);
  const hint = await text(win, '.rb-hint');
  ok('hint: rejected last round, they changed it back', /拒绝过.*改回来/.test(hint), { hint });
  const hist = await text(win, '.clause-hist');
  ok('inspector shows clause history', /条款历史/.test(hist) && /V2/.test(hist) && /拒绝/.test(hist), { hist: hist.replace(/\s+/g, ' ') });
  await win.evaluate(() => document.querySelector('.ibtn.sm.act')?.click());
  await win.waitForTimeout(200);
  ok('batch reuse offered', await clickText(win, '.pop .menu-item', '沿用上轮结论'));
  await win.waitForTimeout(300);
  await clickText(win, '.modal .acts .btn', '沿用');
  await win.waitForTimeout(400);
  const decided = await win.evaluate(() => [...document.querySelectorAll('.dlist .drow')].find((x) => /十五/.test(x.textContent))?.className || '');
  ok('reuse applied “拒绝”', /v-r/.test(decided), { cls: decided });
  await clickText(win, '.toast .toast-btn', '撤销');
  await win.waitForTimeout(300);
  ok('reuse can be undone', !/v-r/.test(await win.evaluate(() => [...document.querySelectorAll('.dlist .drow')].find((x) => /十五/.test(x.textContent))?.className || '')));
  await win.evaluate(() => document.querySelector('.rb-hint .link')?.click());
  await win.waitForTimeout(400);
  ok('one-click reuse on the review bar', /v-r/.test(await win.evaluate(() => [...document.querySelectorAll('.dlist .drow')].find((x) => /十五/.test(x.textContent))?.className || '')));
  // 5. 版本链：点 V2 回到 V1 → V2，看到上一轮的进度
  await win.evaluate(() => document.querySelector('.ver-chip').click());
  await win.waitForTimeout(200);
  const rows = await text(win, '.ver-list');
  ok('version list shows sides and progress', /V1/.test(rows) && /我方/.test(rows) && /对方/.test(rows) && /已审/.test(rows), { rows: rows.replace(/\s+/g, ' ') });
  await win.keyboard.press('Escape');
  ok('no renderer errors', errs.length === 0, errs.length ? { errs: errs.slice(0, 3) } : undefined);
  await app.close();
  // 6. 重启：往来稿还在；归档、删除、撤销
  ({ app, win, errs, pickNext } = await launch());
  await win.waitForSelector('.lib-row', { timeout: 30000 });
  const card = await text(win, '.lib-card');
  ok('persists across restart with progress', /V4/.test(card), { card: card.replace(/\s+/g, ' ').slice(0, 100) });
  await win.evaluate(() => document.querySelector('.lib-card .lib-row .btn.icon').click());
  await win.waitForTimeout(200);
  await clickText(win, '.pop .menu-item', '归档');
  await win.waitForTimeout(300);
  ok('archive hides it and shows “已归档 1”', /已归档 1/.test(await text(win, '.lib-card')));
  await clickText(win, '.lib-card .btn', '已归档');
  await win.evaluate(() => document.querySelector('.lib-card .lib-row .btn.icon').click());
  await win.waitForTimeout(200);
  await clickText(win, '.pop .menu-item', '删除往来稿');
  await win.waitForTimeout(300);
  await clickText(win, '.toast .toast-btn', '撤销');
  await win.waitForTimeout(300);
  ok('delete + undo keeps it', /采购合同/.test(await text(win, '.lib-card')));
  ok('no renderer errors after restart', errs.length === 0, errs.length ? { errs: errs.slice(0, 3) } : undefined);
  await app.close();
  const failed = Object.values(checks).filter((c) => !c.ok).length;
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(checks, null, 1));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
