// 1.7.3 回归测试。用法：xvfb-run node scripts/e2e-173.cjs [image|bulk|storage|migrate|keyboard|all]
// 需要 /home/claude/samples 下的 合同_v1/v2.docx、big_A.pdf（450 页）、big_B.pdf（452 页，第 5、320、448 页有改动）
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = path.join(__dirname, '../node_modules/electron/dist/electron');
const S = process.env.SAMPLES || '/home/claude/samples';
const which = process.argv[2] || 'all';
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

async function launch(cfg, files, env = {}) {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', path.join(__dirname, '..'), ...files], env: { ...process.env, XDG_CONFIG_HOME: cfg, ...env } });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 });
  return { app, win, errs };
}
const newCfg = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dd173-'));
const nav = (win, i) => win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i);
const waitFor = async (win, fn, arg, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await win.evaluate(fn, arg)) return true; await win.waitForTimeout(250); } return false; };
const reviewCounts = (win) => win.evaluate(() => {
  const ix = window.api.reviewIndex(); const out = {};
  for (const pk of Object.keys(ix)) { const st = window.api.reviewGet(pk); const c = { a: 0, r: 0, h: 0 }; for (const d of Object.values(st?.recs || {})) if (d.v) c[d.v]++; out[pk] = c; }
  return out;
});

async function testImage() {
  console.log('--- 图像模式：450 / 452 页');
  const cfg = newCfg();
  const { app, win, errs } = await launch(cfg, [`${S}/big_A.pdf`, `${S}/big_B.pdf`]);
  await win.waitForSelector('.tbar', { state: 'attached', timeout: 120000 });
  await nav(win, 3);
  ok(await waitFor(win, () => !!document.querySelector('.range-gate'), null, 120000), '超过 300 页时先出现页码范围确认');
  const gateText = await win.evaluate(() => document.querySelector('.range-gate')?.innerText || '');
  ok(/452/.test(gateText) && /450/.test(gateText), `确认里写清两份的页数：${gateText.replace(/\s+/g, ' ').slice(0, 80)}`);
  // 先只比 301–330
  await win.fill('.range-gate input[aria-label="起始页"]', '301');
  await win.fill('.range-gate input[aria-label="结束页"]', '330');
  await win.click('.range-gate .gate-range button[type=submit]');
  ok(await waitFor(win, () => document.querySelectorAll('.pagepair').length === 30 && !document.querySelector('.imgview .spinner'), null, 120000), '范围 301–330：正好 30 对页');
  const labels = await win.evaluate(() => [...document.querySelectorAll('.pagepair .ptitle span:first-child')].map((x) => x.textContent));
  ok(labels[0] === '第 301 页' && labels[29] === '第 330 页', `页码标签按实际页码：${labels[0]} … ${labels[29]}`);
  const p320 = await win.evaluate(() => document.querySelector('#page-19 .pct')?.textContent || '');
  ok(/差异/.test(p320), `第 320 页标出差异：${p320}`);
  const line = await win.evaluate(() => document.querySelector('.range-line')?.textContent || '');
  ok(/301–330/.test(line) && /452/.test(line), `顶部写明只比较了哪些页：${line}`);
  // 更改 → 全部
  await win.click('.range-line .link-btn');
  await win.waitForSelector('.range-gate', { timeout: 10000 });
  const t0 = Date.now();
  await win.click('.range-gate .btn.primary');
  ok(await waitFor(win, () => document.querySelectorAll('.pagepair').length === 452 && !document.querySelector('.imgview .spinner'), null, 600000), '比较全部：452 对页，不再截到 300');
  console.log(`      用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  const diffPages = await win.evaluate(() => [...document.querySelectorAll('.pagepair')].filter((p) => p.querySelector('.pct.diff')).map((p) => p.querySelector('.ptitle span').textContent));
  ok(diffPages.join('、') === '第 5 页、第 320 页、第 448 页、第 451 页、第 452 页', `有差异的页正好是改过的 3 页和多出来的 2 页：${diffPages.join('、')}`);
  const mem = await app.evaluate(async ({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; const m = await wc.executeJavaScript('performance.memory ? performance.memory.usedJSHeapSize : 0'); return Math.round(m / 1048576); });
  console.log(`      渲染进程 JS 堆 ${mem} MB`);
  ok(errs.length === 0, `无页面错误 ${errs.slice(0, 2).join(' | ')}`);
  await app.close();
}

async function openReview(cfg, env) {
  const r = await launch(cfg, [`${S}/合同_v1.docx`, `${S}/合同_v2.docx`], env);
  await r.win.waitForSelector('.tbar', { state: 'attached', timeout: 60000 });
  await r.win.waitForTimeout(1500);
  await nav(r.win, 2);
  await r.win.waitForSelector('.review-bar', { timeout: 20000 });
  await r.win.waitForTimeout(500);
  return r;
}
const pos = (win) => win.evaluate(() => document.querySelector('.tb-pos')?.textContent?.trim() || '');
const openMore = async (win) => { await win.evaluate(() => document.querySelector('button[aria-label="更多操作"]').click()); await win.waitForTimeout(300); };
const menuClick = (win, text) => win.evaluate((text) => [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes(text))?.click(), text);

async function testBulk() {
  console.log('--- 批量操作：确认 + 撤销');
  const cfg = newCfg();
  const { app, win, errs } = await openReview(cfg);
  await win.keyboard.press('a'); await win.waitForTimeout(400);
  await win.keyboard.press('h'); await win.waitForTimeout(400);
  const before = await pos(win);
  const snap0 = await reviewCounts(win);
  await openMore(win);
  await menuClick(win, '全部拒绝');
  ok(await waitFor(win, () => !!document.querySelector('.bulk-ask'), null, 5000), '“全部拒绝”先弹出确认');
  const txt = await win.evaluate(() => document.querySelector('.bulk-ask')?.innerText || '');
  ok(/2 处已有其他结论，会被覆盖/.test(txt), `确认里写清会覆盖几个已有结论：${txt.replace(/\s+/g, ' ').slice(0, 90)}`);
  // 取消不改任何东西
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
  ok((await pos(win)) === before && !(await win.evaluate(() => !!document.querySelector('.bulk-ask'))), `取消后结论不变（${before}）`);
  await openMore(win); await menuClick(win, '全部拒绝');
  await win.waitForSelector('.bulk-ask');
  await win.click('.bulk-ask .btn.red');
  await win.waitForTimeout(600);
  const total = (await pos(win)).split('/')[1].trim();
  ok((await pos(win)).startsWith(total + ' '), `全部拒绝后 ${await pos(win)}`);
  ok(await win.evaluate(() => !!document.querySelector('.toast.undo')), '出现可撤销的提示');
  await win.click('.toast.undo .toast-btn');
  await win.waitForTimeout(800);
  ok((await pos(win)) === before, `撤销后回到 ${before}`);
  const snap1 = await reviewCounts(win);
  ok(JSON.stringify(snap0) === JSON.stringify(snap1), `撤销后磁盘上的结论与操作前一致 ${JSON.stringify(Object.values(snap1)[0])}`);
  // 重置也要确认、也能撤销（这次用 U 键）
  await openMore(win); await menuClick(win, '重置所有决定');
  await win.waitForSelector('.bulk-ask');
  const t2 = await win.evaluate(() => document.querySelector('.bulk-ask')?.innerText || '');
  ok(/2 个结论会被清空/.test(t2), `重置前写清会清空几个结论`);
  await win.click('.bulk-ask .btn.danger');
  await win.waitForTimeout(500);
  ok((await pos(win)).startsWith('0 '), `重置后 ${await pos(win)}`);
  await win.keyboard.press('u'); await win.waitForTimeout(800);
  ok((await pos(win)) === before, `按 U 撤销重置，回到 ${before}`);
  ok(errs.length === 0, `无页面错误 ${errs.slice(0, 2).join(' | ')}`);
  await app.close();
}

async function testStorage() {
  console.log('--- 审阅记录：写失败要提示，恢复后补存，重启后还在');
  const cfg = newCfg();
  let { app, win, errs } = await openReview(cfg);
  await app.evaluate(() => { process.env.DOCDIFF_TEST_FAIL_WRITES = '1'; });
  await win.keyboard.press('a'); await win.waitForTimeout(800);
  ok(await win.evaluate(() => !!document.querySelector('.persist-warn')), '写不进磁盘时出现警告');
  await win.keyboard.press('ArrowLeft'); await win.waitForTimeout(300);
  ok(await win.evaluate(() => !!document.querySelector('.rb-unsaved')), '审阅栏标“未保存”');
  await app.evaluate(() => { delete process.env.DOCDIFF_TEST_FAIL_WRITES; });
  await win.evaluate(() => [...document.querySelectorAll('.persist-warn button')].find((b) => b.textContent.includes('重试'))?.click());
  await win.waitForTimeout(800);
  ok(!(await win.evaluate(() => !!document.querySelector('.persist-warn'))), '重试成功后警告消失');
  const p1 = await pos(win);
  await app.close();
  // 文件真的在应用数据目录里
  const dir = path.join(cfg, 'DocDiff', 'reviews');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  ok(files.some((f) => /^[0-9a-f]{32}\.json$/.test(f)) && files.includes('index.json'), `应用数据目录里有记录文件：${files.join(', ')}`);
  ok(!files.some((f) => f.endsWith('.tmp')), '没有残留的临时文件');
  ({ app, win, errs } = await openReview(cfg));
  ok((await pos(win)) === p1, `重启后结论还在（${p1}）`);
  // 主文件损坏时用 .bak
  await app.close();
  const main = files.find((f) => /^[0-9a-f]{32}\.json$/.test(f));
  ({ app, win } = await openReview(cfg));
  await win.keyboard.press('r'); await win.waitForTimeout(800); // 再存一次，产生 .bak
  const p2 = await pos(win);
  await app.close();
  fs.writeFileSync(path.join(dir, main), '{"pk": "broken'); // 模拟写坏
  ({ app, win } = await openReview(cfg));
  const p3 = await pos(win);
  ok(p3 !== '0 / ' + p2.split('/')[1].trim(), `主文件损坏时从备份读回（${p3}，损坏前 ${p2}）`);
  // 超过 120 组也不删
  const n = await win.evaluate(() => { const fake = {}; for (let i = 0; i < 150; i++) fake['x' + i + '|y'] = { updated: Date.now() - i * 1000, total: 3, decided: 1, recs: { f: { v: 'a', by: 't', at: 1 } } }; localStorage.setItem('reviews-v1', JSON.stringify(fake)); return 150; });
  await win.reload(); await win.waitForTimeout(2500);
  const count = await win.evaluate(() => Object.keys(window.api.reviewIndex()).length);
  ok(count >= 151, `150 组旧记录全部搬进来、没有被淘汰（共 ${count} 组）`);
  ok(await win.evaluate(() => localStorage.getItem('reviews-v1') === null), '搬完后删除旧的 localStorage 记录');
  await app.close();
}

async function testMigrate() {
  console.log('--- 设置迁移：旧版 localStorage 里的偏好搬到 settings.json');
  const cfg = newCfg();
  let { app, win } = await launch(cfg, []);
  await win.waitForTimeout(1500);
  await win.evaluate(() => { localStorage.setItem('theme', 'dark'); localStorage.setItem('prefs-v2', JSON.stringify({ reviewerName: '王测试' })); });
  // 删掉 settings.json，模拟从 1.7.2 升级
  await app.close();
  const sf = path.join(cfg, 'DocDiff', 'settings.json');
  for (const f of [sf, sf + '.bak']) try { fs.unlinkSync(f); } catch {}
  ({ app, win } = await launch(cfg, []));
  await win.waitForTimeout(2000);
  const theme = await win.evaluate(() => document.documentElement.dataset.theme);
  ok(theme === 'dark', `主题沿用旧设置：${theme}`);
  await app.close();
  const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
  ok(s.theme === 'dark' && s['prefs-v2']?.reviewerName === '王测试', 'settings.json 里有搬过来的主题和审阅人');
}

async function testKeyboard() {
  console.log('--- 最近比较：删除按钮常显，Tab 不会落到看不见的按钮上');
  const cfg = newCfg();
  let { app, win } = await openReview(cfg);
  await app.close();
  ({ app, win } = await launch(cfg, []));
  await win.waitForSelector('.recent-item', { timeout: 20000 });
  const vis = await win.evaluate(() => { const x = document.querySelector('.recent-item .x'); const cs = getComputedStyle(x); return { op: cs.opacity, vis: cs.visibility, pe: cs.pointerEvents }; });
  ok(vis.op === '1' && vis.vis === 'visible', `删除按钮不悬停也可见（opacity ${vis.op}）`);
  let hidden = 0;
  for (let i = 0; i < 25; i++) {
    await win.keyboard.press('Tab');
    const h = await win.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.opacity === '0' || cs.visibility === 'hidden' || r.width === 0; });
    if (h) hidden++;
  }
  ok(hidden === 0, `Tab 25 次，没有落到看不见的元素上（${hidden} 次）`);
  await app.close();
}

async function testOcr() {
  console.log('--- OCR：大文件先确认范围，按批识别，页码按实际页');
  const cfg = newCfg();
  const { app, win, errs } = await launch(cfg, [`${S}/big_A.pdf`, `${S}/big_B.pdf`]);
  await win.waitForSelector('.tbar', { state: 'attached', timeout: 120000 });
  await nav(win, 4);
  ok(await waitFor(win, () => !!document.querySelector('.range-gate'), null, 120000), 'OCR 超过 300 页也先确认');
  const gt = await win.evaluate(() => document.querySelector('.range-gate')?.innerText || '');
  ok(/逐页识别/.test(gt) && /小时|分钟/.test(gt), `写了预计识别时间：${gt.replace(/\s+/g, ' ').slice(0, 70)}`);
  await win.fill('.range-gate input[aria-label="起始页"]', '316');
  await win.fill('.range-gate input[aria-label="结束页"]', '323');
  await win.click('.range-gate .gate-range button[type=submit]');
  ok(await waitFor(win, () => !document.querySelector('.empty-state .progress') && !!document.querySelector('.tb-pos, .dlist .drow'), null, 900000), 'OCR 完成（8 页，分两批）');
  const txt = await win.evaluate(() => document.body.innerText);
  const pg = await win.evaluate(() => [...document.querySelectorAll('.conf-pg')].map((x) => x.getAttribute('title').split('：')[0]));
  ok(pg.length === 16 && pg[0] === '第 316 页' && pg[7] === '第 323 页', `识别质量按实际页码：${pg.slice(0, 8).join('、')}`);
  ok(/CHANGED/.test(txt), '识别出第 320 页的改动');
  const line = await win.evaluate(() => document.querySelector('.range-line')?.textContent || '');
  ok(/316–323/.test(line), `识别质量旁写明范围：${line}`);
  ok(errs.length === 0, `无页面错误 ${errs.slice(0, 2).join(' | ')}`);
  await app.close();
}

(async () => {
  const all = { ocr: testOcr, image: testImage, bulk: testBulk, storage: testStorage, migrate: testMigrate, keyboard: testKeyboard };
  for (const [k, fn] of Object.entries(all)) if (which === 'all' || which === k) { try { await fn(); } catch (e) { ok(false, `${k} 异常：${e.message.split('\n')[0]}`); } }
  console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
  process.exit(fails ? 1 : 0);
})();
