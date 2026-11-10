#!/usr/bin/env node
// styles.css 只用设计变量（规范 4.1「所有数值只用变量」）：
//   字号 --fs-*、圆角 --radius-*、时长 --dur-*（1.9.1）；
//   间距 --space-*、控件高度 --control-*、颜色（颜色变量）、用到的变量必须有定义（1.9.4）。
// 例外（文档排版、等宽字体、品牌字标、窗口按钮区、“减少动态效果”的 .01ms）在行尾标 /* token-exempt: 原因 */。
// 间距：4px 以下的光学微调不算；负值（抵消内边距）只要绝对值在刻度上就行；clamp() / calc() 里的响应式排版不查。
//   node scripts/check-tokens-usage.mjs        检查，有写死的值就失败
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../renderer/src/styles.css'), 'utf8');
const end = css.indexOf('/* @tokens:end */');
const head = css.slice(0, end);
const body = css.slice(end);
const base = head.split('\n').length - 1;
const SCALE = new Set([4, 6, 8, 12, 16, 24, 32, 48]);
const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const bad = [];
body.split('\n').forEach((line, i) => {
  const at = base + i + 1;
  const exempt = /token-exempt/.test(line);
  // 用到但没定义的变量（例外也要查）；行内样式设置的变量（--v、--rc、--rh 等）在这里登记
  for (const m of line.matchAll(/var\((--[\w-]+)/g)) if (!defined.has(m[1]) && !['--v', '--rc', '--rh'].includes(m[1])) bad.push(`${at}: 没有定义的变量 ${m[1]}`);
  if (exempt) return;
  const decls = line.split(/[;{}]/);
  for (const d of decls) {
    const m = d.match(/^\s*([a-z-]+)\s*:\s*(.+)$/i);
    if (!m) continue;
    const [, prop, val] = m;
    if (prop.startsWith('--')) continue; // 变量定义本身（兼容层、纸面配色）
    if (/^(font-size)$/.test(prop) && /\d+(\.\d+)?px/.test(val)) bad.push(`${at}: ${prop}: ${val.trim()}`);
    if (prop === 'font' && /\b\d+(\.\d+)?px/.test(val.replace(/\/[\d.]+/, ''))) bad.push(`${at}: font: ${val.trim()}`);
    if (/^border(-[a-z]+)*-radius$/.test(prop) && /\b[1-9]\d*(\.\d+)?px/.test(val)) bad.push(`${at}: ${prop}: ${val.trim()}`);
    if (/^(animation|transition)(-duration)?$/.test(prop) && /(^|[\s,])\.?\d+(\.\d+)?m?s\b/.test(val)) bad.push(`${at}: ${prop}: ${val.trim()}`);
    // 1.9.4：间距
    if (/^((padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?|gap|row-gap|column-gap)$/.test(prop) && !/clamp\(|calc\(/.test(val)) {
      for (const x of val.matchAll(/(-?)(\d+(?:\.\d+)?)px/g)) {
        const v = +x[2];
        if (v < 4) continue;
        if (x[1] === '-' && SCALE.has(v)) continue;
        bad.push(`${at}: ${prop}: ${val.trim()}（间距用 --space-*，刻度 4 / 6 / 8 / 12 / 16 / 24 / 32 / 48）`);
        break;
      }
    }
    // 1.9.4：控件高度
    if (/^(height|min-height)$/.test(prop) && /^\s*(30|36|48)px\s*$/.test(val)) bad.push(`${at}: ${prop}: ${val.trim()}（控件高度用 --control-s / m / l）`);
    // 1.9.4：颜色
    const raw = val.replace(/var\([^)]*\)/g, '');
    if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(raw)) bad.push(`${at}: ${prop}: ${val.trim()}（颜色用颜色变量）`);
  }
});
if (bad.length) { console.error(`styles.css 里有 ${bad.length} 处没用设计变量：\n` + bad.join('\n')); process.exit(1); }
console.log('token usage OK');
