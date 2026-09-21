// v1.4.2 商店五图：极简文案（只保留一句标题）+ 每张不同表情的吉祥物
const { chromium } = require('playwright');
const fs = require('fs');
const R = '/home/claude/store/raw14', O = '/home/claude/store/v142';
fs.mkdirSync(O, { recursive: true });
const F = '/home/claude/docdiff/node_modules/@fontsource/nunito/files';
const NF = '/home/claude/docdiff/node_modules/@fontsource/noto-sans-sc/files';
const font = (fam, file, w) => `@font-face{font-family:${fam};font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})}`;
const fonts = [
  font('Nunito', `${F}/nunito-latin-800-normal.woff2`, 800),
  font('Nunito', `${F}/nunito-latin-900-normal.woff2`, 900),
  font('NotoSC', `${NF}/noto-sans-sc-chinese-simplified-700-normal.woff2`, 700),
  font('NotoSC', `${NF}/noto-sans-sc-chinese-simplified-900-normal.woff2`, 900),
].join('');
const mark = fs.readFileSync('/home/claude/docdiff/renderer/src/assets/logo-mark.svg', 'utf8').replace('<svg ', '<svg width="87" height="90" ');
const mascot = (mood, h) => fs.readFileSync(`/home/claude/store/mascot-${mood}.svg`, 'utf8').replace(/width="\d+" height="\d+"/, `width="${h}" height="${h}"`);
const img = (f) => `data:image/png;base64,${fs.readFileSync(`${R}/${f}`).toString('base64')}`;
const mac = (f, cls = '') => `<div class="win mac ${cls}"><div class="bar"><i class="d r"></i><i class="d y"></i><i class="d g"></i></div><img src="${img(f)}"></div>`;
const winx = (f, cls = '') => `<div class="win w10 ${cls}"><div class="bar"><span class="wc">─ ☐ ✕</span></div><img src="${img(f)}"></div>`;

const S = [
  { bg: '#58cc02', lip: '#46a302', ink: '#fff', mood: 'happy', h: '每一处不同，一眼看清', stage: mac('1-rich.png', 'big') },
  { bg: '#1cb0f6', lip: '#1899d6', ink: '#fff', mood: 'think', h: 'Word 与 PDF，一点就对齐', stage: mac('2-align.png', 'big') },
  { bg: '#ffc800', lip: '#e5a500', ink: '#4b3a00', mood: 'cheer', h: '逐条审阅，轻松收尾',
    stage: `<div class="duo">${mac('3-review.png')}<div class="inset"><img src="${img('3b-done-crop.png')}"></div></div>` },
  { bg: '#ce82ff', lip: '#a568cc', ink: '#fff', mood: 'oops', h: '版面与扫描件，也能比', stage: mac('4-image.png', 'big') },
  { bg: '#131f24', lip: '#0b1418', ink: '#fff', mood: 'sleepy', h: '双端双语，完全离线',
    stage: `<div class="pair">${mac('5-dark.png')}${winx('6-en-win.png')}</div>` },
];

const page = (x) => `<!doctype html><html><head><style>${fonts}
*{box-sizing:border-box;margin:0}
body{width:2880px;height:1800px;overflow:hidden;background:${x.bg};font-family:Nunito,NotoSC,sans-serif;color:${x.ink};position:relative}
.dots{position:absolute;inset:0;background-image:radial-gradient(color-mix(in srgb,${x.ink} 8%,transparent) 3px,transparent 3.5px);background-size:60px 60px}
.brand{position:absolute;left:100px;top:82px;display:flex;align-items:center;gap:20px;font-weight:900;font-size:48px;letter-spacing:.5px;opacity:.92}
h1{position:absolute;top:250px;left:0;right:0;text-align:center;padding:0 200px;font-weight:900;font-size:136px;line-height:1.16;letter-spacing:2px}
.stage{position:absolute;left:0;right:0;top:640px;display:flex;justify-content:center;align-items:flex-start;gap:70px}
.win{border-radius:28px;overflow:hidden;background:#fff;box-shadow:0 16px 0 ${x.lip},0 50px 110px rgba(0,0,0,.4);width:1200px}
.win.big{width:2320px;border-radius:36px}
.win img{display:block;width:100%}
.win .bar{height:64px;display:flex;align-items:center;gap:14px;padding:0 28px;background:#e9eff2}
.win.big .bar{height:78px}
.win.w10 .bar{background:#dfe7ec;justify-content:flex-end;color:#5c7079;font-weight:800;font-size:26px}
.win .bar .d{width:20px;height:20px;border-radius:50%;display:inline-block}
.d.r{background:#ff5f57}.d.y{background:#febc2e}.d.g{background:#28c840}
.wc{letter-spacing:6px;opacity:.7}
.duo{position:relative;width:2320px;margin:0 auto}
.duo .win{width:2320px;border-radius:36px}
.duo .inset{position:absolute;right:40px;top:110px;width:620px;transform:rotate(-2deg);background:#fff;border-radius:32px;overflow:hidden;border:8px solid ${x.ink};box-shadow:0 20px 60px rgba(0,0,0,.4);z-index:4}
.duo .inset img{display:block;width:100%}
.pair{display:flex;gap:80px;justify-content:center}
.mascot{position:absolute;left:92px;bottom:40px;z-index:6;filter:drop-shadow(0 18px 24px rgba(0,0,0,.28))}
</style></head><body><div class="dots"></div>
<div class="brand">${mark}<span>DocDiff</span></div>
<h1>${x.h}</h1>
<div class="stage">${x.stage}</div>
<div class="mascot">${mascot(x.mood, 300)}</div>
</body></html>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2880, height: 1800 } });
  for (let i = 0; i < S.length; i++) {
    await p.setContent(page(S[i])); await p.waitForTimeout(400);
    await p.screenshot({ path: `${O}/DocDiff-商店图-${i + 1}.png` });
  }
  await b.close(); console.log('ok');
})();
