// 打包本机自检：node scripts/selfcheck/build.mjs <输出目录>
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../../release/审阅稿自检');
fs.mkdirSync(out, { recursive: true });
await esbuild.build({ entryPoints: [path.join(here, 'review-selfcheck.ts')], bundle: true, format: 'cjs', platform: 'node', target: 'node20', outfile: path.join(out, 'review-selfcheck.cjs'), logLevel: 'warning' });
for (const f of ['自检审阅稿.command', '自检审阅稿.cmd', '使用说明.txt']) fs.copyFileSync(path.join(here, f), path.join(out, f));
fs.chmodSync(path.join(out, '自检审阅稿.command'), 0o755);
console.log('ok', out);
