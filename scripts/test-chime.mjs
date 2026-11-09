// 1.9.2：审阅提示音改成预先算好的 WAV（lib/chime.ts）。检查 WAV 格式、时长、音量和音高与原来 Web Audio 版一致，
// 并确认源码里不再出现 AudioContext。用法：node scripts/test-chime.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'chime.mjs');
await esbuild.build({ entryPoints: [path.join(root, 'renderer/src/lib/chime.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent' });
const { chimeWav } = await import(out + '?t=' + Date.now());

const read = (u8) => {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const s = (o, n) => String.fromCharCode(...u8.slice(o, o + n));
  const rate = v.getUint32(24, true), n = v.getUint32(40, true) / 2;
  const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = v.getInt16(44 + i * 2, true) / 32767;
  return { riff: s(0, 4), wave: s(8, 4), fmt: v.getUint16(20, true), ch: v.getUint16(22, true), bits: v.getUint16(34, true), rate, x };
};
// 某一段里主频（过零点计数）
const freq = (x, rate, a, b) => { let z = 0; for (let i = Math.floor(a * rate) + 1; i < b * rate; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) z++; return z / 2 / (b - a); };
const peak = (x, rate, a, b) => { let m = 0; for (let i = Math.floor(a * rate); i < Math.min(x.length, b * rate); i++) m = Math.max(m, Math.abs(x[i])); return m; };

test('valid 16-bit mono PCM WAV', () => {
  for (const k of ['ok', 'no', 'hold', 'done']) {
    const w = read(chimeWav(k));
    assert.equal(w.riff, 'RIFF'); assert.equal(w.wave, 'WAVE'); assert.equal(w.fmt, 1); assert.equal(w.ch, 1); assert.equal(w.bits, 16); assert.equal(w.rate, 44100);
  }
});
test('same length as the Web Audio version (notes × 90ms + 250ms)', () => {
  const len = (k) => read(chimeWav(k)).x.length / 44100;
  assert.ok(Math.abs(len('ok') - 0.34) < 0.002); assert.ok(Math.abs(len('done') - 0.52) < 0.002);
});
test('same notes: first and second note pitch', () => {
  const { x, rate } = read(chimeWav('ok'));
  assert.ok(Math.abs(freq(x, rate, 0.02, 0.08) - 880) < 25);   // 第一个音 880Hz（第二个音 90ms 才开始）
  const { x: y } = read(chimeWav('no'));
  assert.ok(Math.abs(freq(y, rate, 0.02, 0.08) - 330) < 20);
});
test('same loudness: peak ≈ 0.12, starts and ends near silence', () => {
  const { x, rate } = read(chimeWav('hold'));
  const p = peak(x, rate, 0, 0.1);
  assert.ok(p > 0.1 && p < 0.13, String(p));
  const tail = peak(x, rate, x.length / rate - 0.02, x.length / rate);
  assert.ok(Math.abs(x[0]) < 0.001 && tail < 0.002, `${x[0]} ${tail}`);
});
test('no AudioContext anywhere in the renderer source', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const hits = walk(path.join(root, 'renderer/src')).filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => /new\s+(webkit)?AudioContext\s*\(/.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/`[^`\n]*`/g, '')));
  assert.deepEqual(hits, []);
});
