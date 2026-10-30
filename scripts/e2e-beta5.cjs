// beta.5 回归（评估 F1/F2/F3/F5 + 弹出层改名）：只用合成夹具。xvfb-run -a node scripts/e2e-beta5.cjs
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..'); const FIX = path.join(R, 'work/review-fixtures');
const E = process.env.ELECTRON || path.join(R, 'node_modules/electron/dist/electron');
const APP = process.env.APP || R;
const SH = process.env.SHOTS; const shot = async (w, n, sel) => { if (!SH) return; fs.mkdirSync(SH, { recursive: true }); await w.waitForTimeout(300); const el = sel && await w.$(sel); await (el || w).screenshot({ path: path.join(SH, n + '.png') }); };
const checks = []; const ok = (k, v, info) => { checks.push(!!v); console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); };
async function launch(args, cfg) {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, ...args], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; shell.openPath = async () => ''; });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 });
  const pick = (p) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, p);
  return { app, w, errs, pick };
}
const txt = (w, s) => w.evaluate((s) => document.querySelector(s)?.innerText || '', s);
const clickText = (w, s, re) => w.evaluate(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); b?.click(); return !!b; }, [s, re]);
const toReview = async (w) => { await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await w.waitForTimeout(500); await clickText(w, '.reviewer-ask .btn', '好的'); await w.evaluate(() => document.querySelector('.tb-start')?.click()); await w.waitForTimeout(800); }; // beta.7：手动开始审阅稿
const decideOn = async (w, re, key) => { await w.evaluate((r) => [...document.querySelectorAll('.dlist .drow')].find((x) => new RegExp(r).test(x.textContent))?.click(), re); await w.waitForTimeout(200); await w.keyboard.press(key); await w.waitForTimeout(400); };
const dismissTip = (w) => clickText(w, '.draft-tip .btn', '知道了');
const verdicts = (w) => w.evaluate(() => [...document.querySelectorAll('.dlist .drow')].map((x) => (x.className.match(/v-[arh]/) || ['-'])[0]).join(''));

(async () => {
  // ---------- F1 定稿遗漏 ----------
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-f1-'));
    for (const v of [1, 2]) fs.copyFileSync(path.join(FIX, `header-V${v}.docx`), path.join(dir, `页眉样本-V${v}.docx`));
    const { app, w, errs } = await launch([path.join(dir, '页眉样本-V1.docx'), path.join(dir, '页眉样本-V2.docx')], fs.mkdtempSync(path.join(os.tmpdir(), 'c-')));
    await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
    await toReview(w);
    await w.evaluate(() => document.querySelector('.dlist .drow')?.click()); await w.keyboard.press('r');
    await w.waitForSelector('.draft-chip', { timeout: 15000 }); await w.waitForTimeout(800); await shot(w, 'done'); await dismissTip(w);
    await w.evaluate(() => document.querySelector('.draft-chip').click()); await w.waitForTimeout(200);
    await clickText(w, '.draft-pop .btn', '生成定稿');
    await w.waitForSelector('.final-dlg'); await clickText(w, '.final-dlg .acts .btn', '^生成定稿$');
    await w.waitForTimeout(1500);
    await shot(w, 'final-missed', '.final-dlg');
    const dlg = await txt(w, '.final-dlg');
    const finals = () => fs.readdirSync(dir).filter((f) => /定稿/.test(f));
    ok('F1 final with an unwritable rejected change stops and lists it (no file yet)', /没能落实/.test(dlg) && /第 1 处/.test(dlg) && /仍然生成定稿/.test(dlg) && finals().length === 0, { dlg: dlg.replace(/\s+/g, ' ').slice(0, 120), files: finals() });
    await clickText(w, '.final-dlg .acts .btn', '仍然生成定稿'); await w.waitForTimeout(1500);
    const f = finals()[0];
    const hdr = f ? cp.execSync(`unzip -p "${path.join(dir, f)}" 'word/header*.xml'`).toString() : '';
    const flash = await txt(w, '.toast');
    ok('F1 after confirming: file saved, content matches the warning, completion message says it', !!f && hdr.includes('198000') && /没能改回原文/.test(flash), { f, flash });
    ok('F1 no renderer errors', errs.length === 0, errs.slice(0, 2));
    await app.close();
  }
  // ---------- F2/F3/F5/改名：往来稿 ----------
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-f3-'));
    const F = (n) => path.join(dir, `采购合同-${n}.docx`);
    for (const n of ['V1', 'V2', 'V3', 'V4']) fs.copyFileSync(path.join(FIX, `neg-${n}.docx`), F(n));
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'c-'));
    const { app, w, errs, pick } = await launch([F('V1'), F('V2')], cfg);
    await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
    await toReview(w);
    await decideOn(w, '十五', 'r'); await decideOn(w, '六十', 'r');
    await w.waitForTimeout(800); await dismissTip(w);
    await w.evaluate(() => document.querySelector('.insp .sh .ibtn, .sh .ibtn.act')?.click()); await w.waitForTimeout(200);
    await clickText(w, '.pop .menu-item', '存为往来稿');
    await w.waitForSelector('.ver-chip', { timeout: 10000 }); await w.waitForTimeout(900);
    // 弹出层里改名
    await w.evaluate(() => document.querySelector('.ver-chip').click()); await w.waitForTimeout(300);
    await clickText(w, '.pop .link-btn', '重命名'); await w.waitForTimeout(200);
    await w.keyboard.press('ControlOrMeta+a'); await w.keyboard.type('演示往来稿', { delay: 60 }); await w.keyboard.press('Enter'); await w.waitForTimeout(400);
    ok('renaming inside the version popover keeps focus while typing', /演示往来稿/.test(await txt(w, '.ver-chip')), { chip: await txt(w, '.ver-chip') });
    await w.keyboard.press('Escape');
    // F3：加入 V3，和 V1 比
    await w.evaluate(() => document.querySelector('.ver-chip').click()); await w.waitForTimeout(200);
    await clickText(w, '.ver-pop .btn', '加入新版本');
    await w.waitForSelector('.add-ver'); await pick(F('V3')); await w.evaluate(() => document.querySelector('.add-ver .dlg-drop').click()); await w.waitForTimeout(600);
    await w.evaluate(() => [...document.querySelectorAll('.add-ver .ver-row')].find((x) => /V1/.test(x.textContent))?.click());
    await clickText(w, '.add-ver .acts .btn', '加入并比较 V1');
    await w.waitForFunction(() => /V1\s*→\s*V3/.test(document.querySelector('.ver-chip')?.innerText || ''), null, { timeout: 30000 });
    await w.waitForTimeout(500);
    await w.evaluate(() => document.querySelector('.dlist .drow')?.click()); await w.keyboard.press('r'); await w.waitForTimeout(800);
    const pos13 = await txt(w, '.tb-pos');
    await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click());
    await w.waitForSelector('.lib-row', { timeout: 15000 });
    const card = (await txt(w, '.lib-card')).replace(/\s+/g, ' ');
    ok('F3 home card shows the full pair V1 → V3 with its own progress', /V1 → V3/.test(card), { card: card.slice(0, 90) });
    // F5：更多 → Esc → Enter 打开菜单，不打开往来稿
    await w.evaluate(() => document.querySelector('.lib-card .lib-row .btn.icon').click()); await w.waitForTimeout(250);
    await w.keyboard.press('Escape'); await w.waitForTimeout(150);
    const focusOnMore = await w.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    await w.keyboard.press('Enter'); await w.waitForTimeout(400);
    ok('F5 Enter on “更多” opens the menu, not the negotiation', focusOnMore === '更多' && !!(await w.$('.pop')) && !(await w.$('.ver-chip')), { focusOnMore });
    await w.keyboard.press('Escape'); await w.waitForTimeout(150);
    await w.keyboard.press(' '); await w.waitForTimeout(400);
    ok('F5 Space on “更多” also stays on the menu', !(await w.$('.ver-chip')));
    await w.keyboard.press('Escape'); await w.waitForTimeout(150);
    // 重新打开：回到 V1 → V3，进度还在
    await w.evaluate(() => document.querySelector('.lib-card .lib-row').click());
    await w.waitForFunction(() => !!document.querySelector('.ver-chip') && !!document.querySelector('.tb-prog, .tb-pos'), null, { timeout: 30000 });
    await w.waitForTimeout(600);
    const chip = await txt(w, '.ver-chip'), pos = await txt(w, '.tb-pos');
    ok('F3 reopening restores V1 → V3 with the same progress', /V1\s*→\s*V3/.test(chip) && pos === pos13, { chip: chip.replace(/\s+/g, ' '), pos, before: pos13 });
    // 版本弹出层：比较过的、换个比较
    await w.evaluate(() => document.querySelector('.ver-chip').click()); await w.waitForTimeout(250);
    await shot(w, 'ver-pop');
    const popTxt = (await txt(w, '.ver-pop')).replace(/\s+/g, ' ');
    ok('F3 popover lists compared pairs and offers choosing another base', /比较过的/.test(popTxt) && /V1 → V3/.test(popTxt) && /V1 → V2/.test(popTxt) && !!(await w.$('.ver-pick select')), { popTxt: popTxt.slice(0, 160) });
    await w.evaluate(() => [...document.querySelectorAll('.ver-pair')].find((x) => /V1 → V2/.test(x.textContent))?.click());
    await w.waitForFunction(() => /V1\s*→\s*V2/.test(document.querySelector('.ver-chip')?.innerText || ''), null, { timeout: 30000 });
    ok('F3 picking a compared pair opens it', true);
    // F2：加入 V4（和 V1 比，和评估报告一样），沿用确认框打开时按 A/R/H/J/K/U 不影响后台
    await w.evaluate(() => document.querySelector('.ver-chip').click()); await w.waitForTimeout(200);
    await clickText(w, '.ver-pop .btn', '加入新版本');
    await w.waitForSelector('.add-ver'); await pick(F('V4')); await w.evaluate(() => document.querySelector('.add-ver .dlg-drop').click()); await w.waitForTimeout(600);
    await w.evaluate(() => [...document.querySelectorAll('.add-ver .ver-row')].find((x) => /V1/.test(x.textContent))?.click());
    await clickText(w, '.add-ver .acts .btn', '加入并比较');
    await w.waitForFunction(() => /V1\s*→\s*V4/.test(document.querySelector('.ver-chip')?.innerText || ''), null, { timeout: 30000 });
    await w.waitForTimeout(800);
    const before = await verdicts(w);
    const draftFiles = () => fs.readdirSync(dir).filter((f) => /我方意见/.test(f)).map((f) => f + ':' + fs.statSync(path.join(dir, f)).mtimeMs).join('|');
    const dfBefore = draftFiles();
    await w.evaluate(() => document.querySelector('.ibtn.sm.act')?.click()); await w.waitForTimeout(200);
    const opened = await clickText(w, '.pop .menu-item', '沿用上轮结论');
    await w.waitForSelector('.modal', { timeout: 5000 }).catch(() => {});
    await w.evaluate(() => document.querySelector('.modal .modal-head .btn')?.focus());
    for (const k of ['a', 'r', 'h', 'j', 'k', 'u']) { await w.keyboard.press(k); await w.waitForTimeout(120); }
    const stillOpen = !!(await w.$('.modal'));
    await w.keyboard.press('Escape'); await w.waitForTimeout(1200);
    const after = await verdicts(w);
    ok('F2 keys pressed in the reuse confirmation do not change decisions or the review draft', opened && stillOpen && before === after && draftFiles() === dfBefore, { opened, stillOpen, before, after });
    ok('no renderer errors (negotiation)', errs.length === 0, errs.slice(0, 2));
    await app.close();
  }
  process.exit(checks.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
