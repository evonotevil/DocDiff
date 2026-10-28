// 比较结果“指纹”：用来确认性能修复没有改变比较结果。
// 记录：富文本 / 纯文本 / 修订审阅的差异数和每处差异（类别 + 前后文字的哈希）、比较范围文字、图像模式每页的差异比例和区域数。
// 用法：APP=<应用目录> xvfb-run -a node scripts/result-fingerprint.cjs <A> <B> <输出.json>
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const [A, B, OUT] = process.argv.slice(2);
const h = (s) => crypto.createHash('sha256').update(s || '').digest('hex').slice(0, 12);
(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')) } });
  const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
  const ready = () => win.waitForFunction(() => !!document.querySelector('.tb-pos') && !document.querySelector('.main .spinner'), null, { timeout: 180000, polling: 100 });
  const grab = () => win.evaluate(() => ({
    pos: document.querySelector('.tb-pos')?.textContent,
    chips: [...document.querySelectorAll('.chips .fchip')].map((b) => b.textContent.replace(/\s+/g, '')),
    list: [...document.querySelectorAll('.dlist .drow[data-chg]')].map((r) => [r.dataset.chg, [...r.classList].find((c) => c.startsWith('k-')), r.textContent]),
    scope: document.querySelector('.insp')?.innerText.match(/比较范围[\s\S]*/)?.[0]?.slice(0, 200) || '',
  }));
  const out = {};
  await ready(); await win.waitForTimeout(1000);
  for (const [i, name] of [[0, 'rich'], [1, 'plain'], [2, 'review']]) {
    await win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i);
    await ready(); await win.waitForTimeout(1500);
    const g = await grab();
    out[name] = { pos: g.pos, chips: g.chips, n: g.list.length, list: g.list.map(([id, k, t]) => `${id}:${k}:${h(t)}`), scope: h(g.scope) };
  }
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[3].click());
  await win.waitForFunction(() => document.querySelector('.range-line')?.dataset.phase === 'done', null, { timeout: 300000, polling: 200 });
  out.image = await win.evaluate(() => [...document.querySelectorAll('.pagepair')].map((p) => p.querySelector('.ptitle')?.textContent));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ rich: out.rich.pos, plain: out.plain.pos, review: out.review.pos, image: out.image.length }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
