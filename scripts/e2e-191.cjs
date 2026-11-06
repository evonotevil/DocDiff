// 1.9.1 端到端检查（只用合成夹具 work/review-fixtures/basic-*.docx，文件名一律 Document A / B）：
//  F3 查找、F6 文件片菜单、F1 版本起名 / 删除 / 撤销、F5 首页后台存往来稿、F7 首页布局。
// 用法：APP=<应用目录> xvfb-run -a node scripts/e2e-191.cjs
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const FIX = path.join(__dirname, '../work/review-fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-191-'));
const A = path.join(dir, 'Document A.docx'), B = path.join(dir, 'Document B.docx'), C = path.join(dir, 'Document C.docx');
// 往来稿夹具 neg-V1..V3 当作 Document A / B / C；basic-A / B 当作 Document D / E（首页后台存往来稿用）
fs.copyFileSync(path.join(FIX, 'neg-V1.docx'), A); fs.copyFileSync(path.join(FIX, 'neg-V2.docx'), B); fs.copyFileSync(path.join(FIX, 'neg-V3.docx'), C);
const D = path.join(dir, 'Document D.docx'), E2 = path.join(dir, 'Document E.docx');
fs.copyFileSync(path.join(FIX, 'basic-A.docx'), D); fs.copyFileSync(path.join(FIX, 'basic-B.docx'), E2);
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info) : ''}`); };
const ONLY = process.env.ONLY || '';

(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1360, height: 860 });
  await win.waitForFunction(() => !!document.querySelector('.tb-prog') || !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
  await win.waitForTimeout(600);

  // ---------- F3 查找 ----------
  const word = await win.evaluate(() => {
    const txt = [...document.querySelectorAll('.rich [data-side="a"] .blk')].map((b) => b.textContent).join(' ');
    const ws = (txt.match(/[A-Za-z]{5,}|[一-鿿]{2}/g) || []);
    const cnt = new Map(); ws.forEach((w) => cnt.set(w, (cnt.get(w) || 0) + 1));
    return [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  });
  await win.keyboard.press('Control+f'); await win.waitForTimeout(250);
  ok('Ctrl+F opens the find bar with focus in the input', await win.evaluate(() => document.activeElement?.closest('.findbar') != null));
  await win.keyboard.type(word); await win.waitForTimeout(500);
  const f1 = await win.evaluate(() => ({ n: document.querySelector('.find-n')?.textContent, hl: CSS.highlights.get('dd-find')?.size ?? -1, cur: CSS.highlights.get('dd-find-cur')?.size ?? -1 }));
  const total = Number((f1.n || '').split('/')[1]);
  ok('find counts and highlights matches in both sides', /^1 \/ \d+$/.test(f1.n) && total >= 2 && f1.hl === total - 1 && f1.cur === 1, { word, ...f1 });
  await win.keyboard.press('Enter'); await win.waitForTimeout(200);
  ok('Enter goes to the next match', (await win.evaluate(() => document.querySelector('.find-n')?.textContent)) === `2 / ${total}`);
  await win.keyboard.press('Shift+Enter'); await win.keyboard.press('Shift+Enter'); await win.waitForTimeout(200);
  ok('Shift+Enter goes back and wraps', (await win.evaluate(() => document.querySelector('.find-n')?.textContent)) === `${total} / ${total}`);
  await win.keyboard.press('a'); await win.waitForTimeout(150);
  ok('typing review keys into the find input does not decide', !(await win.$('.dlist .drow.v-a')));
  await win.keyboard.press('Backspace');
  // 换到纯文本：重新搜
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[1].click()); await win.waitForTimeout(900);
  const f2 = await win.evaluate(() => ({ open: !!document.querySelector('.findbar'), n: document.querySelector('.find-n')?.textContent }));
  ok('find stays open and re-searches in Plain text', f2.open && /\/ \d+$/.test(f2.n || ''), f2);
  await win.evaluate(() => { const i = document.querySelector('.find-in input'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, 'zzqxj-nothing'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await win.waitForTimeout(400);
  ok('no match shows "没有找到"', await win.evaluate(() => document.querySelector('.findbar.miss .find-n')?.textContent === '没有找到'));
  await win.evaluate(() => document.querySelector('.find-in input').focus());
  await win.keyboard.press('Escape'); await win.waitForTimeout(200);
  ok('Esc closes the find bar and clears highlights', await win.evaluate(() => !document.querySelector('.findbar') && !CSS.highlights.get('dd-find')));
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[5].click()); await win.waitForTimeout(500);
  await win.keyboard.press('Control+f'); await win.waitForTimeout(200);
  ok('Ctrl+F does nothing in File info', !(await win.$('.findbar')));
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[0].click()); await win.waitForTimeout(700);

  if (ONLY === 'find') { ok('no page errors', !errs.length, { errs }); await app.close(); process.exit(fail ? 1 : 0); }
  const text = (sel) => win.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
  const clickText = (sel, re) => win.evaluate(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); b?.click(); return !!b; }, [sel, re]);
  const pickNext = (p) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, p);

  // ---------- F6 文件片菜单 ----------
  await win.evaluate(() => document.querySelector('.filechip').click()); await win.waitForTimeout(250);
  const items = await win.evaluate(() => [...document.querySelectorAll('.filechip-menu .menu-item')].map((b) => b.textContent));
  ok('file chip opens a menu: 换一个文件… / 存为往来稿', items.join('|') === '换一个文件…|存为往来稿', { items });
  await clickText('.filechip-menu .menu-item', '存为往来稿');
  await win.waitForSelector('.ver-chip', { timeout: 10000 }).catch(() => {});
  ok('save as negotiation from the file chip (Formatted mode, no review needed)', /V1\s*→\s*V2/.test(await text('.ver-chip')));

  // ---------- F1 版本起名、删除、撤销 ----------
  await win.evaluate(() => document.querySelector('.ver-chip').click()); await win.waitForTimeout(200);
  await clickText('.ver-pop .btn', '加入新版本');
  await win.waitForSelector('.tpl-dlg');
  await pickNext(C);
  await win.evaluate(() => document.querySelector('.tpl-dlg .dlg-drop').click()); await win.waitForTimeout(500);
  await clickText('.tpl-dlg .btn', '加入并比较');
  await win.waitForFunction(() => /V2\s*→\s*V3/.test(document.querySelector('.ver-chip')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
  ok('V3 added', /V2\s*→\s*V3/.test(await text('.ver-chip')));
  await win.waitForTimeout(500);
  const openMenu = async (i) => {
    if (!(await win.$('.ver-pop'))) { await win.evaluate(() => document.querySelector('.ver-chip').click()); await win.waitForTimeout(250); }
    await win.hover(`.ver-list .ver-item:nth-child(${i + 1})`); await win.waitForTimeout(200);
    await win.evaluate((i) => document.querySelectorAll('.ver-list .ver-item')[i].querySelector('.ver-more').click(), i); await win.waitForTimeout(250);
  };
  await openMenu(1);
  ok('“…” menu on a version row: 起名… / 删除这一版', /起名…/.test(await text('.pop-menu')) && /删除这一版/.test(await text('.pop-menu')));
  await clickText('.pop-menu .menu-item', '起名');
  await win.waitForSelector('.ver-label');
  await win.keyboard.type('对方第一次修改'); await win.keyboard.press('Enter'); await win.waitForTimeout(400);
  const rows1 = await win.evaluate(() => [...document.querySelectorAll('.ver-list .ver-row')].map((r) => r.innerText.replace(/\s+/g, ' ')));
  ok('named version shows “V2 对方 对方第一次修改”, the popover stays open', /^V2 对方 对方第一次修改/.test(rows1[1] || '') && !!(await win.$('.ver-pop')), { rows1 });
  ok('toolbar chip still reads V2 → V3, the name is in the tooltip', /V2\s*→\s*V3/.test(await text('.ver-chip')) && /V2 · 对方第一次修改/.test(await win.evaluate(() => document.querySelector('.ver-chip').title)));
  // Esc 取消起名，不关闭弹出层
  await openMenu(2); await clickText('.pop-menu .menu-item', '起名'); await win.waitForSelector('.ver-label');
  await win.keyboard.type('xx'); await win.keyboard.press('Escape'); await win.waitForTimeout(250);
  ok('Esc cancels naming and keeps the version list open', !!(await win.$('.ver-pop')) && !(await win.$('.ver-label')) && !/xx/.test(await text('.ver-list')));
  // 删除正在比的 V2：重新编号，回到最新两版
  await openMenu(1); await clickText('.pop-menu .menu-item', '删除这一版'); await win.waitForTimeout(1500);
  ok('delete V2: toast says later versions were renumbered', /已删除 V2，后面的版本已重新编号/.test(await text('.toast.undo')));
  ok('the pair in use is gone: now V1 → V2 (the old V3)', /V1\s*→\s*V2/.test(await text('.ver-chip')));
  await win.evaluate(() => document.querySelector('.ver-chip').click()); await win.waitForTimeout(250);
  const rows2 = await win.evaluate(() => [...document.querySelectorAll('.ver-list .ver-row')].map((r) => r.innerText.replace(/\s+/g, ' ')));
  ok('renumbered: V1, V2 (was V3)', rows2.length === 2 && /C\.docx/.test(rows2[1].replace(/\s/g, "")), { rows2 });
  await win.keyboard.press('Escape'); await win.waitForTimeout(200);
  await win.keyboard.press('u'); await win.waitForTimeout(1500);
  ok('U undoes the delete (works on the compare page)', /V2\s*→\s*V3/.test(await text('.ver-chip')));
  await win.evaluate(() => document.querySelector('.ver-chip').click()); await win.waitForTimeout(250);
  ok('undo restores the name too', /对方第一次修改/.test(await text('.ver-list')));
  // 删到只剩两版：菜单里的删除置灰
  await openMenu(0); await clickText('.pop-menu .menu-item', '删除这一版'); await win.waitForTimeout(1500);
  await openMenu(0);
  ok('with two versions left “删除这一版” is disabled', await win.evaluate(() => [...document.querySelectorAll('.pop-menu .menu-item')].find((b) => /删除这一版/.test(b.textContent))?.disabled === true));
  await win.keyboard.press('Escape'); await win.keyboard.press('Escape'); await win.waitForTimeout(200);

  // ---------- F5 首页存为往来稿：留在首页 ----------
  await win.evaluate(() => document.querySelector('.toast.undo .toast-x')?.click());
  await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click()); await win.waitForTimeout(600);
  for (const [i, f] of [[0, D], [1, E2]]) { await pickNext(f); await win.evaluate((i) => [...document.querySelectorAll('.drops .drop')][i].querySelector('button').click(), i); await win.waitForTimeout(1000); }
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => !!document.querySelector('.tb-pos') || !!document.querySelector('.tb-prog'), null, { timeout: 60000 });
  await win.waitForTimeout(600);
  await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click()); await win.waitForTimeout(800);
  ok('home: first visit defaults to the 最近比较 tab', await win.evaluate(() => document.querySelector('.mod-tabs button[aria-selected="true"]')?.textContent.startsWith('最近比较')));
  const before = await win.evaluate(() => Number(document.querySelectorAll('.mod-tabs button')[1].querySelector('.cnt').textContent));
  const ri = await win.evaluate(() => [...document.querySelectorAll('.recent-row')].findIndex((r) => /Document D|Document E|Document/.test(r.querySelector('.row-open').title) && /D\.docx/.test(r.querySelector('.row-open').title)));
  await win.evaluate((i) => document.querySelectorAll('.recent-row')[i].querySelector('.btn.icon').click(), ri); await win.waitForTimeout(200);
  await clickText('.pop-menu .menu-item', '存为往来稿');
  const saw = await win.waitForSelector('.recent-row.saving', { timeout: 3000 }).then(() => true).catch(() => false);
  await win.waitForFunction(() => /已存为往来稿/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  ok('stays on home, shows a toast, no comparison opened', !!(await win.$('.home')) && !(await win.$('.tb-pos')) && /已存为往来稿/.test(await text('.toast')), { saw });
  const after = await win.evaluate(() => Number(document.querySelectorAll('.mod-tabs button')[1].querySelector('.cnt').textContent));
  ok('the negotiation count went up by one', after === before + 1, { before, after });

  // ---------- F7 首页：整页不滚动，卡片里滚 ----------
  const lay = await win.evaluate(() => { const s = document.querySelector('.home-scroll'); const tp = document.querySelector('.mod-tpl'); return { fit: document.querySelector('.home').classList.contains('fit'), scroll: s.scrollHeight - s.clientHeight, card: tp.getBoundingClientRect().bottom, foot: document.querySelector('.home-cta').getBoundingClientRect().top }; });
  ok('home fits the window (no page scroll), cards end above the footer', lay.fit && lay.scroll <= 1 && lay.card < lay.foot, lay);
  await win.hover('.mod-tpl .mod-h'); await win.waitForTimeout(300);
  ok('hovering a module turns its border to the module colour (Fox)', await win.evaluate(() => getComputedStyle(document.querySelector('.mod-tpl')).borderTopColor === 'rgb(255, 150, 0)'));
  await win.setViewportSize({ width: 1360, height: 560 }); await win.waitForTimeout(300);
  ok('short window falls back to page scroll; cards keep 3 rows', await win.evaluate(() => { const s = document.querySelector('.home-scroll'); return s.scrollHeight > s.clientHeight && document.querySelector('.mod-lib').getBoundingClientRect().height >= 230; }));
  await win.setViewportSize({ width: 1360, height: 860 });

  ok('no page errors', !errs.length, { errs });
  await app.close();
  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
