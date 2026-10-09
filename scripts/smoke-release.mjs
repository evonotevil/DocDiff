// Run on a native macOS/Windows runner against the packaged executable (Node 22+).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const executable = process.argv[2];
assert.ok(executable, 'Pass the packaged executable path');
const out = path.resolve('release/smoke');
fs.mkdirSync(out, { recursive: true });
const child = spawn(path.resolve(executable), ['--remote-debugging-port=9222'], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', socket;
child.stdout.on('data', b => { log += b; });
child.stderr.on('data', b => { log += b; });
let launchError;
child.on('error', e => { launchError = e; });
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 60; i++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw Error(`App exited early: ${child.exitCode}\n${log}`);
    try { target = (await (await fetch('http://127.0.0.1:9222/json')).json()).find(t => t.url.startsWith('app://local/index.html')); } catch {}
    if (target) break;
    await delay(500);
  }
  assert.ok(target, 'App renderer did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0; const pending = new Map();
  socket.addEventListener('message', e => {
    const m = JSON.parse(e.data); const p = pending.get(m.id);
    if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(Error(`Timed out: ${method}`)); }, 30000);
    pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  let ready = false;
  for (let i = 0; i < 40; i++) { ready = await evaluate('!!window.api && document.body.innerText.includes("DocDiff")'); if (ready) break; await delay(250); }
  assert.ok(ready, 'DocDiff UI did not render');
  const fonts = await evaluate(`(async () => {
    const results = [];
    for (const family of ['Noto Sans SC', 'Nunito']) for (const weight of [400, 700, 800, 900]) {
      if (family === 'Nunito' && weight === 400) continue;
      const text = family === 'Noto Sans SC' ? '文档比较设置关于与更新' : 'DocDiff Settings';
      const loaded = await document.fonts.load(weight + ' 16px "' + family + '"', text);
      results.push({ family, weight, loaded: loaded.length, ok: loaded.length > 0 && loaded.every(f => f.status === 'loaded') });
    }
    await document.fonts.ready; return results;
  })()`);
  assert.ok(fonts.every(f => f.ok), JSON.stringify(fonts));
  const home = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, 'home.png'), Buffer.from(home.data, 'base64'));
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.title === '设置' || b.title === 'Settings')?.click()`);
  await delay(600);
  const text = await evaluate('document.body.innerText');
  assert.ok(text.includes('关于与更新') || text.includes('About'), 'Settings/update UI missing');
  const settings = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, 'settings.png'), Buffer.from(settings.data, 'base64'));
  const update = await evaluate('window.api.checkUpdate()');
  assert.equal(update.current, JSON.parse(fs.readFileSync('package.json')).version);
  assert.ok(['latest', 'new'].includes(update.status), JSON.stringify(update));
  assert.ok(update.url.startsWith('https://github.com/evonotevil/DocDiff/releases/'), JSON.stringify(update));
  assert.ok(!/remote_font_face_source.*NOTREACHED|NOTREACHED.*remote_font_face_source/i.test(log), 'Native font assertion: ' + log);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ platform: process.platform, fonts, update }, null, 2));
  console.log('Packaged UI, fonts, settings and live update feed passed:', process.platform);
} finally {
  socket?.close(); child.kill();
  fs.writeFileSync(path.join(out, 'app.log'), log);
}
