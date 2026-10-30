// 1.8 界面截图 + 检查（只用合成夹具，含 beta.7 的全部检查）：xvfb-run -a node scripts/shots-18.cjs <输出目录>
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(R, 'work', 'shots18');
fs.mkdirSync(OUT, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-s7-'));
const F = (n) => path.join(dir, `供货框架协议-${n}.docx`);
for (const n of ['V1', 'V2', 'V3']) fs.copyFileSync(path.join(R, 'work/review-fixtures', `neg-${n}.docx`), F(n));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-c7-'));
const checks = [];
const ok = (k, v, info) => { checks.push([k, !!v]); console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info) : ''}`); };
const drafts = () => fs.readdirSync(dir).filter((f) => /我方意见/.test(f));
const launch = async (args) => {
  const app = await _electron.launch({ executablePath: path.join(R, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--lang=zh-CN', R, ...args], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; shell.openPath = async () => ''; });
  const w = await app.firstWindow(); w.errs = []; w.on('pageerror', (e) => w.errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 });
  return { app, w };
};
(async () => {
  // ---------- H2：第一次用 ----------
  let { app, w } = await launch([]);
  const shot = async (n, sel) => { await w.waitForTimeout(350); if (sel) { const el = await w.$(sel); if (el) return el.screenshot({ path: path.join(OUT, n + '.png') }); } await w.screenshot({ path: path.join(OUT, n + '.png') }); };
  await w.waitForSelector('.drops');
  ok('first run: full hero, no mode icons / bubble, one-line intro instead of empty cards', await w.evaluate(() => !!document.querySelector('.hero h1') && !document.querySelector('.feats') && !document.querySelector('.bubble') && !!document.querySelector('.home-intro') && !document.querySelector('.lib-cols')));
  await shot('h2-first-run');
  await app.close();

  // ---------- 修订审阅：手动开始 ----------
  ({ app, w } = await launch([F('V1'), F('V2')]));
  await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
  await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await w.waitForTimeout(500);
  await w.evaluate(() => { const i = document.querySelector('.reviewer-ask input'); if (i) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '甲'); i.dispatchEvent(new Event('input', { bubbles: true })); } });
  await w.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click());
  await w.evaluate(() => document.querySelector('.dlist .drow')?.click()); await w.keyboard.press('r'); await w.waitForTimeout(1200);
  ok('deciding alone writes no draft (manual start)', drafts().length === 0, drafts());
  ok('toolbar shows “生成审阅稿” before starting', await w.evaluate(() => /生成审阅稿/.test(document.querySelector('.tb-start')?.textContent || '')));
  await shot('e1-toolbar', 'header.tbar');
  await w.evaluate(() => document.querySelector('.tb-start').click()); await w.waitForTimeout(1500);
  ok('“生成审阅稿” writes the draft once', drafts().length === 1, drafts());
  const tip = await w.evaluate(() => document.querySelector('.draft-tip')?.innerText || '');
  ok('E2 tip: 审阅稿已生成 + count of decisions written', /审阅稿已生成/.test(tip) && /1 个决定/.test(tip), tip.replace(/\s+/g, ' '));
  await shot('e2-tip');
  await w.evaluate(() => [...document.querySelectorAll('.draft-tip .btn')].find((b) => /知道了/.test(b.textContent))?.click());
  // P1-2：定稿弹窗开着时，菜单命令（⌘1 / ⌘N）不作用到后台
  await w.evaluate(() => document.querySelector('.insp .sh .ibtn, .sh .ibtn.act')?.click()); await w.waitForTimeout(200);
  ok('review “…” menu offers 生成定稿…', await w.evaluate(() => [...document.querySelectorAll('.pop.menu .menu-item')].some((b) => /生成定稿/.test(b.textContent))));
  await shot('f1-review-menu');
  await w.evaluate(() => [...document.querySelectorAll('.pop.menu .menu-item')].find((b) => /生成定稿/.test(b.textContent)).click()); await w.waitForTimeout(300);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.webContents.send('menu', 'tab', 0); win.webContents.send('menu', 'clear'); });
  await w.waitForTimeout(500);
  const guard = await w.evaluate(() => ({ modal: !!document.querySelector('.final-dlg'), review: !!document.querySelector('.nav-list .nav-item.on, .nav-list .nav-item[aria-current]') && /修订审阅/.test(document.querySelector('.nav-list .nav-item.on, .nav-list .nav-item[aria-current]')?.textContent || ''), compared: !!document.querySelector('.tb-pos') }));
  ok('menu commands are ignored while the final dialog is open (P1-2)', guard.modal && guard.compared && guard.review, guard);
  await shot('d2-final-dialog', '.modal');
  await w.keyboard.press('Escape'); await w.waitForTimeout(300);
  // 全部接受 → 完成页（D1 · 已写好）
  await w.evaluate(() => document.querySelector('.insp .sh .ibtn, .sh .ibtn.act')?.click()); await w.waitForTimeout(200);
  await w.evaluate(() => [...document.querySelectorAll('.pop.menu .menu-item')].find((b) => /全部接受/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.evaluate(() => [...document.querySelectorAll('.modal .btn')].find((b) => /接受/.test(b.textContent) && /primary/.test(b.className))?.click());
  await w.waitForSelector('.done-card', { timeout: 10000 }).catch(() => {});
  await w.waitForTimeout(1500);
  const d1 = await w.evaluate(() => document.querySelector('.done-card')?.innerText || '');
  ok('D1: draft written → “要发给对方的就是这份” + 打开审阅稿', /要发给对方的就是这份/.test(d1) && /打开审阅稿/.test(d1), d1.replace(/\s+/g, ' ').slice(0, 160));
  await shot('d1-done', '.done-card');
  // R2：打开审阅稿后完成页留着；Word 打开着（都写好）不算没写完
  await w.evaluate(() => [...document.querySelectorAll('.done-card .btn')].find((b) => /打开审阅稿/.test(b.textContent))?.click()); await w.waitForTimeout(400);
  ok('R2: “打开审阅稿” keeps the completion page open', !!(await w.$('.done-card')));
  const lockF = path.join(dir, '~$' + drafts()[0].slice(2)); fs.writeFileSync(lockF, 'x');
  await w.evaluate(() => window.dispatchEvent(new Event('focus'))); await w.waitForTimeout(800);
  const r2 = await w.evaluate(() => ({ done: document.querySelector('.done-card')?.innerText || '', chip: document.querySelector('.draft-chip')?.getAttribute('aria-label') || '' }));
  ok('R2: Word open with everything written → still “ready”, chip not warning', /要发给对方的就是这份/.test(r2.done) && !/Word 正在用/.test(r2.chip), { chip: r2.chip });
  fs.unlinkSync(lockF); await w.evaluate(() => window.dispatchEvent(new Event('focus'))); await w.waitForTimeout(400);
  await w.evaluate(() => [...document.querySelectorAll('.done-card .btn')].find((b) => /生成定稿/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.evaluate(() => [...document.querySelectorAll('.final-dlg .btn')].find((b) => /^生成定稿$/.test(b.textContent.trim()))?.click()); await w.waitForTimeout(1500);
  const d1f = await w.evaluate(() => document.querySelector('.done-card')?.innerText || '');
  ok('after generating the final, back on the completion page with the final listed', /定稿已生成/.test(d1f), d1f.replace(/\s+/g, ' ').slice(0, 200));
  const fit = await w.evaluate(() => { const c = document.querySelector('.done-card').getBoundingClientRect(), f = document.querySelector('.done-final'); const r = f.getBoundingClientRect(); return { inside: r.left >= c.left && r.right <= c.right, noScroll: f.scrollWidth <= f.clientWidth + 1 }; });
  ok('R3: “定稿已生成” stays inside the card', fit.inside && fit.noScroll, fit);
  await shot('d1-done-final', '.done-card');
  await w.evaluate(() => [...document.querySelectorAll('.done-card .btn')].find((b) => /回去再看看/.test(b.textContent))?.click()); await w.waitForTimeout(200);
  // P2-3：离开修订审阅后，删掉审阅稿、切回窗口，不应重建
  await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[0].click()); await w.waitForTimeout(400);
  for (const f of drafts()) fs.unlinkSync(path.join(dir, f));
  await w.evaluate(() => window.dispatchEvent(new Event('focus'))); await w.waitForTimeout(1500);
  ok('outside review mode, focus does not rebuild the draft (P2-3)', drafts().length === 0, drafts());
  await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await w.waitForTimeout(2000);
  ok('back in review mode, the missing draft is rebuilt (setting = auto)', drafts().length === 1, drafts());
  const toast = await w.evaluate(() => [...document.querySelectorAll('.toast, .flash, [role=status]')].map((x) => x.innerText).join(' | '));
  ok('rebuild notice names the scope (E5)', /按 DocDiff 里的决定/.test(toast), toast);
  // R4：用过“生成定稿…”之后换成新的一对文件，不应再弹定稿
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, F('V3'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'open-right'));
  await w.waitForTimeout(3000);
  await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2]?.click()); await w.waitForTimeout(1500);
  ok('R4: switching to a new pair does not reopen the final dialog', !(await w.$('.final-dlg')) && !!(await w.$('.tb-start')));
  ok('no renderer errors (review)', w.errs.length === 0, w.errs.slice(0, 3));
  await app.close();

  // ---------- E3：新一轮没开始审阅稿时的完成页 ----------
  ({ app, w } = await launch([F('V1'), F('V3')]));
  await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
  await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await w.waitForTimeout(600);
  await w.evaluate(() => document.querySelector('.insp .sh .ibtn, .sh .ibtn.act')?.click()); await w.waitForTimeout(200);
  await w.evaluate(() => [...document.querySelectorAll('.pop.menu .menu-item')].find((b) => /全部接受/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.evaluate(() => [...document.querySelectorAll('.modal .btn')].find((b) => /接受/.test(b.textContent) && /primary/.test(b.className))?.click());
  await w.waitForSelector('.done-card', { timeout: 10000 }).catch(() => {});
  await w.evaluate(() => [...document.querySelectorAll('.done-card .btn')].find((b) => /回去再看看/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.evaluate(() => document.querySelector('.dlist .drow')?.click()); await w.waitForTimeout(200); await w.keyboard.press('h');
  await w.waitForSelector('.done-card', { timeout: 10000 }).catch(() => {});
  await w.waitForTimeout(800);
  const e3 = await w.evaluate(() => document.querySelector('.done-card')?.innerText || '');
  ok('E3: no draft yet → info + 生成审阅稿, does not claim it is sendable', /结论目前只记在 DocDiff 里/.test(e3) && /生成审阅稿/.test(e3) && !/要发给对方的就是这份/.test(e3), e3.replace(/\s+/g, ' ').slice(0, 200));
  ok('completion subtitle: 已看完 N 处修订，M 处待议', /已看完 \d+ 处修订，\d+ 处待议/.test(e3));
  await shot('e3-done', '.done-card');
  const before = drafts().length;
  await w.evaluate(() => [...document.querySelectorAll('.done-card .btn')].find((b) => /生成审阅稿/.test(b.textContent))?.click()); await w.waitForTimeout(1800);
  const e3b = await w.evaluate(() => document.querySelector('.done-card')?.innerText || '');
  ok('E3 → D1 in place after 生成审阅稿', drafts().length === before + 1 && /待议已写成批注/.test(e3b), e3b.replace(/\s+/g, ' ').slice(0, 200));
  await shot('e3-done-after', '.done-card');
  await w.evaluate(() => [...document.querySelectorAll('.done-card .btn')].find((b) => /回去再看看/.test(b.textContent))?.click());
  // 设置三页
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')].find((b) => /设置/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  for (const [k, n] of [['审阅', 's-review'], ['审阅稿与定稿', 's-files'], ['存储', 's-storage']]) {
    await w.evaluate((k) => [...document.querySelectorAll('.set-tabs button')].find((b) => b.textContent.trim() === k)?.click(), k); await w.waitForTimeout(300);
    const fits = await w.evaluate(() => { const p = document.querySelector('.set-pane'); return p.scrollHeight <= p.clientHeight + 2; });
    ok(`settings · ${k} fits without scrolling`, fits);
    await shot(n, '.modal');
  }
  await w.hover('.set-sh .qtip'); await shot('s-files-info', '.modal');
  await w.keyboard.press('Escape'); await w.waitForTimeout(200);
  // ---------- H：老用户首页 + 最近比较菜单 ----------
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click());
  await w.waitForSelector('.recent-row', { timeout: 15000 });
  ok('veteran home: compact drops, no hero', await w.evaluate(() => !document.querySelector('.hero') && document.querySelectorAll('.drop.compact').length === 2 && document.querySelector('.drop.compact').getBoundingClientRect().height <= 100));
  await shot('h-veteran');
  const rr = await w.evaluate(() => [...document.querySelectorAll('.recent-row')].map((r) => ({ name: r.querySelector('.rr-name')?.innerText, diff: r.querySelector('.rr-diff')?.innerText.replace(/\s+/g, ' '), st: r.querySelector('.rr-st')?.innerText, more: (() => { const a = r.getBoundingClientRect(), b = r.querySelector('.btn.icon').getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) <= 1.5; })() })));
  ok('R1: recent rows show the shared name once and what differs, … centred', rr.length >= 2 && rr.every((x) => x.name && x.diff && x.more) && new Set(rr.map((x) => x.diff)).size === rr.length, rr);
  await shot('r1-recent', '.lib-card');
  const rows = await w.$$('.recent-row');
  const last = rows[rows.length - 1];
  await last.scrollIntoViewIfNeeded();
  await w.setViewportSize({ width: 1440, height: 640 }); await w.waitForTimeout(300);
  const btn = await last.$('.btn.icon'); await btn.scrollIntoViewIfNeeded(); await btn.click(); await w.waitForTimeout(300);
  const pos = await w.evaluate(() => { const p = document.querySelector('.pop.menu'); const pr = p.getBoundingClientRect(); const b = [...document.querySelectorAll('.recent-row .btn.icon')].pop().getBoundingClientRect(); const first = p.querySelector('.menu-item').getBoundingClientRect(); return { gapBelowAnchor: Math.round(pr.top - b.bottom), gapAboveAnchor: Math.round(b.top - pr.bottom), firstPad: Math.round(first.top - pr.top) }; });
  ok('recent-row menu sits next to its button (8px) and the first item is inset', (Math.abs(pos.gapAboveAnchor - 8) <= 2 || Math.abs(pos.gapBelowAnchor - 8) <= 2) && pos.firstPad >= 8, pos);
  await shot('f1-recent-menu');
  await w.evaluate(() => [...document.querySelectorAll('.pop.menu .menu-item')].find((b) => /存为往来稿/.test(b.textContent))?.click()); await w.waitForTimeout(1500);
  ok('menu item click does not also open the row underneath twice (no error)', w.errs.length === 0, w.errs.slice(0, 3));
  await app.close();
  console.log(JSON.stringify({ out: OUT, pass: checks.filter((c) => c[1]).length, fail: checks.filter((c) => !c[1]).map((c) => c[0]) }));
  process.exit(checks.every((c) => c[1]) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
