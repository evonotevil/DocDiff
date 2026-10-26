// 1.7.4 中文 PDF 回归：用法 xvfb-run -a node scripts/e2e-174-cjk.cjs [输出目录]
// 夹具在 test/fixtures/cjk-pdf（说明见那里的 README.md）。原始结果写到 输出目录/cjk-results.json，截图同目录。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const F = path.join(__dirname, '../test/fixtures/cjk-pdf');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'cjk-out-'));
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const results = {};
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

async function run(name, a, b) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd174-'));
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', process.env.APP || path.join(__dirname, '..'), path.join(F, a), path.join(F, b)], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForSelector('.tbar', { state: 'attached', timeout: 90000 });
  await win.waitForTimeout(2000);
  const rich = await win.evaluate(() => ({
    pos: document.querySelector('.tb-pos')?.textContent?.trim() || '',
    noDiff: /^(没有差异|无差异)/.test(document.querySelector('.tb-pos')?.textContent?.trim() || ''),
    warn: document.querySelector('.read-warn')?.innerText || '',
    warnActions: [...document.querySelectorAll('.read-warn button')].map((x) => x.textContent.trim()),
  }));
  await win.screenshot({ path: path.join(OUT, `${name}-rich.png`) });
  // 纯文本视图里取出改动前后的行，核对具体改了什么
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[1].click());
  await win.waitForTimeout(1500);
  Object.assign(rich, await win.evaluate(() => ({
    del: [...document.querySelectorAll('.cside.del .ct')].map((x) => x.textContent).join('|'),
    ins: [...document.querySelectorAll('.cside.ins .ct')].map((x) => x.textContent).join('|'),
  })));
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[3].click());
  await win.waitForSelector('.pagepair', { timeout: 90000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000 && await win.evaluate(() => !!document.querySelector('.imgview .spinner'))) await win.waitForTimeout(300);
  await win.waitForTimeout(800);
  const image = await win.evaluate(() => [...document.querySelectorAll('.pagepair')].map((p) => ({
    page: p.querySelector('.ptitle span')?.textContent || '',
    pct: p.querySelector('.pct')?.textContent || '',
    diff: !!p.querySelector('.pct.diff'),
  })));
  await win.screenshot({ path: path.join(OUT, `${name}-image.png`) });
  const n = parseInt((rich.pos.match(/(?:\/\s*|共\s*)(\d+)/) || [])[1] || '0', 10);
  const r = { a, b, diffCount: n, rich, image, errors: errs };
  results[name] = r;
  await app.close();
  return r;
}

(async () => {
  let r = await run('vector-pdf-30', 'vector-pdf-30-a.pdf', 'vector-pdf-30-b.pdf');
  ok(r.diffCount === 8, `原始 Windows 文件：富文本 8 处差异（实际 ${r.diffCount}，${r.rich.pos}）`);
  ok(!r.rich.noDiff, '不再显示“无差异”');
  const dp = r.image.filter((x) => x.diff).map((x) => x.page).join('、');
  ok(dp === '第 7 页、第 14 页、第 21 页、第 28 页', `图像：有差异的页 ${dp}`);
  ok(!r.rich.warn, '没有读取警告');

  r = await run('cn-mix', 'cn-mix-A.pdf', 'cn-mix-B.pdf');
  const txt = r.rich.ins + '|' + r.rich.del;
  ok(/198,?000/.test(txt) && /120,?000/.test(txt), `金额改动被发现：${txt.slice(0, 80)}`);
  ok(/15/.test(r.rich.ins) && /30/.test(r.rich.del), '期限 30 → 15 被发现');
  ok(/二十四/.test(r.rich.ins) && /十二/.test(r.rich.del), '服务期限 十二 → 二十四 被发现');
  ok(r.image.some((x) => x.diff), '图像模式也有差异');
  ok(!r.rich.warn, '没有读取警告');

  r = await run('cn-mix-same', 'cn-mix-A.pdf', 'cn-mix-A2.pdf');
  ok(r.diffCount === 0, `相同内容 0 处差异（实际 ${r.diffCount}）`);
  ok(!r.image.some((x) => x.diff), '图像无差异，没有误报');
  ok(!r.rich.warn, '没有读取警告');

  const mix = results['cn-mix'];
  r = await run('cn-embed', 'cn-embed-A.pdf', 'cn-embed-B.pdf');
  ok(r.diffCount === mix.diffCount, `对照组（全部嵌入）差异数与 cn-mix 一致：${r.diffCount} / ${mix.diffCount}`);

  r = await run('cn-badcmap', 'cn-badcmap-A.pdf', 'cn-badcmap-B.pdf');
  ok(/有些文字没能读出来/.test(r.rich.warn), `出现读取警告：${r.rich.warn.replace(/\s+/g, ' ').slice(0, 120)}`);
  ok(r.rich.warnActions.some((x) => /其他阅读器/.test(x)), `警告给出替代入口：${r.rich.warnActions.join(' / ')}`);
  ok(r.image.some((x) => /可能缺字/.test(x.pct)), `图像页标“可能缺字”：${r.image.map((x) => x.pct).join(' / ')}`);

  for (const [k, v] of Object.entries(results)) ok(v.errors.length === 0, `${k}：无页面错误 ${v.errors.slice(0, 2).join(' | ')}`);
  fs.writeFileSync(path.join(OUT, 'cjk-results.json'), JSON.stringify({ when: new Date().toISOString(), host: `${os.platform()} ${os.cpus()[0]?.model} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB`, results }, null, 1));
  console.log(`\n${fails ? fails + ' 项失败' : '全部通过'}；原始结果：${OUT}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
