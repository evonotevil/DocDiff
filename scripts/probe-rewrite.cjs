// 3000 段全文改写（mac 评测里切换模式超时的用例）：每 10 秒看一次界面状态，主线程 5 秒不响应记为“无响应”。
// 用法：xvfb-run -a node scripts/probe-rewrite.cjs <应用目录> <A> <B> <输出.json>
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const [APP, A, B, OUT] = process.argv.slice(2);
(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'rw-')) } });
  const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
  const t0 = Date.now(); const log = [];
  const look = () => Promise.race([win.evaluate(() => ({ pos: document.querySelector('.tb-pos')?.textContent, spin: !!document.querySelector('.main .spinner'), scroll: !!document.querySelector('.main .scroll'), dom: document.getElementsByTagName('*').length, tab: document.querySelector('.nav-list .nav-item.on, .nav-list .nav-item[aria-current]')?.textContent })), new Promise((r) => setTimeout(() => r('no response in 5 s'), 5000))]);
  const step = async (name, fn) => { const t = Date.now(); if (fn) await Promise.race([fn(), new Promise((r) => setTimeout(r, 5000))]); for (let i = 0; i < 9; i++) { await new Promise((r) => setTimeout(r, 10000)); const s = await look(); const e = { name, sinceStepS: Math.round((Date.now() - t) / 1000), totalS: Math.round((Date.now() - t0) / 1000), s }; log.push(e); console.log(JSON.stringify(e)); if (typeof s === 'object' && s.scroll && !s.spin) break; } };
  await step('load');
  for (const [i, n] of [[1, 'plain'], [2, 'review'], [0, 'rich']]) await step(n, () => win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i));
  fs.writeFileSync(OUT, JSON.stringify({ app: APP, log }, null, 1));
  await app.close().catch(() => {});
  process.exit(0);
})();
