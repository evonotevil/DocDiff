const { chromium } = require('playwright');
const fs = require('fs');
const R = '/home/claude/store/raw', O = '/home/claude/store';
const F = '/home/claude/docdiff/node_modules/@fontsource/nunito/files';
const font = (w) => `@font-face{font-family:Nunito;font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(`${F}/nunito-latin-${w}-normal.woff2`).toString('base64')})}`;
const mark = fs.readFileSync('/home/claude/docdiff/renderer/src/assets/logo-mark.svg', 'utf8').replace('<svg ', '<svg width="97" height="100" ');
const img = (f) => `data:image/png;base64,${fs.readFileSync(`${R}/${f}`).toString('base64')}`;
const S = [
  { f: '1-rich.png', bg: '#58cc02', lip: '#46a302', ink: '#fff', k: '富文本对比', h: '两份文档，每一处不同都找得到', s: '删除、新增、格式变化、段落移动，一眼看清', chips: ['DOCX', 'PDF', 'TXT', '6 种对比模式'] },
  { f: '2-align.png', bg: '#1cb0f6', lip: '#1899d6', ink: '#fff', k: '点击对齐', h: 'Word 与 PDF 互比，一点就对齐', s: '悬停框选对应行，点一下两侧自动对齐到同一处', chips: ['跨格式', '段落拆分 / 合并识别', '悬停框选'] },
  { f: '3-review.png', bg: '#ffc800', lip: '#e5a500', ink: '#4b3a00', k: '修订审阅', h: '像做题一样，逐条审阅修订', s: '接受 / 拒绝 / 跳过，键盘 A · R · U 飞快处理，一键导出 Word', chips: ['进度条', '快捷键', '导出修订版 .docx'] },
  { f: '4-image.png', bg: '#ce82ff', lip: '#a568cc', ink: '#fff', k: '图像 · OCR', h: '版面和扫描件，也能比', s: '逐页像素比对找出排版变化，OCR 识别中英文扫描件', chips: ['并排 / 叠加 / 滑块', '中文 + 英文 OCR'] },
  { f: '5-dark.png', bg: '#131f24', lip: '#0b1418', ink: '#fff', k: '安心 · 舒适', h: '完全离线，深色也护眼', s: '文件从不离开你的电脑；深色纸张不刺眼，Mac 与 Windows 都能用', chips: ['100% 本地', '深色模式', 'macOS · Windows'] },
];
const page = (x, i) => `<!doctype html><html><head><style>${font(800)}${font(900)}${font(700)}
*{box-sizing:border-box;margin:0}
body{width:2880px;height:1800px;overflow:hidden;background:${x.bg};font-family:Nunito,'Noto Sans CJK SC',sans-serif;color:${x.ink};position:relative}
.dots{position:absolute;inset:0;background-image:radial-gradient(color-mix(in srgb,${x.ink} 9%,transparent) 3px,transparent 3.5px);background-size:56px 56px}
.brand{position:absolute;left:96px;top:78px;display:flex;align-items:center;gap:22px;font-weight:900;font-size:54px;letter-spacing:.5px}
.brand .pg{position:absolute;right:-1px}
.num{position:absolute;right:96px;top:92px;font-weight:900;font-size:40px;opacity:.55}
.head{position:absolute;top:170px;left:0;right:0;text-align:center}
.kick{display:inline-block;padding:14px 38px;border-radius:999px;background:${x.ink};color:${x.bg};font-weight:900;font-size:40px;margin-bottom:34px;box-shadow:0 8px 0 ${x.lip}}
h1{font-weight:900;font-size:128px;line-height:1.12;letter-spacing:2px}
p{font-weight:700;font-size:52px;margin-top:26px;opacity:.9}
.chips{margin-top:40px;display:flex;justify-content:center;gap:22px}
.chip{padding:12px 32px;border-radius:22px;border:4px solid color-mix(in srgb,${x.ink} 45%,transparent);background:color-mix(in srgb,${x.ink} 10%,transparent);font-weight:800;font-size:36px}
.win{position:absolute;left:50%;transform:translateX(-50%);top:800px;width:2300px;border-radius:40px;overflow:hidden;background:#fff;
  box-shadow:0 18px 0 ${x.lip},0 60px 120px rgba(0,0,0,.35);border:6px solid ${i === 4 ? '#37464f' : 'rgba(255,255,255,.9)'}}
.win img{display:block;width:100%}
</style></head><body><div class="dots"></div>
<div class="brand">${mark}<span>DocDiff</span></div><div class="num">${i + 1} / 5</div>
<div class="head"><div class="kick">${x.k}</div><h1>${x.h}</h1><p>${x.s}</p>
<div class="chips">${x.chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div></div>
<div class="win"><img src="${img(x.f)}"></div></body></html>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2880, height: 1800 } });
  for (let i = 0; i < S.length; i++) {
    await p.setContent(page(S[i], i)); await p.waitForTimeout(300);
    await p.screenshot({ path: `${O}/DocDiff-商店图-${i + 1}.png` });
  }
  await b.close(); console.log('ok');
})();
