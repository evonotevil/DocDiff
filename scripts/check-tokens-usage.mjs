#!/usr/bin/env node
// 1.9.1：styles.css 里的字号、圆角、动画时长只用设计变量（--fs-* / --radius-* / --dur-*）。
// 例外（文档排版、等宽字体、品牌字标、“减少动态效果”的 .01ms）在行尾标 /* token-exempt: 原因 */。
//   node scripts/check-tokens-usage.mjs        检查，有写死的值就失败
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../renderer/src/styles.css'), 'utf8');
const body = css.slice(css.indexOf('/* @tokens:end */'));
const base = css.slice(0, css.indexOf('/* @tokens:end */')).split('\n').length - 1;
const bad = [];
body.split('\n').forEach((line, i) => {
  if (/token-exempt/.test(line)) return;
  const at = base + i + 1;
  const decls = line.split(/[;{}]/);
  for (const d of decls) {
    const m = d.match(/^\s*([a-z-]+)\s*:\s*(.+)$/i);
    if (!m) continue;
    const [, prop, val] = m;
    if (/^(font-size)$/.test(prop) && /\d+(\.\d+)?px/.test(val)) bad.push(`${at}: ${prop}: ${val.trim()}`);
    if (prop === 'font' && /\b\d+(\.\d+)?px/.test(val.replace(/\/[\d.]+/, ''))) bad.push(`${at}: font: ${val.trim()}`);
    if (/^border(-[a-z]+)*-radius$/.test(prop) && /\b[1-9]\d*(\.\d+)?px/.test(val)) bad.push(`${at}: ${prop}: ${val.trim()}`);
    if (/^(animation|transition)(-duration)?$/.test(prop) && /(^|[\s,])\.?\d+(\.\d+)?m?s\b/.test(val)) bad.push(`${at}: ${prop}: ${val.trim()}`);
  }
});
if (bad.length) { console.error(`styles.css 里有 ${bad.length} 处写死的字号 / 圆角 / 时长（请用 --fs-* / --radius-* / --dur-*，或标 token-exempt）：\n` + bad.join('\n')); process.exit(1); }
console.log('token usage OK');
