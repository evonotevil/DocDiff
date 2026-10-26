// 1.7.4 回归：图像 / OCR 的“比较范围”和“完成进度”分开显示。用法：xvfb-run -a node scripts/e2e-174-progress.cjs [输出目录]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const FX = process.env.PERF_FIX || '/home/claude/perf/win/outputs/fixtures';
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'prog-'));
fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const log = [];
const ok = (c, m) => { const l = `${c ? 'PASS' : 'FAIL'}  ${m}`; console.log(l); log.push(l); if (!c) fails++; };
async function open(files, lang = 'zh-CN') {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'p174-'));
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', `--lang=${lang}`, APP, ...files], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForSelector('.tbar', { state: 'attached', timeout: 90000 }); await win.waitForTimeout(1200);
  return { app, win, errs };
}
const nav = (win, i) => win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i);
const snap = (win) => win.evaluate(() => ({ line: document.querySelector('.range-line')?.textContent || '', phase: document.querySelector('.range-line')?.dataset.phase, pairs: document.querySelectorAll('.pagepair').length, spin: !!document.querySelector('.imgview .spinner, .main .spinner'), insp: document.querySelector('.insp-sum')?.textContent || '' }));
const A30 = `${FX}/vector-pdf-30-a.pdf`, B30 = `${FX}/vector-pdf-30-b.pdf`;

(async () => {
  // 1. 进行中只说“已完成 x/30”，全部完成后才说“全部 30 页已比较”
  let { app, win, errs } = await open([A30, B30]);
  await nav(win, 3);
  const samples = []; let claimedEarly = null;
  for (let i = 0; i < 400; i++) {
    const s = await snap(win); samples.push({ t: i * 50, ...s });
    if (/全部 30 页已比较/.test(s.line) && (s.pairs < 30 || s.spin)) claimedEarly = s;
    if (s.phase === 'done' && !s.spin) break;
    await win.waitForTimeout(50);
  }
  const mid = samples.find((s) => s.phase === 'running' && s.pairs > 0 && s.pairs < 30);
  ok(!claimedEarly, `比较进行中从没出现“全部 30 页已比较”${claimedEarly ? `（出现时只有 ${claimedEarly.pairs} 页）` : ''}`);
  ok(!!mid && /比较范围：全部 30 页；已完成 \d+\/30 页/.test(mid.line), `进行中：${mid?.line}（列表 ${mid?.pairs} 页）`);
  const end = samples[samples.length - 1];
  ok(end.phase === 'done' && end.pairs === 30 && /全部 30 页已比较/.test(end.line), `完成后：${end.line}（${end.pairs} 页）`);
  fs.writeFileSync(path.join(OUT, 'image-progress-samples.json'), JSON.stringify(samples, null, 1));
  await app.close();

  // 2. 停止 → 说明完成 / 未完成，继续比较后补齐
  ({ app, win, errs } = await open([A30, B30]));
  await nav(win, 3);
  await win.waitForFunction(() => document.querySelectorAll('.pagepair').length >= 8, null, { timeout: 60000, polling: 20 });
  await win.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === '停止比较')?.click());
  await win.waitForFunction(() => document.querySelector('.range-line')?.dataset.phase === 'stopped', null, { timeout: 30000 });
  let s = await snap(win);
  const m = s.line.match(/已完成 (\d+)\/30 页，还有 (\d+) 页没有比较/);
  ok(!!m && +m[1] + +m[2] === 30 && +m[1] === s.pairs, `停止后：${s.line}；列表 ${s.pairs} 页`);
  ok(/已完成 \d+\/30 页/.test(s.insp), `检查器：${s.insp}`);
  await win.screenshot({ path: path.join(OUT, 'image-stopped.png') });
  await win.evaluate(() => [...document.querySelectorAll('.range-line .link-btn')].find((b) => b.textContent === '继续比较')?.click());
  await win.waitForFunction(() => document.querySelector('.range-line')?.dataset.phase === 'done', null, { timeout: 90000 });
  s = await snap(win);
  const diffPages = await win.evaluate(() => [...document.querySelectorAll('.pagepair')].filter((p) => p.querySelector('.pct.diff')).map((p) => p.querySelector('.ptitle span').textContent).join('、'));
  const labels = await win.evaluate(() => [...document.querySelectorAll('.pagepair .ptitle span:first-child')].map((x) => +x.textContent.replace(/\D/g, '')));
  ok(s.pairs === 30 && labels.every((p, i) => p === i + 1) && /全部 30 页已比较/.test(s.line), `继续比较后：${s.line}，30 页按顺序、无重复`);
  ok(diffPages === '第 7 页、第 14 页、第 21 页、第 28 页', `差异页：${diffPages}`);
  ok(errs.length === 0, `无页面错误 ${errs.join(' | ')}`);
  await app.close();

  // 3. 出错：第 12 页失败 → 说明完成 / 未完成，重试后补齐
  ({ app, win, errs } = await open([A30, B30]));
  await win.evaluate(() => { globalThis.__DD_TEST_FAIL_PAGE = 12; });
  await nav(win, 3);
  await win.waitForFunction(() => document.querySelector('.range-line')?.dataset.phase === 'error', null, { timeout: 60000 });
  s = await snap(win);
  const err = await win.evaluate(() => document.querySelector('.imgview .nt, .main .nt')?.textContent || '');
  ok(/比较出错停止：比较范围 全部 30 页，已完成 11\/30 页，还有 19 页没有比较/.test(s.line) && s.pairs === 11, `出错后：${s.line}；列表 ${s.pairs} 页；${err.slice(0, 40)}`);
  await win.screenshot({ path: path.join(OUT, 'image-error.png') });
  await win.evaluate(() => { globalThis.__DD_TEST_FAIL_PAGE = 0; [...document.querySelectorAll('.range-line .link-btn')].find((b) => b.textContent === '重试')?.click(); });
  await win.waitForFunction(() => document.querySelector('.range-line')?.dataset.phase === 'done', null, { timeout: 90000 });
  s = await snap(win);
  ok(s.pairs === 30 && /全部 30 页已比较/.test(s.line), `重试后：${s.line}`);
  await app.close();

  // 4. 英文
  ({ app, win, errs } = await open([A30, B30], 'en-US'));
  await nav(win, 3);
  await win.waitForFunction(() => /done/.test(document.querySelector('.range-line')?.textContent || ''), null, { timeout: 60000, polling: 20 });
  const en1 = (await snap(win)).line;
  await win.waitForFunction(() => document.querySelector('.range-line')?.dataset.phase === 'done', null, { timeout: 90000 });
  const en2 = (await snap(win)).line;
  ok(/Comparing all 30 pages: \d+\/30 pages done/.test(en1) && /All 30 pages compared/.test(en2), `英文：“${en1}” → “${en2}”`);
  await app.close();

  // 5. OCR：开始前只说范围；识别中说已识别几页；取消后说明没有生成结果
  ({ app, win, errs } = await open([`${FX}/pdf-3-a.pdf`, `${FX}/pdf-3-b.pdf`]));
  await nav(win, 4);
  await win.waitForFunction(() => !!document.querySelector('.range-line'), null, { timeout: 30000 });
  const idle = (await snap(win)).line;
  ok(/^比较范围：全部 3 页/.test(idle) && !/已比较|已识别/.test(idle), `OCR 开始前：${idle}`);
  await win.evaluate(() => [...document.querySelectorAll('.main button')].find((b) => b.textContent === '开始识别').click());
  let run = null;
  for (let i = 0; i < 600 && !run; i++) { const l = (await snap(win)).line; if (/已识别 [1-5]\/6 页/.test(l)) run = l; else await win.waitForTimeout(100); }
  ok(!!run, `OCR 识别中：${run}`);
  await win.evaluate(() => [...document.querySelectorAll('.main button')].find((b) => b.textContent === '取消')?.click());
  await win.waitForFunction(() => document.querySelector('.range-line')?.dataset.phase === 'stopped', null, { timeout: 30000 });
  const stopped = (await snap(win)).line;
  ok(/已取消识别：已识别 \d\/6 页（两份文档合计），没有生成比较结果/.test(stopped), `OCR 取消后：${stopped}`);
  await win.evaluate(() => [...document.querySelectorAll('.main button')].find((b) => b.textContent === '开始识别').click());
  await win.waitForFunction(() => document.querySelector('.range-line')?.dataset.phase === 'done' || document.querySelector('.range-line')?.dataset.phase === 'error', null, { timeout: 240000 });
  const done = await win.evaluate(() => [...document.querySelectorAll('.range-line')].map((x) => x.textContent).join(' | '));
  ok(/全部 3 页已识别并比较/.test(done), `OCR 完成：${done}`);
  ok(errs.length === 0, `OCR 无页面错误 ${errs.join(' | ')}`);
  await app.close();
  fs.writeFileSync(path.join(OUT, 'progress-results.txt'), log.join('\n') + '\n');
  console.log(fails ? `${fails} 项失败` : '全部通过');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
