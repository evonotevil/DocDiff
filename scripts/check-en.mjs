// 英文文案自动检查（1.9）：术语、禁用词、全角标点、句首大写。node scripts/check-en.mjs
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'en-dict.mjs');
await esbuild.build({ stdin: { contents: "export { EN_DICT } from './renderer/src/lib/dict.en'; export { EN_19 } from './renderer/src/lib/dict.en.19'; export { EN_191 } from './renderer/src/lib/dict.en.191'; export { EN_195 } from './renderer/src/lib/dict.en.195';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'warning' });
const { EN_DICT, EN_19, EN_191, EN_195 } = await import('file://' + out);
const EN = { ...EN_DICT, ...EN_19, ...EN_191, ...EN_195 };
const rules = [
  ['old term', /\breview (copy|draft)\b|\bfinal (version|copy)\b|\breviewed final\b|\bon hold\b|\bas hold\b|\brich text\b|\bfile details\b|\brevision author\b/i],
  ['old term (case)', /\bHold\b|\bTheirs\b/],
  ['banned word', /\b(please|successfully|sorry)\b/i],
  ['full-width punctuation', /[，。：；！？（）【】「」、]/],
  ['Title Case', /^(?:[A-Z][a-z]+ ){2,}[A-Z][a-z]+$/],
];
// 专有名词（节日名）不算 Title Case
const skip = new Set(['语言 / Language', '中文', '春节', '端午节', '元宵节', '中秋节', '元旦', '跨年', '万圣节', '感恩节', '圣诞节', '儿童节', '情人节', '愚人节', '地球日', '复活节', '开斋节']);
let bad = 0;
for (const [k, v] of Object.entries(EN)) {
  if (skip.has(k) || /[一-鿿]/.test(k) === false) continue;
  for (const [name, re] of rules) if (re.test(v)) { bad++; console.log(`${name.padEnd(22)} ${k} → ${v}`); }
}
console.log(bad ? `\n${bad} 处需要改` : '英文文案检查通过');
process.exit(bad ? 1 : 0);
