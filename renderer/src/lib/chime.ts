// 审阅提示音（1.9.2）。
// 1.9.1 及以前：第一次播放时 `new AudioContext()`。在 macOS 上构造 AudioContext 要同步问音频设备，
// 主线程会卡 180–320ms，正好落在第一次审阅决定上。
// 现在不再用 Web Audio：四种提示音在 JS 里直接算成很短的 WAV（同样的正弦波和音量包络），
// 用 <audio> 播放。<audio> 的加载、解码、开音频设备都在媒体线程里异步做，不阻塞主线程；
// 提示音关闭时什么都不创建。
export type ChimeKind = 'ok' | 'no' | 'hold' | 'done';

const NOTES: Record<ChimeKind, number[]> = { ok: [880, 1320], no: [330, 262], hold: [587, 587], done: [523, 659, 784, 1047] };
const RATE = 44100, STEP = 0.09, LEN = 0.25, PEAK = 0.12, FLOOR = 0.0001, ATTACK = 0.015, RELEASE = 0.22;

/** 和原来 Web Audio 版一样的包络：0.0001 → 0.12（15ms，指数）→ 0.0001（到 220ms，指数），250ms 停 */
function env(t: number) {
  if (t < 0 || t >= LEN) return 0;
  if (t < ATTACK) return FLOOR * Math.pow(PEAK / FLOOR, t / ATTACK);
  if (t < RELEASE) return PEAK * Math.pow(FLOOR / PEAK, (t - ATTACK) / (RELEASE - ATTACK));
  return FLOOR;
}

/** 生成 16 位单声道 PCM 的 WAV 字节（导出给测试用） */
export function chimeWav(kind: ChimeKind): Uint8Array {
  const notes = NOTES[kind];
  const n = Math.ceil(((notes.length - 1) * STEP + LEN) * RATE);
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let s = 0;
    notes.forEach((f, k) => { const tr = t - k * STEP; if (tr >= 0 && tr < LEN) s += env(tr) * Math.sin(2 * Math.PI * f * tr); });
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
  }
  return new Uint8Array(buf);
}

const players = new Map<ChimeKind, HTMLAudioElement>();
function player(kind: ChimeKind) {
  let a = players.get(kind);
  if (!a) {
    a = new Audio(URL.createObjectURL(new Blob([chimeWav(kind) as BlobPart], { type: 'audio/wav' })));
    a.preload = 'auto';
    players.set(kind, a);
  }
  return a;
}

/** 提示音打开、进入修订审阅时在空闲时间先准备好（只是算 WAV、建 <audio>，不开音频设备） */
export function warmChimes() {
  const go = () => { for (const k of Object.keys(NOTES) as ChimeKind[]) player(k); };
  const ric = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => void) | undefined;
  if (ric) ric(go, { timeout: 2000 }); else setTimeout(go, 200);
}

export function chime(kind: ChimeKind) {
  try {
    const a = player(kind);
    if (!a.paused) a.pause();
    a.currentTime = 0;
    void a.play().catch(() => {});
  } catch {}
}
