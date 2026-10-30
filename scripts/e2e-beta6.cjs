// beta.6 回归：首页卡片和放文件区域对齐；审阅稿只在修订审阅里出现；以前的审阅稿不见了时自动重新生成 / 先问我。只用合成夹具。
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..'); const FIX = path.join(R, 'work/review-fixtures');
const E = process.env.ELECTRON || path.join(R, 'node_modules/electron/dist/electron');
const APP = process.env.APP || R;
const checks = []; const ok = (k, v, info) => { checks.push(!!v); console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-b6-'));
const F = (n) => path.join(dir, `采购合同-${n}.docx`);
for (const n of ['V1', 'V2']) fs.copyFileSync(path.join(FIX, `neg-${n}.docx`), F(n));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'c-'));
async function launch(args) {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, ...args], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 });
  return { app, w, errs };
}
const clickText = (w, s, re) => w.evaluate(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); b?.click(); return !!b; }, [s, re]);
const drafts = () => fs.readdirSync(dir).filter((f) => /我方意见/.test(f));
(async () => {
  // 1. 首页对齐
  { const { app, w } = await launch([]);
    // beta.7：第一次用（库是空的）时没有两张卡片，改为一行说明；它和两块放置区的外沿对齐
    await w.waitForSelector('.home-intro', { timeout: 30000 });
    for (const W of [1440, 1100]) { await w.setViewportSize({ width: W, height: 900 }); await w.waitForTimeout(300);
      const r = await w.evaluate(() => { const d = [...document.querySelectorAll('.drops .drop')].map((x) => x.getBoundingClientRect()); const c = document.querySelector('.home-intro').getBoundingClientRect(); return { d: d.map((x) => [Math.round(x.left), Math.round(x.right)]), c: [Math.round(c.left), Math.round(c.right)] }; });
      ok(`home intro lines up with the drop zones at ${W}px`, r.d.length === 2 && Math.abs(r.d[0][0] - r.c[0]) <= 1 && Math.abs(r.d[1][1] - r.c[1]) <= 1, r); }
    await app.close(); }
  // 2. 修订审阅里生成审阅稿，然后删掉它
  { const { app, w } = await launch([F('V1'), F('V2')]);
    await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
    ok('rich text: no review draft chip and nothing written', !(await w.$('.draft-chip')) && drafts().length === 0);
    await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await w.waitForTimeout(500);
    await clickText(w, '.reviewer-ask .btn', '好的');
    await w.evaluate(() => document.querySelector('.dlist .drow')?.click()); await w.keyboard.press('r'); await w.waitForTimeout(800);
    await w.evaluate(() => document.querySelector('.tb-start')?.click()); await w.waitForTimeout(1200); // beta.7：手动开始
    ok('review: draft created', drafts().length === 1 && !!(await w.$('.draft-chip')));
    await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[0].click()); await w.waitForTimeout(400);
    ok('back in rich text: chip hidden', !(await w.$('.draft-chip')));
    await app.close(); }
  fs.unlinkSync(path.join(dir, drafts()[0]));
  // 3. 默认“自动重新生成”：富文本里不提示；进入修订审阅后在原位置重新生成
  { const { app, w, errs } = await launch([F('V1'), F('V2')]);
    await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 }); await w.waitForTimeout(800);
    ok('missing old draft: rich text shows nothing', !(await w.$('.draft-chip')));
    await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await w.waitForTimeout(2000);
    const chip = await w.evaluate(() => document.querySelector('.draft-chip')?.getAttribute('aria-label') || '');
    const toast = await w.evaluate(() => document.querySelector('.toast')?.innerText || '');
    ok('review: recreated automatically in the same place, told once', drafts().length === 1 && /已保存/.test(chip) && /重建/.test(toast), { files: drafts(), chip, toast });
    // 4. 改成“先问我”，再删
    await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')].find((b) => /设置/.test(b.textContent))?.click()); await w.waitForTimeout(300);
    await clickText(w, '.modal button', '^\\s*审阅稿与定稿\\s*$'); await w.waitForTimeout(200); // beta.7：设置拆页
    await clickText(w, '.set-review .seg button', '先问我'); await w.keyboard.press('Escape'); await w.waitForTimeout(300);
    fs.unlinkSync(path.join(dir, drafts()[0]));
    await w.evaluate(() => window.dispatchEvent(new Event('focus'))); await w.waitForTimeout(1200);
    const chip2 = await w.evaluate(() => document.querySelector('.draft-chip')?.getAttribute('aria-label') || '');
    ok('“ask me first”: shows missing, does not recreate by itself', /不见了/.test(chip2) && drafts().length === 0, { chip2 });
    ok('no renderer errors', errs.length === 0, errs.slice(0, 2));
    await app.close(); }
  process.exit(checks.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
