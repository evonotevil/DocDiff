// beta.3 界面截图（只用合成夹具）：xvfb-run -a node scripts/shots-beta3.cjs <输出目录>
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(R, 'work', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const FIX = path.join(R, 'work/review-fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-s-'));
const F = (n) => path.join(dir, `供货框架协议-乙方第二轮修订意见-${n}.docx`);
for (const n of ['V1', 'V2', 'V3']) fs.copyFileSync(path.join(FIX, `neg-${n}.docx`), F(n));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-c-'));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(R, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--lang=zh-CN', R, F('V1'), F('V2')], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  const shot = async (n, sel) => { await w.waitForTimeout(400); if (sel) { const el = await w.$(sel); if (el) return el.screenshot({ path: path.join(OUT, n + '.png') }); } await w.screenshot({ path: path.join(OUT, n + '.png') }); };
  const pickNext = (p) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, p);
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
  await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await w.waitForTimeout(500);
  await w.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click());
  await w.evaluate(() => document.querySelector('.dlist .drow')?.click()); await w.keyboard.press('a');
  await w.waitForSelector('.draft-tip', { timeout: 15000 }).catch(() => {});
  await shot('b4-tip');
  await w.evaluate(() => [...document.querySelectorAll('.draft-tip .btn')].find((b) => /知道了/.test(b.textContent))?.click());
  for (const W of [1440, 1180, 1040, 900, 760]) { await w.setViewportSize({ width: W, height: 900 }); await shot('b2-normal-' + W, '.tbar'); }
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.evaluate(() => document.querySelector('.draft-chip').click()); await w.waitForTimeout(300);
  await w.evaluate(() => [...document.querySelectorAll('.draft-pop .btn')].find((b) => /生成定稿/.test(b.textContent))?.click());
  await shot('b5-final', '.final-dlg'); await w.keyboard.press('Escape');
  // 存为往来稿
  await w.evaluate(() => document.querySelector('.insp .sh .ibtn, .sh .ibtn.act')?.click()); await w.waitForTimeout(200);
  await w.evaluate(() => [...document.querySelectorAll('.pop .menu-item')].find((b) => /存为往来稿/.test(b.textContent))?.click());
  await w.waitForSelector('.ver-chip', { timeout: 10000 });
  for (const W of [1440, 1180, 1040, 900, 760]) { await w.setViewportSize({ width: W, height: 900 }); await shot('b2-thread-' + W, '.tbar'); }
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.evaluate(() => document.querySelector('.ver-chip').click()); await w.waitForTimeout(200);
  await w.evaluate(() => [...document.querySelectorAll('.ver-pop .btn')].find((b) => /加入新版本/.test(b.textContent))?.click());
  await w.waitForSelector('.add-ver'); await shot('b3-add-empty', '.add-ver');
  await pickNext(F('V3')); await w.evaluate(() => document.querySelector('.add-ver .dlg-drop').click()); await w.waitForTimeout(800);
  await shot('b3-add-picked', '.add-ver'); await w.keyboard.press('Escape');
  // 设置 · 审阅
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')].find((b) => /设置/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.evaluate(() => [...document.querySelectorAll('.modal button, .modal [role=tab]')].find((b) => /^\s*审阅\s*$/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.evaluate(() => [...document.querySelectorAll('.name-ed')][1]?.scrollIntoView());
  await shot('b6-settings', '.modal');
  // 定稿规则：插入日期，改文字，切换日期格式
  await w.evaluate(() => { const ed = document.querySelectorAll('.name-ed')[1]; const i = ed.querySelector('.name-txt'); i.click(); i.focus(); i.setSelectionRange(0, 0); });
  await w.evaluate(() => [...document.querySelectorAll('.name-ed')[1].querySelectorAll('.name-ins .btn')].find((b) => /日期/.test(b.textContent)).click()); await w.waitForTimeout(200);
  await w.evaluate(() => { const ed = document.querySelectorAll('.name-ed')[1]; const ins = [...ed.querySelectorAll('.name-txt')]; const last = ins[ins.length - 1]; last.focus(); last.select(); });
  await w.keyboard.type('-legal');
  await w.evaluate(() => document.querySelectorAll('.name-ed')[1].querySelector('.name-tag').click()); await w.waitForTimeout(200);
  await shot('b6-date-menu');
  await w.evaluate(() => [...document.querySelectorAll('.name-fmt .seg button')].find((b) => /2026-/.test(b.textContent))?.click()); await w.waitForTimeout(200);
  const pv = await w.evaluate(() => document.querySelectorAll('.name-ed')[1].querySelector('.pv').textContent);
  console.log('preview', pv);
  await shot('b6-edited', '.modal'); await w.keyboard.press('Escape');
  // 首页
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click());
  await w.waitForSelector('.recent-row', { timeout: 15000 }).catch(() => {});
  await shot('b1-home');
  console.log('errors', errs);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
