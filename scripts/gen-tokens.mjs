#!/usr/bin/env node
// 设计 token 的唯一来源是 docs/design-tokens.json（与《DocDiff 设计规范 3.0》同步）。
// 这个脚本把它写进 renderer/src/styles.css 顶部两条标记之间；不要手改那一段。
//   node scripts/gen-tokens.mjs          写入
//   node scripts/gen-tokens.mjs --check  只检查是否同步（CI 用）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tok = JSON.parse(readFileSync(join(root, 'docs/design-tokens.json'), 'utf8'));
const cssPath = join(root, 'renderer/src/styles.css');
const START = '/* @tokens:start — 由 scripts/gen-tokens.mjs 从 docs/design-tokens.json 生成，不要手改 */';
const END = '/* @tokens:end */';

const [first, ...others] = tok.color.themes.map((t) => t.id);
const val = (v, th) => (typeof v === 'string' ? v : v[th] ?? v[first]);
const light = [], fixedLight = [], dark = [], plain = [];
for (const c of tok.color.tokens) {
  light.push(`  --${c.name}: ${val(c.value, first)};`);
  // --l-*：浅色值的常量副本。深色界面里默认仍是浅色纸，纸上的差异色要用它
  if (typeof c.value !== 'string') fixedLight.push(`  --l-${c.name}: ${val(c.value, first)};`);
  for (const th of others) if (typeof c.value !== 'string' && c.value[th] && c.value[th] !== c.value[first]) dark.push(`  --${c.name}: ${c.value[th]};`);
}
for (const s of tok.shadow?.tokens || []) {
  light.push(`  --${s.name}: ${val(s.value, first)};`);
  for (const th of others) if (typeof s.value !== 'string' && s.value[th]) dark.push(`  --${s.name}: ${s.value[th]};`);
}
for (const fam of Object.keys(tok)) {
  if (['name', 'version', 'color', 'type', 'shadow', 'meta'].includes(fam) || !tok[fam]?.tokens) continue;
  for (const x of tok[fam].tokens) plain.push(`  --${x.name}: ${x.value};`);
}
for (const [k, v] of Object.entries(tok.type.families)) plain.push(`  --font-${k}: ${v};`);

const block = [
  START,
  `:root {\n${light.join('\n')}\n${fixedLight.join('\n')}\n${plain.join('\n')}\n}`,
  ...others.map((th) => `:root[data-theme='${th}'] {\n${dark.join('\n')}\n}`),
  END,
].join('\n');

const css = readFileSync(cssPath, 'utf8');
const a = css.indexOf(START.slice(0, 16)), b = css.indexOf(END);
const next = a >= 0 && b > a ? css.slice(0, a) + block + css.slice(b + END.length) : block + '\n' + css;
if (process.argv.includes('--check')) {
  if (next !== css) { console.error('styles.css 里的 token 与 docs/design-tokens.json 不一致，请运行 npm run tokens'); process.exit(1); }
  console.log('tokens OK');
} else {
  writeFileSync(cssPath, next);
  console.log(`写入 ${tok.color.tokens.length} 个颜色、${plain.length} 个尺寸 / 时长 / 字体 token`);
}
