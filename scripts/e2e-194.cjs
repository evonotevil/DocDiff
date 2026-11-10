// 1.9.4 端到端检查（只用合成夹具，文件名一律 Document A / B / C）：
//   G1 下拉选择（往来稿「换个比较」、缩放）、G2 输入框、G3 复选框 / 滑块 / 单选卡片、G4 选中与焦点、G6 启动提示可不再提示；
//   界面里没有浏览器原生控件。
// 用法：xvfb-run -a node scripts/e2e-194.cjs [截图目录]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, '../work/shots-194');
fs.mkdirSync(OUT, { recursive: true });
const FIX = path.join(__dirname, '../work/review-fixtures');
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info !== undefined ? ' ' + JSON.stringify(info).slice(0, 300) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newCfg = (extra = {}) => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-194-'));
  fs.mkdirSync(path.join(cfg, 'DocDiff'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'DocDiff', 'settings.json'), JSON.stringify({ lang: 'zh', 'prefs-v2': { sound: false, reviewerName: '测试审阅人', reviewerInitials: 'CS', reviewerAsked: true, mascotWalk: false }, ...extra }));
  return cfg;
};
async function launch(cfg, files = []) {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, ...files], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; });
  const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  return { app, win, errs };
}
const shot = (win, n) => win.screenshot({ path: path.join(OUT, n + '.png') });
const clickText = (win, s, re) => win.evaluate(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); b?.click(); return !!b; }, [s, re]);
// 界面里的原生控件（Form.tsx 里的滑块 .sld、复选框 .cbx 里藏着的 input 除外）
const natives = (win) => win.evaluate(() => [...document.querySelectorAll('select, datalist, input[type=range]:not(.sld), input[type=checkbox], input[type=radio], input[type=number]')].filter((x) => !x.closest('.cbx')).map((x) => x.outerHTML.slice(0, 80)));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-194f-'));
  const F = (n) => path.join(dir, `Document ${n}.docx`);
  fs.copyFileSync(path.join(FIX, 'neg-V1.docx'), F('A')); fs.copyFileSync(path.join(FIX, 'neg-V2.docx'), F('B')); fs.copyFileSync(path.join(FIX, 'neg-V3.docx'), F('C'));

  // ---------- 设置：页签选中 = 白底卡片；焦点框 3px；输入框 L 48 ----------
  let cfg = newCfg();
  let { app, win, errs } = await launch(cfg);
  await win.waitForSelector('.home-cta'); await sleep(400);
  ok('home: no native controls', (await natives(win)).length === 0, await natives(win));
  await win.keyboard.press('Tab'); await sleep(100);
  const ring = await win.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { w: s.outlineWidth, c: s.outlineColor, off: s.outlineOffset }; });
  ok('keyboard focus ring is 3px Macaw, offset 2px', ring.w === '3px' && ring.off === '2px' && ring.c === 'rgb(28, 176, 246)', ring);
  await win.evaluate(() => document.querySelector('.home-top button[aria-label="设置"]').click()); await sleep(300);
  await win.evaluate(() => [...document.querySelectorAll('.set-tabs [role=tab]')].find((b) => /审阅/.test(b.textContent))?.click()); await sleep(300);
  const tab = await win.evaluate(() => { const b = document.querySelector('.set-tabs button.on'); const s = getComputedStyle(b); return { bg: s.backgroundColor, bb: s.borderBottomWidth, h: Math.round(b.getBoundingClientRect().height), color: s.color }; });
  ok('settings tab selected = white card + 4px bottom, 40 high, text not recoloured', tab.bg === 'rgb(255, 255, 255)' && tab.bb === '4px' && tab.h === 40 && tab.color !== 'rgb(28, 176, 246)', tab);
  const inp = await win.evaluate(() => { const i = document.querySelector('#rv-name'); const s = getComputedStyle(i); return { h: Math.round(i.getBoundingClientRect().height), bg: s.backgroundColor, b: s.borderTopWidth }; });
  ok('settings inputs are TextInput L: 48 high, white, 2px border', inp.h === 48 && inp.bg === 'rgb(255, 255, 255)' && inp.b === '2px', inp);
  await shot(win, '01-settings-review');
  await win.keyboard.press('Escape'); await app.close();

  // ---------- 比较页：导出弹窗（单选卡片、复选框、输入框） ----------
  cfg = newCfg();
  ({ app, win, errs } = await launch(cfg, [F('A'), F('B')]));
  await win.waitForFunction(() => document.querySelectorAll('.dlist .drow').length > 0, null, { timeout: 60000 }); await sleep(600);
  ok('compare: no native controls', (await natives(win)).length === 0, await natives(win));
  await win.evaluate(() => [...document.querySelectorAll('.tbar button')].find((b) => /导出/.test(b.textContent))?.click()); await sleep(500);
  const ex = await win.evaluate(() => ({ cards: document.querySelectorAll('.opt-cards [role=radio]').length, on: document.querySelector('.opt-card.on b')?.textContent, cb: document.querySelector('.export-modal .cbx')?.classList.contains('on'), h: Math.round(document.querySelector('#exp-author')?.getBoundingClientRect().height || 0) }));
  ok('export: three OptionCards, first selected; checkbox on; inputs 48 high', ex.cards === 3 && /修订稿/.test(ex.on || '') && ex.cb === true && ex.h === 48, ex);
  await win.evaluate(() => document.querySelector('.export-modal .cbx-t').click()); await sleep(200);
  ok('export: clicking the checkbox label toggles it', await win.evaluate(() => !document.querySelector('.export-modal .cbx').classList.contains('on')));
  await win.evaluate(() => document.querySelectorAll('.opt-cards [role=radio]')[2].click()); await sleep(200);
  ok('export: picking a card selects it (aria-checked)', await win.evaluate(() => document.querySelectorAll('.opt-cards [role=radio]')[2].getAttribute('aria-checked') === 'true'));
  ok('export: no native controls', (await natives(win)).length === 0, await natives(win));
  await shot(win, '02-export');
  await win.keyboard.press('Escape'); await sleep(300);

  // ---------- 往来稿「换个比较」：Select ----------
  await win.evaluate(() => document.querySelector('.export-modal') && document.querySelector('.modal .x, .modal [aria-label="关闭"]')?.click()); await sleep(300);
  await win.evaluate(() => document.querySelector('.filechip')?.click()); await sleep(300);
  await clickText(win, '.pop .menu-item', '存为往来稿');
  await win.waitForSelector('.ver-chip', { timeout: 10000 }); await sleep(900);
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, F('C'));
  await win.evaluate(() => document.querySelector('.ver-chip').click()); await sleep(300);
  await clickText(win, '.ver-pop .btn', '加入新版本');
  await win.waitForSelector('.tpl-dlg'); await win.evaluate(() => document.querySelector('.tpl-dlg .dlg-drop').click()); await sleep(400);
  await clickText(win, '.tpl-dlg .acts .btn', '加入并比较');
  await win.waitForFunction(() => /V2\s*→\s*V3/.test(document.querySelector('.ver-chip')?.innerText || ''), null, { timeout: 30000 }); await sleep(800);
  await win.evaluate(() => document.querySelector('.ver-chip').click()); await sleep(400);
  const vp = await win.evaluate(() => [...document.querySelectorAll('.ver-pick .sel-t')].map((b) => ({ role: b.getAttribute('role'), h: Math.round(b.getBoundingClientRect().height), v: b.innerText.replace(/\s+/g, ' ') })));
  ok('change pair: two Select S triggers (combobox, 30 high) showing V number + side', vp.length === 2 && vp.every((x) => x.role === 'combobox' && x.h === 30) && /V2\s*对方/.test(vp[0].v) && /V3/.test(vp[1].v), vp);
  ok('thread popover: no native controls', (await natives(win)).length === 0, await natives(win));
  await win.evaluate(() => document.querySelector('.ver-pick .sel-t').click()); await sleep(400);
  const lb = await win.evaluate(() => { const l = document.querySelector('.sel-pop [role=listbox]'); const o = [...(l?.querySelectorAll('[role=option]') || [])]; const pop = document.querySelector('.sel-pop'); const t = document.querySelector('.ver-pick .sel-t'); return { n: o.length, sel: o.findIndex((x) => x.getAttribute('aria-selected') === 'true'), check: !!o.find((x) => x.getAttribute('aria-selected') === 'true')?.querySelector('.sel-ck svg'), num: !!o[0]?.querySelector('.vopt-n'), focus: document.activeElement?.getAttribute('role'), gap: Math.round(pop.getBoundingClientRect().top - t.getBoundingClientRect().bottom), w: Math.round(pop.getBoundingClientRect().width), expanded: t.getAttribute('aria-expanded'), selColor: getComputedStyle(o.find((x) => x.getAttribute('aria-selected') === 'true')).color }; });
  ok('open: DocDiff menu (listbox), current option checked in Macaw, V numbers, focus on option, 8px below, ≥ 160 wide', lb.n === 2 && lb.sel === 1 && lb.check && lb.num && lb.focus === 'option' && lb.gap === 8 && lb.w >= 160 && lb.expanded === 'true', lb);
  await shot(win, '03-thread-select-open');
  await win.keyboard.press('ArrowUp'); await win.keyboard.press('Enter'); await sleep(300);
  const after = await win.evaluate(() => ({ open: !!document.querySelector('.sel-pop'), pop: !!document.querySelector('.ver-pop'), v: document.querySelector('.ver-pick .sel-t').innerText.replace(/\s+/g, ' '), focus: document.activeElement?.classList.contains('sel-t') }));
  ok('keyboard ↑ + Enter picks V1, menu closes, popover stays, focus back on trigger', !after.open && after.pop && /V1/.test(after.v) && after.focus, after);
  await win.evaluate(() => document.querySelector('.ver-pick .sel-t').click()); await sleep(300);
  await win.keyboard.press('Escape'); await sleep(200);
  ok('Esc closes only the menu, not the thread popover', await win.evaluate(() => !document.querySelector('.sel-pop') && !!document.querySelector('.ver-pop')));
  await clickText(win, '.ver-pick .btn', '比较');
  await win.waitForFunction(() => /V1\s*→\s*V3/.test(document.querySelector('.ver-chip')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
  ok('“比较” opens the picked pair (V1 → V3)', await win.evaluate(() => /V1\s*→\s*V3/.test(document.querySelector('.ver-chip')?.innerText || '')));
  ok('no page errors (compare)', errs.length === 0, errs);
  await app.close();

  // ---------- 图像模式：Slider、缩放 Select ----------
  cfg = newCfg();
  const PA = path.join(dir, 'Document A.pdf'), PB = path.join(dir, 'Document B.pdf');
  fs.copyFileSync(path.join(__dirname, '../work/pdf-align/base.pdf'), PA); fs.copyFileSync(path.join(__dirname, '../work/pdf-align/same.pdf'), PB);
  ({ app, win, errs } = await launch(cfg, [PA, PB]));
  await sleep(3000);
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[3].click()); await sleep(2500);
  await clickText(win, '.seg button', '淡化'); await sleep(400);
  const s0 = await win.evaluate(() => +document.querySelector('.sld').value);
  await win.focus('.sld'); await win.keyboard.press('ArrowRight'); await sleep(150);
  const s1 = await win.evaluate(() => ({ v: +document.querySelector('.sld').value, vt: document.querySelector('.sld').getAttribute('aria-valuetext') }));
  ok('fade Slider: → moves 5%, aria-valuetext says the value', s1.v === s0 + 5 && /淡化 \d+%/.test(s1.vt), { s0, s1 });
  await win.evaluate(() => [...document.querySelectorAll('.sel-t')].find((b) => b.getAttribute('aria-label') === '缩放').click()); await sleep(300);
  await clickText(win, '.sel-pop [role=option]', '^150%$'); await sleep(300);
  ok('zoom Select: picking 150% applies', await win.evaluate(() => /150%/.test([...document.querySelectorAll('.sel-t')].find((b) => b.getAttribute('aria-label') === '缩放').innerText)));
  ok('image mode: no native controls', (await natives(win)).length === 0, await natives(win));
  await shot(win, '04-image-fade');
  await app.close();

  // ---------- G6：启动时“上次有决定没写进审阅稿”可以不再提示 ----------
  const pend = { 'draft-pending': { 'x|y': { name: 'Document B-我方意见.docx', behind: 1, at: Date.now(), s: 'gone', path: path.join(dir, 'gone.docx') } } };
  cfg = newCfg(pend);
  ({ app, win } = await launch(cfg));
  await win.waitForSelector('.behind-dlg', { timeout: 15000 });
  const g6 = await win.evaluate(() => ({ cb: !!document.querySelector('.behind-dlg .cbx'), on: document.querySelector('.behind-dlg .cbx')?.classList.contains('on'), t: document.querySelector('.behind-dlg .cbx-t')?.textContent }));
  ok('startup dialog has an unchecked “以后启动时不再提示”', g6.cb && !g6.on && /以后启动时不再提示/.test(g6.t), g6);
  await shot(win, '05-startup-mute');
  await app.close();
  ({ app, win } = await launch(cfg));
  ok('without ticking it, it shows again next start', await win.waitForSelector('.behind-dlg', { timeout: 15000 }).then(() => true).catch(() => false));
  await win.evaluate(() => document.querySelector('.behind-dlg .cbx-t').click()); await sleep(150);
  await clickText(win, '.behind-dlg .btn', '知道了'); await sleep(500);
  await app.close();
  const st = JSON.parse(fs.readFileSync(path.join(cfg, 'DocDiff', 'settings.json'), 'utf8'));
  ok('ticked: the record stays (still repaired on reopen) but is muted', st['draft-pending']?.['x|y']?.muted === true, st['draft-pending']);
  ({ app, win } = await launch(cfg));
  await win.waitForSelector('.home-cta'); await sleep(1500);
  ok('ticked: not shown at the next start', await win.evaluate(() => !document.querySelector('.behind-dlg')));
  await app.close();

  console.log(fail ? `\n${fail} 项不通过` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
