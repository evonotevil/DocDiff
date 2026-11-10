#!/usr/bin/env node
// 规范 4.1「表单控件」：界面里不直接写浏览器原生控件——<select>、<input type=range|checkbox|radio|number>、<datalist>。
// 它们的长相由系统决定（展开的菜单、滑块、勾选框跟着 macOS / Windows 变），和 DocDiff 不是一套。
// 只允许出现在 renderer/src/components/Form.tsx（组件实现，外观全部由组件画）；出错页的 <details> 另外允许。
//   node scripts/check-native-controls.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '../renderer/src');
const ALLOW = new Set(['components/Form.tsx']);
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(f)) files.push(p); } };
walk(root);
const bad = [];
for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/');
  if (ALLOW.has(rel)) continue;
  readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    if (/<select\b|<datalist\b|<option\b/.test(l)) bad.push(`${rel}:${i + 1}: 原生下拉，用 Form.tsx 的 Select`);
    const m = l.match(/<input\b[^>]*type=["'{]+\s*["']?(range|checkbox|radio|number)/);
    if (m) bad.push(`${rel}:${i + 1}: 原生 ${m[1]}，用 Form.tsx 的 ${{ range: 'Slider', checkbox: 'Checkbox', radio: 'OptionCard', number: 'NumberInput' }[m[1]]}`);
    if (/<details\b/.test(l) && rel !== 'components/ErrorBoundary.tsx') bad.push(`${rel}:${i + 1}: 原生 details（只允许在出错页）`);
  });
}
if (bad.length) { console.error(`有 ${bad.length} 处原生控件：\n` + bad.join('\n')); process.exit(1); }
console.log('native controls OK');
