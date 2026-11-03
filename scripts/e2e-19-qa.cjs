// 1.9 · 1.8.1 QA 修复的端到端检查（只用合成夹具 work/review-fixtures/basic-*.docx）：
//  撤销提示的作用范围（批量后单步决定、交换左右、首页删除进审阅）、连按不重复作用、
//  弹出菜单跟随滚动 / 滚出可视区关闭 / 缩放原点、长名称悬停、提示悬停暂停。
// 用法：APP=<应用目录> xvfb-run -a node scripts/e2e-19-qa.cjs
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const FIX = path.join(__dirname, '../work/review-fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-qa19-'));
const A = path.join(dir, 'Document A.docx'), B = path.join(dir, 'Document B.docx');
fs.copyFileSync(path.join(FIX, 'basic-A.docx'), A); fs.copyFileSync(path.join(FIX, 'basic-B.docx'), B);
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info) : ''}`); };

(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1360, height: 860 });
  await win.waitForFunction(() => !!document.querySelector('.tb-prog') || !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await win.waitForTimeout(500);
  await win.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click());
  await win.waitForTimeout(300);
  const state = () => win.evaluate(() => [...document.querySelectorAll('.dlist .drow')].map((r) => (r.className.match(/v-(\w)/) || [])[1] || '-').join(''));
  const sel = () => win.evaluate(() => [...document.querySelectorAll('.dlist .drow')].findIndex((r) => r.classList.contains('sel')));
  const bulk = async (re) => {
    await win.evaluate(() => document.querySelector('.ibtn.sm.act[aria-haspopup], .ibtn.sm.act')?.click()); await win.waitForTimeout(200);
    await win.evaluate((r) => [...document.querySelectorAll('.pop .menu-item')].find((b) => new RegExp(r).test(b.textContent))?.click(), re); await win.waitForTimeout(200);
    await win.evaluate(() => document.querySelector('.bulk-ask .btn.primary, .bulk-ask .btn.red, .bulk-ask .btn.danger')?.click()); await win.waitForTimeout(300);
  };
  const n = (await state()).length;
  ok('has changes to review', n >= 4, { n });

  // 1) 批量后做单步决定：撤销提示收起，U 只撤销刚才那一步
  await bulk('全部接受');
  ok('bulk accept shows undo toast', !!(await win.$('.toast.undo')));
  await win.evaluate(() => document.querySelectorAll('.dlist .drow')[1].click()); await win.waitForTimeout(150);
  await win.keyboard.press('r'); await win.waitForTimeout(350);
  ok('single decision after bulk dismisses the bulk undo toast', !(await win.$('.toast.undo')));
  const afterR = await state();
  await win.keyboard.press('u'); await win.waitForTimeout(300);
  const afterU = await state();
  ok('U undoes only the single decision, bulk stays', afterR[1] === 'r' && afterU[1] === '-' && afterU.replace(/-/g, '').length === n - 1, { afterR, afterU });

  // 2) 批量后交换左右，再按 U：不能把上一对文件的结论写进来
  await bulk('全部拒绝');
  await win.evaluate(() => document.querySelector('button.ibtn[aria-label="交换左右"]')?.click()); await win.waitForTimeout(2500);
  ok('swap dismisses the bulk undo toast', !(await win.$('.toast.undo')));
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await win.waitForTimeout(500);
  const swapped = await state();
  await win.keyboard.press('u'); await win.waitForTimeout(300);
  ok('U after swap does not restore the previous pair’s decisions', !/r/.test(await state()) && !/r/.test(swapped), { swapped, after: await state() });
  await win.evaluate(() => document.querySelector('button.ibtn[aria-label="交换左右"]')?.click()); await win.waitForTimeout(2500);
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await win.waitForTimeout(500);

  // 3) 连按：220ms 内连按两次 A，作用在两处，不重复作用在同一处
  await bulk('全部拒绝'); await win.keyboard.press('Escape');
  await win.evaluate(() => document.querySelector('.toast.undo .toast-x')?.click());
  // 先清空：用“清空结论”不在菜单里时，逐个撤销
  for (let i = 0; i < n + 2; i++) { await win.keyboard.press('u'); await win.waitForTimeout(60); }
  await win.evaluate(() => document.querySelectorAll('.dlist .drow')[0].click()); await win.waitForTimeout(150);
  const before = await state();
  await win.keyboard.press('a'); await win.waitForTimeout(60); await win.keyboard.press('a'); await win.waitForTimeout(500);
  const fast = await state();
  ok('two fast A presses decide two different changes', fast.split('').filter((x) => x === 'a').length === before.split('').filter((x) => x === 'a').length + 2, { before, fast, sel: await sel() });

  // 4) 弹出菜单：缩放原点跟对齐方式，向上弹出时从下沿长出来
  await win.evaluate(() => document.querySelector('.ibtn.sm.act')?.click()); await win.waitForTimeout(150);
  const origin = await win.evaluate(() => { const p = document.querySelector('.pop.pop-menu'); return p ? p.style.transformOrigin : ''; });
  ok('menu popover has a corner transform-origin', /top|bottom/.test(origin) && /right|left/.test(origin), { origin });
  await win.keyboard.press('Escape'); await win.waitForTimeout(150);

  // 5) 提示悬停暂停：停在撤销提示上 11 秒，提示还在，撤销仍可用
  await bulk('全部接受');
  const box = await (await win.$('.toast.undo')).boundingBox();
  await win.mouse.move(box.x + 10, box.y + box.height / 2);
  await win.waitForTimeout(11000);
  ok('undo toast stays while hovered', !!(await win.$('.toast.undo')));
  await win.mouse.move(5, 5);
  await win.waitForTimeout(10500); // 暂停保留剩下的时间（约 10 秒），离开后走完
  ok('undo toast leaves after the pointer moves away', !(await win.$('.toast.undo')));

  // 6) 首页：删除往来稿 / 模板的提示进了比较页，U 不触发它；首页弹出菜单跟随滚动
  //    （这一对文件存成模板，再在首页删掉）
  await win.evaluate(() => document.querySelector('.insp .sh .ibtn, .sh .ibtn.act')?.click()); await win.waitForTimeout(200);
  const savedTpl = await win.evaluate(() => { const b = [...document.querySelectorAll('.pop .menu-item')].find((x) => /存为往来稿/.test(x.textContent)); b?.click(); return !!b; });
  await win.waitForTimeout(1200);
  await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click());
  await win.waitForSelector('.lib-row', { timeout: 15000 }).catch(() => {});
  const titles = await win.evaluate(() => [...document.querySelectorAll('.lib-row .row-open')].map((b) => !!b.title));
  ok('every library row-open has a title for the full name', titles.length > 0 && titles.every(Boolean), { titles });
  if (savedTpl) {
    await win.evaluate(() => [...document.querySelectorAll('.lib-row')].find((r) => /往来稿/.test(r.querySelector('.row-open')?.getAttribute('aria-label') || ''))?.querySelector('button[aria-label="更多"]')?.click()); await win.waitForTimeout(200);
    const scroll = await win.evaluate(async () => {
      const pop = document.querySelector('.pop'); if (!pop) return null;
      const t0 = pop.getBoundingClientRect().top;
      const sc = document.querySelector('.home-scroll'); const spacer = document.createElement('div'); spacer.style.height = '2000px'; sc.appendChild(spacer);
      sc.scrollTop = 40; await new Promise((r) => setTimeout(r, 120));
      const p2 = document.querySelector('.pop'); const t1 = p2 ? p2.getBoundingClientRect().top : null;
      sc.scrollTop = 1600; await new Promise((r) => setTimeout(r, 120));
      const closed = !document.querySelector('.pop');
      sc.scrollTop = 0; spacer.remove();
      return { t0, t1, closed };
    });
    ok('home popover follows scroll and closes when its button scrolls away', scroll && scroll.t1 !== null && Math.abs(scroll.t0 - 40 - scroll.t1) < 3 && scroll.closed, scroll);
    await win.keyboard.press('Escape');
    await win.evaluate(() => [...document.querySelectorAll('.lib-row')].find((r) => /往来稿/.test(r.querySelector('.row-open')?.getAttribute('aria-label') || ''))?.querySelector('button[aria-label="更多"]')?.click()); await win.waitForTimeout(200);
    const del = await win.evaluate(() => { const b = [...document.querySelectorAll('.pop .menu-item')].find((x) => /删除/.test(x.textContent)); b?.click(); return !!b; });
    await win.waitForTimeout(300);
    ok('home delete shows undo toast', del && !!(await win.$('.toast.undo')));
    // 立刻进比较页（最近比较里点开），在审阅里按 U
    await win.evaluate(() => [...document.querySelectorAll('.lib-row .row-open')].find((b) => /打开比较/.test(b.getAttribute('aria-label') || ''))?.click());
    await win.waitForFunction(() => !!document.querySelector('.tb-pos') || !!document.querySelector('.tb-prog'), null, { timeout: 30000 }).catch(() => {});
    await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await win.waitForTimeout(400);
    const homeLeft = await win.evaluate(() => document.querySelectorAll('.lib-row').length);
    await win.keyboard.press('u'); await win.waitForTimeout(300);
    ok('home undo toast still shown in review, but U does not restore the deletion', !!(await win.$('.toast.undo')) && !/已撤销删除/.test(await win.evaluate(() => document.querySelector('.toast:not(.undo)')?.innerText || '')), { homeLeft });
  } else ok('saved as negotiation for the home checks', false);

  ok('no page errors', !errs.length, { errs });
  await app.close();
  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
