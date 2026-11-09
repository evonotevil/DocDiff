// 1.9.3 端到端检查（只用合成夹具，文件名一律 Document A / B）：
//   F9b / F11 首页（第一次用和用过之后同一套三块、插画、页签、空卡片、卡片无悬停）
//   F12 快捷键（悬停提示「名称 · 快捷键」、按 ? 弹出速查、输入框里不触发）
//   F13 格式变化太密（提示、只看文字修改、恢复、不再提示）
//   F14 演示（播放、步骤点、暂停、重播、减少动态效果、深色、英文）
// 用法：python3 scripts/make-format-noise.py && xvfb-run -a node scripts/e2e-193.cjs [截图目录]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, '../work/shots-193');
fs.mkdirSync(OUT, { recursive: true });
const FIX = path.join(__dirname, '../work');
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info).slice(0, 300) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(files = [], lang = 'zh-CN', cfg) {
  cfg = cfg || fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=' + lang, ...(process.env.PACKAGED ? [] : [APP]), ...files], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message)); win.on('console', (m) => { if (m.type() === 'error' && /渲染出错|TypeError|ReferenceError/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await win.setViewportSize({ width: 1280, height: 820 });
  return { app, win, errs, cfg };
}
const text = (win, sel) => win.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
const shot = (win, n) => win.screenshot({ path: path.join(OUT, n + '.png') });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-193-'));
  const A = path.join(dir, 'Document A.docx'), B = path.join(dir, 'Document B.docx');
  fs.copyFileSync(path.join(FIX, 'format-noise/fmt-A.docx'), A); fs.copyFileSync(path.join(FIX, 'format-noise/fmt-B.docx'), B);

  // ---------- F11 第一次用的首页 ----------
  let s = await launch();
  let { win } = s;
  await win.waitForSelector('.home-cta'); await sleep(500);
  const first = await win.evaluate(() => ({
    hero: !!document.querySelector('.hero'), intro: !!document.querySelector('.home-intro'), cols: !!document.querySelector('.lib-cols'),
    empties: [...document.querySelectorAll('.empty-card .ec-t')].map((e) => e.textContent), demos: document.querySelectorAll('.empty-card .ec-demo').length,
    illos: document.querySelectorAll('.mod-illo svg.illo').length, sub: document.querySelector('.mod-sub')?.textContent || '', chips: document.querySelectorAll('.mod-ic').length,
  }));
  ok('first run: same three modules, no hero / intro line', !first.hero && !first.intro && first.cols, first);
  ok('first run: two empty cards with 72px illustrations and “see how it works”', first.empties.length === 2 && first.demos === 2, first);
  ok('module titles use the 28px illustrations, no coloured chips', first.illos === 3 && first.chips === 0, first);
  ok('“不会上传” sits next to the 新比较 title on first run', /不会上传/.test(first.sub));
  const tabCol = await win.evaluate(() => getComputedStyle(document.querySelector('.mod-tabs button.on')).color);
  ok('selected tab is Macaw blue', tabCol === 'rgb(28, 176, 246)', { tabCol });
  await shot(win, '01-first-run');

  // ---------- F12 快捷键速查 ----------
  await win.keyboard.press('Shift+Slash'); await sleep(300);
  const keys = await text(win, '.keys-dlg');
  ok('? opens the shortcut list on home (查找 / 快捷键速查 included)', /快捷键/.test(keys) && /查找/.test(keys) && /快捷键速查/.test(keys), { keys: keys.slice(0, 80) });
  await shot(win, '02-keys');
  await win.keyboard.press('Escape'); await sleep(200);
  ok('Esc closes the shortcut list', !(await win.$('.keys-dlg')));
  const tips = await win.evaluate(() => ({ swap: document.querySelector('.vs-ic')?.title, pick: document.querySelector('.drops .drop button')?.title }));
  ok('tooltips read “name · shortcut”', / · /.test(tips.swap || '') && / · /.test(tips.pick || ''), tips);
  // 输入框里打 ? 不弹
  await win.evaluate(() => [...document.querySelectorAll('.drops .drop .btn')].find((b) => /粘贴/.test(b.textContent))?.click()); await sleep(300);
  await win.keyboard.type('?'); await sleep(200);
  ok('typing ? in a text box does not open the list', !(await win.$('.keys-dlg')) && (await win.evaluate(() => document.querySelector('textarea')?.value)) === '?');
  await win.keyboard.press('Escape'); await sleep(200);

  // ---------- F14 演示 ----------
  await win.evaluate(() => document.querySelector('.mod-tpl .ec-demo').click()); await sleep(400);
  const c0 = await text(win, '.demo-cap');
  ok('template demo opens on step 1 with a caption', /① 新建模板/.test(c0), { c0 });
  await sleep(2400);
  ok('a simulated cursor moves to the target', !!(await win.$('.demo-cursor')));
  await shot(win, '03-demo-tpl-1');
  await sleep(6400);
  ok('after ~8 s it moves on to step 2', /② 对方发来改稿/.test(await text(win, '.demo-cap')), { cap: await text(win, '.demo-cap') });
  await win.evaluate(() => document.querySelectorAll('.demo-dots button')[2].click()); await sleep(600);
  ok('clicking the third dot jumps to step 3', /③ 自动认出/.test(await text(win, '.demo-cap')));
  await win.evaluate(() => [...document.querySelectorAll('.demo-ctl .btn')].find((b) => /暂停/.test(b.getAttribute('aria-label')))?.click()); await sleep(9000);
  ok('pause stops the demo (still on step 3, not closed)', /③/.test(await text(win, '.demo-cap')) && !!(await win.$('.demo-dlg')));
  await win.evaluate(() => [...document.querySelectorAll('.demo-ctl .btn')].find((b) => /重播/.test(b.getAttribute('aria-label')))?.click()); await sleep(500);
  ok('replay goes back to step 1', /①/.test(await text(win, '.demo-cap')));
  await win.keyboard.press('Escape'); await sleep(300);
  await win.evaluate(() => document.querySelector('.mod-lib .ec-demo').click()); await sleep(400);
  ok('negotiation demo has 4 steps', (await win.evaluate(() => document.querySelectorAll('.demo-dots button').length)) === 4 && /① 比较完/.test(await text(win, '.demo-cap')));
  await win.evaluate(() => document.querySelectorAll('.demo-dots button')[3].click()); await sleep(5200);
  await win.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await sleep(300);
  ok('step 4 shows the last-round hint and clause history', /你拒绝过这处修改/.test(await text(win, '.demo-stage')) && /条款历史/.test(await text(win, '.demo-stage')));
  await shot(win, '04-demo-lib-4-dark');
  await win.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await win.keyboard.press('Escape'); await sleep(300);
  // 减少动态效果：不自动播放，一步一张静态画面
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.evaluate(() => document.querySelector('.mod-tpl .ec-demo').click()); await sleep(400);
  const still = await win.evaluate(() => ({ cursor: !!document.querySelector('.demo-cursor'), pause: [...document.querySelectorAll('.demo-ctl .btn')].some((b) => /暂停|播放/.test(b.getAttribute('aria-label'))), still: !!document.querySelector('.demo-stage.still') }));
  await sleep(9000);
  ok('reduced motion: no autoplay, no cursor, no play / pause (static step)', still.still && !still.cursor && !still.pause && /①/.test(await text(win, '.demo-cap')), still);
  ok('reduced motion: step 1 shows its final state (template saved)', /标准服务协议/.test(await text(win, '.demo-stage')));
  await win.evaluate(() => document.querySelectorAll('.demo-dots button')[1].click()); await sleep(300);
  ok('reduced motion: dots switch steps', /②/.test(await text(win, '.demo-cap')));
  await win.keyboard.press('Escape'); await win.emulateMedia({ reducedMotion: 'no-preference' });
  ok('no page errors (first run + demos)', !s.errs.length, s.errs);
  await s.app.close();

  // ---------- F13 格式变化太密 + F9b 用过之后的首页 ----------
  s = await launch([A, B]); win = s.win;
  await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 }); await sleep(800);
  const h = await win.evaluate(() => ({ t: document.querySelector('.fmt-hint')?.innerText || '', n: document.querySelectorAll('.dlist .drow').length }));
  ok('format noise: hint at the top of the change list (whole paragraphs in a different font and size)', /处是格式变化，多数是整段字体、字号不同/.test(h.t) && /只看文字修改/.test(h.t), h);
  await shot(win, '05-fmt-hint');
  await win.evaluate(() => [...document.querySelectorAll('.fmt-hint .btn')].find((b) => /只看文字修改/.test(b.textContent)).click());
  await win.waitForFunction(() => !!document.querySelector('.fmt-off'), null, { timeout: 30000 }).catch(() => {});
  await sleep(800);
  const off = await win.evaluate(() => ({ t: document.querySelector('.fmt-off')?.innerText || '', n: document.querySelectorAll('.dlist .drow').length, hint: !!document.querySelector('.fmt-hint') }));
  ok('“只看文字修改”: formatting hidden, only the text edit is left, can be undone', /已隐藏 \d+ 处格式变化/.test(off.t) && off.n >= 1 && off.n < h.n && !off.hint, off);
  await shot(win, '06-fmt-off');
  await win.evaluate(() => document.querySelector('.fmt-off .link-btn').click());
  await win.waitForFunction((n) => document.querySelectorAll('.dlist .drow').length >= n, h.n, { timeout: 30000 }).catch(() => {});
  await sleep(500);
  const back = await win.evaluate(() => ({ hint: !!document.querySelector('.fmt-hint'), off: !!document.querySelector('.fmt-off'), n: document.querySelectorAll('.dlist .drow').length }));
  ok('“恢复”: formatting back, and the hint does not come back for this pair', !back.hint && !back.off && back.n === h.n, back);
  await win.keyboard.press('Shift+Slash'); await sleep(300);
  ok('? also works on the compare page', !!(await win.$('.keys-dlg')));
  await win.keyboard.press('Escape'); await sleep(200);
  const navTip = await win.evaluate(() => document.querySelector('.nav-list .nav-item')?.title || '');
  ok('mode tooltip reads “富文本 · shortcut”', /^富文本 · /.test(navTip), { navTip });
  // 回首页：用过之后的首页
  await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click()); await win.waitForSelector('.home', { timeout: 10000 }); await sleep(600);
  const vet = await win.evaluate(() => ({ rows: document.querySelectorAll('.mod-lib .lib-row').length, cnt: getComputedStyle(document.querySelector('.mod-tabs .cnt')).backgroundColor, sub: !!document.querySelector('.mod-sub'), band: getComputedStyle(document.querySelector('.mod-new .mod-h')).backgroundColor }));
  ok('later home: recent row listed; counts are plain grey text; white header (no grey band)', vet.rows >= 1 && /rgba\(0, 0, 0, 0\)|transparent/.test(vet.cnt) && /rgba\(0, 0, 0, 0\)|transparent/.test(vet.band) && !vet.sub, vet);
  const b0 = await win.evaluate(() => getComputedStyle(document.querySelector('.mod-tpl')).borderTopColor);
  await win.hover('.mod-tpl'); await sleep(300);
  ok('cards have no hover effect', b0 === (await win.evaluate(() => getComputedStyle(document.querySelector('.mod-tpl')).borderTopColor)));
  await win.hover('.mod-lib .lib-row'); await sleep(250);
  ok('rows get the light grey hover background', (await win.evaluate(() => getComputedStyle(document.querySelector('.mod-lib .lib-row')).backgroundColor)) === 'rgb(247, 247, 247)');
  await shot(win, '07-home-later');
  await win.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await sleep(300);
  await shot(win, '08-home-later-dark');
  ok('no page errors (compare + home)', !s.errs.length, s.errs);
  await s.app.close();

  // ---------- 英文 ----------
  s = await launch([], 'en-US'); win = s.win;
  await win.waitForSelector('.home-cta'); await sleep(400);
  await win.evaluate(() => document.querySelector('.mod-lib .ec-demo').click()); await sleep(2500);
  const en = await win.evaluate(() => (document.querySelector('.home')?.innerText || '') + '\n' + (document.querySelector('.demo-dlg')?.innerText || ''));
  const cjk = (en.match(/[一-鿿]+/g) || []).filter((x) => x !== '中文');
  ok('English: home and demo have no Chinese left', !cjk.length, cjk.slice(0, 8));
  await shot(win, '09-en-demo');
  await win.keyboard.press('Escape'); await win.keyboard.press('Shift+Slash'); await sleep(300);
  ok('English: shortcut list title', /Keyboard shortcuts|Shortcuts/.test(await text(win, '.keys-dlg')));
  ok('no page errors (English)', !s.errs.length, s.errs);
  await s.app.close();
  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
