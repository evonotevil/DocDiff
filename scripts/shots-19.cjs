// 1.9 对对截图走查（只用合成夹具 basic-*.docx）：首页探头 / 拖文件 / 到齐、审阅过半探头、完成页、
// 弹窗里的对对、完成一件事的瞬间、图鉴、关掉开关后。用法：APP=<应用目录> xvfb-run -a node scripts/shots-19.cjs [输出目录]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, '../work/shots-19');
fs.mkdirSync(OUT, { recursive: true });
const FIX = path.join(__dirname, '../work/review-fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-s19-'));
const A = path.join(dir, 'Document A.docx'), B = path.join(dir, 'Document B.docx');
fs.copyFileSync(path.join(FIX, 'basic-A.docx'), A); fs.copyFileSync(path.join(FIX, 'basic-B.docx'), B);
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info) : ''}`); };

(async () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1360, height: 860 });
  const shot = (n) => win.screenshot({ path: path.join(OUT, n + '.png') });
  await win.waitForSelector('.home-cta');
  await win.waitForTimeout(600);
  ok('home peek mounted with a bubble', !!(await win.$('.home-peek .mascot')) && !!(await win.$('.home-peek .m-bubble')));
  ok('first-run hero mascot replaced by the peek', !(await win.$('.hero .mascot')));
  await shot('01-home');
  // 拖文件进窗口
  await win.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.txt')); window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt })); });
  await win.waitForTimeout(300);
  ok('drag shows “放这儿！”', /放这儿/.test(await win.evaluate(() => document.querySelector('.home-peek .m-bubble')?.textContent || '')));
  await shot('02-drag');
  await win.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.txt')); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt })); });
  // 点它
  await win.click('.home-peek .peek-body'); await win.waitForTimeout(200);
  ok('click changes the line', !!(await win.$('.home-peek .m-bubble')));
  // 两份到齐
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, A);
  await win.evaluate(() => [...document.querySelectorAll('.drops .drop')][0].querySelector('button').click()); await win.waitForTimeout(1200);
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, B);
  await win.evaluate(() => [...document.querySelectorAll('.drops .drop')][1].querySelector('button').click()); await win.waitForTimeout(1500);
  ok('both loaded: “齐了！”', /齐了/.test(await win.evaluate(() => document.querySelector('.home-peek .m-bubble')?.textContent || '')));
  await shot('03-ready');
  // 键入名字彩蛋
  await win.keyboard.type('duidui'); await win.waitForTimeout(250);
  ok('typing duidui triggers the egg', /发现/.test(await win.evaluate(() => document.querySelector('.home-peek .m-bubble')?.textContent || '')));
  // 弹窗：设置（开心）+ 关于页图鉴
  await win.evaluate(() => document.querySelector('.home-top button[aria-label="设置"]').click()); await win.waitForTimeout(300);
  ok('settings dialog has a 36px mascot left of the title', !!(await win.$('.modal-head .modal-mascot .mascot')));
  ok('general tab has the mascot switch', /让对对出来走走/.test(await win.evaluate(() => document.querySelector('.set-pane')?.innerText || '')));
  await shot('04-settings');
  await win.evaluate(() => [...document.querySelectorAll('.set-tabs button')].find((b) => /关于/.test(b.textContent)).click()); await win.waitForTimeout(200);
  await win.evaluate(() => document.querySelector('.dex-toggle').click()); await win.waitForTimeout(200);
  const dex = await win.evaluate(() => ({ n: document.querySelectorAll('.dex-card').length, seen: document.querySelectorAll('.dex-card:not(.locked)').length, head: document.querySelector('.dex-n')?.textContent }));
  ok('dex lists 52 items, some already seen', dex.n === 52 && dex.seen >= 3, dex);
  await win.evaluate(() => document.querySelector('.set-pane').scrollTop = 99999); await win.waitForTimeout(100);
  await shot('05-dex');
  await win.keyboard.press('Escape'); await win.waitForTimeout(200);
  // 开始比较 → 审阅
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => !!document.querySelector('.tb-pos') || !!document.querySelector('.tb-prog'), null, { timeout: 60000 });
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await win.waitForTimeout(500);
  await win.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click());
  const n = await win.evaluate(() => document.querySelectorAll('.dlist .drow').length);
  await win.evaluate(() => document.querySelectorAll('.dlist .drow')[0].click()); await win.waitForTimeout(200);
  for (let i = 0; i < Math.ceil(n / 2); i++) { await win.keyboard.press('a'); await win.waitForTimeout(350); }
  await win.waitForTimeout(700);
  ok('halfway: text toast kept and mascot peeks in the inspector', !!(await win.$('.review-peek .mascot')) && /过半/.test(await win.evaluate(() => document.querySelector('.toast')?.textContent || '')), { n });
  await shot('06-halfway');
  await win.waitForTimeout(1600);
  ok('review peek retracts after 1.5 s', !(await win.$('.review-peek')));
  // 复制摘要：剪贴板时刻
  await win.evaluate(() => document.querySelector('.tb-copy')?.click()); await win.waitForTimeout(250);
  ok('copy summary shows the clipboard moment next to the toast', !!(await win.$('.toast .moment .mascot')));
  await shot('07-moment');
  await win.waitForTimeout(1300);
  // 批量接受弹窗（思考）
  await win.evaluate(() => document.querySelector('.ibtn.sm.act')?.click()); await win.waitForTimeout(200);
  await win.evaluate(() => [...document.querySelectorAll('.pop .menu-item')].find((b) => /全部接受/.test(b.textContent))?.click()); await win.waitForTimeout(300);
  ok('bulk dialog has the thinking mascot', !!(await win.$('.bulk-ask .modal-mascot .mascot')));
  await shot('08-bulk');
  await win.evaluate(() => document.querySelector('.bulk-ask .btn.primary')?.click()); await win.waitForTimeout(900);
  ok('done page mascot', !!(await win.$('.done-card .mascot')));
  await shot('09-done');
  // 关掉开关：首页回到 1.8 的样子
  await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')].find((b) => /设置/.test(b.textContent))?.click()); await win.waitForTimeout(300);
  await win.evaluate(() => { const o = [...document.querySelectorAll('.set-pane .opt')].find((x) => /让对对出来走走/.test(x.textContent)); o.querySelector('[role="switch"]')?.click(); });
  await win.waitForTimeout(200);
  ok('switch off hides the dialog mascot', !(await win.$('.modal-head .modal-mascot')));
  await win.keyboard.press('Escape');
  await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click()); await win.waitForTimeout(600);
  ok('switch off: no home peek', !(await win.$('.home-peek')));
  await shot('10-off-home');
  ok('no page errors', !errs.length, { errs });
  await app.close();
  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
