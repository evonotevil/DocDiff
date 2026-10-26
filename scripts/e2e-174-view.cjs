// 1.7.4 回归：差异地图 + 正文按需挂载。用法：xvfb-run -a node scripts/e2e-174-view.cjs [输出目录]
// 用 Windows 评测的 word-3000 / word-100 夹具（PERF_FIX 指定目录），检查跳转、地图、滚动、选字、对齐、隐藏未变化、切换模式。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const FX = process.env.PERF_FIX || '/home/claude/perf/win/outputs/fixtures';
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'view-'));
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const log = [];
const ok = (c, m) => { const l = `${c ? 'PASS' : 'FAIL'}  ${m}`; console.log(l); log.push(l); if (!c) fails++; };

async function open(a, b) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'v174-'));
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, a, b], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForFunction(() => !!document.querySelector('.tb-pos') && !!document.querySelector('.main .scroll .rich'), null, { timeout: 120000 });
  await win.waitForTimeout(1500);
  return { app, win, errs };
}
// 选中的差异是否在可视区域里
const selVisible = (win) => win.evaluate(() => {
  const sc = document.querySelector('.main .scroll');
  const pos = document.querySelector('.tb-pos')?.textContent?.trim();
  const sel = document.querySelector('.dlist .drow.sel')?.getAttribute('data-chg');
  const el = sel && (sc.querySelector(`[data-cid="${sel}"]`) || sc.querySelector('.sel-row'));
  if (!el) return { ok: false, pos, sel, why: 'no element' };
  const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect();
  return { ok: r.bottom > s.top + 30 && r.top < s.bottom - 30, pos, sel, top: Math.round(r.top - s.top), h: Math.round(s.height) };
});
const click = (win, sel) => win.evaluate((s) => document.querySelector(s).click(), sel);

(async () => {
  const { app, win, errs } = await open(`${FX}/word-3000-a.docx`, `${FX}/word-3000-b.docx`);
  const dom = await win.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, chunks: document.querySelectorAll('.rich-chunk').length, phs: document.querySelectorAll('.rich-ph').length, rows: document.querySelectorAll('.rich [data-row]').length / 2 }));
  ok(dom.phs > 0 && dom.nodes < 15000, `3000 段只挂载视口附近：${dom.rows} 行已挂载，${dom.phs} 块占位，页面共 ${dom.nodes} 个节点`);

  // 跳转：从头“下一处”、从无选择“上一处”跳到最后一处（远距离）
  await click(win, 'button[aria-label="下一处"]'); await win.waitForTimeout(900);
  let v = await selVisible(win); ok(v.ok, `下一处 → 第一处差异在视口里（${v.pos}，距顶 ${v.top}px）`);
  for (let i = 0; i < 4; i++) { await click(win, 'button[aria-label="下一处"]'); await win.waitForTimeout(400); }
  await win.waitForTimeout(600);
  v = await selVisible(win); ok(v.ok, `连按 5 次下一处，当前差异在视口里（${v.pos}）`);
  // 清单里点中间一处
  const mid = await win.evaluate(() => { const rows = [...document.querySelectorAll('.dlist .drow[data-chg]')]; const r = rows[Math.floor(rows.length * 0.6)]; r.scrollIntoView(); r.click(); return r.getAttribute('data-chg'); });
  await win.waitForTimeout(1200);
  v = await selVisible(win); ok(v.ok && v.sel === mid, `点清单第 60% 处的差异（#${mid}）：正文跳到它（${v.pos}，距顶 ${v.top}px）`);
  // 地图：点下部 → 滚到对应位置，视口里是真实内容而不是占位
  const mapRes = await win.evaluate(async () => {
    const m = document.querySelector('.changemap'); const sc = document.querySelector('.main .scroll');
    const r = m.getBoundingClientRect();
    const y = r.top + r.height * 0.8;
    m.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width / 2, clientY: y, bubbles: true, pointerId: 1 }));
    m.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + r.width / 2, clientY: y, bubbles: true, pointerId: 1 }));
    await new Promise((res) => setTimeout(res, 800));
    const s = sc.getBoundingClientRect();
    const atMid = document.elementFromPoint(s.left + s.width / 4, s.top + s.height / 2);
    return { ratio: (sc.scrollTop + sc.clientHeight / 2) / sc.scrollHeight, real: !!atMid?.closest('.rich-chunk'), ph: !!atMid?.closest('.rich-ph') };
  });
  ok(Math.abs(mapRes.ratio - 0.8) < 0.08 && mapRes.real, `点差异地图 80% 处：滚到 ${(mapRes.ratio * 100).toFixed(1)}%，视口中间是正文（${mapRes.real ? '真实内容' : '占位'}）`);
  // 滚动稳定：停下后视口顶部的那一行不再漂移
  const anchor = async () => win.evaluate(() => { const sc = document.querySelector('.main .scroll'); const s = sc.getBoundingClientRect(); const el = document.elementFromPoint(s.left + s.width / 4, s.top + 80)?.closest('[data-row]'); return el ? { row: el.dataset.row, y: Math.round(el.getBoundingClientRect().top) } : null; });
  await win.evaluate(() => { document.querySelector('.main .scroll').scrollTop = document.querySelector('.main .scroll').scrollHeight * 0.4; });
  await win.waitForTimeout(700);
  const a1 = await anchor(); await win.waitForTimeout(1500); const a2 = await anchor();
  ok(a1 && a2 && a1.row === a2.row && Math.abs(a1.y - a2.y) <= 2, `滚到 40% 后静止 1.5 秒，视口里的行不漂移（第 ${a1?.row} 行，${a1?.y} → ${a2?.y}）`);
  // 一路滚到底，最后一行能看到
  const end = await win.evaluate(async () => {
    const sc = document.querySelector('.main .scroll');
    for (let i = 0; i < 400; i++) { sc.scrollTop += sc.clientHeight; await new Promise((r) => requestAnimationFrame(r)); if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) break; }
    await new Promise((r) => setTimeout(r, 400)); sc.scrollTop = sc.scrollHeight; await new Promise((r) => setTimeout(r, 400));
    const rows = [...document.querySelectorAll('.rich [data-row]')].map((e) => +e.dataset.row);
    return { last: Math.max(...rows) };
  });
  ok(end.last >= 2990, `滚到底能看到最后一行（第 ${end.last} 行）`);

  // 选字：在开头选一段，再跳到很远处 Shift+点击，选区中间没挂载过的段落也要包含进来
  await win.evaluate(() => { document.querySelector('.main .scroll').scrollTop = 0; });
  await win.waitForTimeout(500);
  const sel = await win.evaluate(async () => {
    const sc = document.querySelector('.main .scroll');
    const first = sc.querySelector('.cell[data-row="2"][data-side="a"] [data-mi]');
    const s = window.getSelection(); s.removeAllRanges();
    const r = document.createRange(); r.setStart(first.firstChild || first, 0); r.setEnd(first.firstChild || first, 1); s.addRange(r);
    await new Promise((res) => setTimeout(res, 100));
    sc.scrollTop = sc.scrollHeight * 0.5;
    await new Promise((res) => setTimeout(res, 600));
    const target = [...sc.querySelectorAll('.rich-chunk .cell[data-side="a"] [data-mi]')].pop();
    s.extend(target.firstChild || target, 1);
    await new Promise((res) => setTimeout(res, 600));
    const text = s.toString();
    const row = +target.closest('[data-row]').dataset.row;
    const midRow = Math.floor(row / 2);
    const midText = sc.querySelector(`.cell[data-row="${midRow}"][data-side="a"]`)?.textContent?.slice(0, 20) || '';
    return { len: text.length, row, midRow, midMounted: !!midText, inSel: !!midText && text.includes(midText) };
  });
  ok(sel.midMounted && sel.inSel, `从第 2 行选到第 ${sel.row} 行（${sel.len} 字）：中间第 ${sel.midRow} 行被挂上并包含在选区里`);
  // 全选：全文挂载，选区包含最后一行
  const all = await win.evaluate(async () => {
    window.getSelection().removeAllRanges();
    await new Promise((r) => setTimeout(r, 200));
    const rich = document.querySelector('.main .rich');
    window.getSelection().selectAllChildren(rich);
    await new Promise((r) => setTimeout(r, 800));
    const text = window.getSelection().toString();
    const last = document.querySelector('.rich .cell[data-row="2999"][data-side="a"]')?.textContent?.slice(0, 20) || '';
    const r = { phs: document.querySelectorAll('.rich-ph').length, has: !!last && text.includes(last) };
    window.getSelection().removeAllRanges();
    await new Promise((r) => setTimeout(r, 300));
    return r;
  });
  ok(all.phs === 0 && all.has, `全选正文：全部挂载（占位 ${all.phs}），选区包含最后一行`);
  const back = await win.evaluate(() => new Promise((r) => setTimeout(() => r(document.querySelectorAll('.rich-ph').length), 600)));
  ok(back > 0, `取消选区后恢复按需挂载（占位 ${back} 块）`);

  // 对齐：点一处修改段落里的词，出现对齐提示，可撤销
  await win.evaluate(() => { document.querySelector('.main .scroll').scrollTop = 0; });
  await win.waitForTimeout(500);
  const box = await win.evaluate(() => { const el = document.querySelector('.rich .cell.k-modified[data-side="b"] [data-mi]'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 3, y: r.top + r.height / 2 }; });
  await win.waitForTimeout(300);
  await win.mouse.click(box.x, box.y);
  await win.waitForTimeout(500);
  const chip = await win.evaluate(() => document.querySelector('.align-chip')?.textContent || '');
  ok(/对齐|标记/.test(chip), `点正文里的词：${chip.replace(/撤销对齐|取消标记/, '').trim()}`);
  await win.keyboard.press('Escape');

  // 隐藏未变化
  await win.evaluate(() => [...document.querySelectorAll('.ch-opt')].find((l) => l.textContent.includes('只看有变化的段落'))?.querySelector('button,[role=switch],input')?.click());
  await win.waitForTimeout(1200);
  const hid = await win.evaluate(() => ({ folds: document.querySelectorAll('.rich .fold-cell').length, rows: document.querySelectorAll('.rich [data-row]').length / 2 }));
  ok(hid.folds > 0, `只看有变化的段落：出现 ${hid.folds / 2} 处折叠，挂载 ${hid.rows} 行`);
  await click(win, 'button[aria-label="上一处"]'); await win.waitForTimeout(1200);
  v = await selVisible(win); ok(v.ok, `隐藏未变化时跳到上一处，差异在视口里（${v.pos}）`);
  await win.evaluate(() => [...document.querySelectorAll('.ch-opt')].find((l) => l.textContent.includes('只看有变化的段落'))?.querySelector('button,[role=switch],input')?.click());
  await win.waitForTimeout(800);

  // 切换模式再回来
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[1].click()); await win.waitForTimeout(1500);
  const t0 = Date.now();
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[0].click());
  await win.waitForFunction(() => !!document.querySelector('.main .rich-chunk'), null, { timeout: 30000 });
  const sw = Date.now() - t0;
  const ticks = await win.evaluate(() => document.querySelectorAll('.changemap .cm-tick').length);
  ok(sw < 1500 && ticks > 0, `纯文本 → 富文本 ${sw} ms，差异地图 ${ticks} 段`);
  await win.screenshot({ path: path.join(OUT, 'word3000-rich.png') });
  ok(errs.length === 0, `无页面错误 ${errs.slice(0, 2).join(' | ')}`);
  await app.close();

  // 小文档：整篇挂载，行为与以前一致
  const s = await open(`${FX}/word-100-a.docx`, `${FX}/word-100-b.docx`);
  const small = await s.win.evaluate(() => ({ phs: document.querySelectorAll('.rich-ph').length, rows: document.querySelectorAll('.rich [data-row]').length / 2, ticks: document.querySelectorAll('.changemap .cm-tick').length }));
  ok(small.phs === 0 && small.ticks === 56, `100 段：整篇挂载 ${small.rows} 行，没有占位，地图 ${small.ticks} 条刻度`);
  await s.win.screenshot({ path: path.join(OUT, 'word100-rich.png') });
  ok(s.errs.length === 0, '小文档无页面错误');
  await s.app.close();
  fs.writeFileSync(path.join(OUT, 'view-results.txt'), log.join('\n') + '\n');
  console.log(fails ? `${fails} 项失败` : '全部通过');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
