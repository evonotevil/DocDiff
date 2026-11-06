// 对对的画法（1.9）：同一个对对，只换手臂、眼睛方向、嘴型、眨眼和小道具。
// 和 Figma 品牌页 mascot/* 组件、「方案 · 1.9」M1 / M8 的图一致。画布 120×120，道具可以画到画布外。
import { PROPS } from './props';

export type Mood = 'happy' | 'cheer' | 'think' | 'sleepy' | 'oops';
export type Arms = 'down' | 'up' | 'wave' | 'hold' | 'point' | 'face' | 'wipe' | 'clap' | 'throw' | 'stretch' | 'watch' | 'holdwave' | 'sign';
export type Mouth = 'yawn' | 'o';
export interface Pose { mood?: Mood; arms?: Arms; look?: number; mouth?: Mouth; blink?: boolean; props?: string[]; front?: string[];
  /** 1.9.1：集齐图鉴后的金色描边版（只在关于页） */
  gold?: boolean }

const K = '#4b4b4b';
const L: Record<string, string> = { down: 'M26 70 L16 84', up: 'M26 64 L12 40', point: 'M26 68 L4 66', face: 'M26 68 L34 54', clap: 'M26 70 L44 76', stretch: 'M26 60 L12 26' };
const R: Record<string, string> = { down: 'M94 70 L104 84', up: 'M94 64 L108 40', wave: 'M94 64 L110 46', hold: 'M94 70 L106 62', wipe: 'M94 62 L90 32', clap: 'M94 70 L76 76', throw: 'M94 62 L116 30', stretch: 'M94 60 L108 26' };
const PAIR: Record<string, [string, string]> = { sign: ['down', 'up'], up: ['up', 'up'], wave: ['down', 'wave'], hold: ['down', 'hold'], point: ['point', 'down'], face: ['face', 'down'], wipe: ['down', 'wipe'], clap: ['clap', 'clap'], throw: ['down', 'throw'], stretch: ['stretch', 'stretch'], watch: ['face', 'down'], holdwave: ['up', 'hold'] };

export function mascotSvg(o: Pose = {}): string {
  const mood = o.mood || 'happy';
  const arms = o.arms || (mood === 'cheer' ? 'up' : 'down');
  const look = o.look || 0;
  const eye = (cx: number) => {
    if (o.blink || mood === 'sleepy') return `<path d="M${cx - 7} 52 q7 6 14 0" stroke="${K}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
    if (mood === 'cheer') return `<path d="M${cx - 7} 54 q7 -9 14 0" stroke="${K}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
    const px = (mood === 'think' ? cx + 3 : cx + 1) + look, py = mood === 'think' ? 47 : 52;
    return `<g class="m-eye"><ellipse cx="${cx}" cy="51" rx="9.5" ry="11" fill="#fff" stroke="${K}" stroke-width="2.5"/><circle cx="${px}" cy="${py}" r="5" fill="${K}"/><circle cx="${px + 2}" cy="${py - 2.2}" r="1.8" fill="#fff"/></g>`;
  };
  // 1.9：开心时的笑脸就是一红一绿两段差异（和标志 A 一致）
  const smile = `<path d="M51 65 Q55.5 70 60.6 70" stroke="#ff4b4b" stroke-width="3.5" fill="none"/><path d="M60 70 Q64.5 70 69 65" stroke="#58cc02" stroke-width="3.5" fill="none"/><circle cx="51" cy="65" r="1.75" fill="#ff4b4b"/><circle cx="69" cy="65" r="1.75" fill="#58cc02"/>`;
  const mouth = o.mouth === 'yawn' ? `<ellipse cx="60" cy="70" rx="6" ry="7" fill="#ff4b4b" stroke="${K}" stroke-width="2.5"/>`
    : o.mouth === 'o' ? `<ellipse cx="60" cy="69" rx="4" ry="5" fill="${K}"/>`
    : mood === 'cheer' ? `<path d="M50 66 q10 14 20 0 z" fill="#ff4b4b" stroke="${K}" stroke-width="2.5" stroke-linejoin="round"/>`
    : mood === 'think' ? `<ellipse cx="62" cy="69" rx="3.5" ry="3" fill="${K}"/>`
    : mood === 'oops' ? `<path d="M52 71 q8 -7 16 0" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : mood === 'sleepy' ? `<path d="M55 68 h10" stroke="${K}" stroke-width="3" stroke-linecap="round"/>`
    : smile;
  const A = (d: string, side: string) => `<path class="m-arm m-arm-${side}" d="${d}" stroke="#58cc02" stroke-width="7" stroke-linecap="round" fill="none"/>`;
  const [la, ra] = PAIR[arms] || ['down', 'down'];
  const armsSvg = A(L[la], 'l') + A(R[ra], 'r');
  const props = o.props || [];
  const extra = (mood === 'sleepy' ? `<text class="m-z" x="92" y="30" font-size="16" font-weight="900" fill="#afafaf" font-family="Nunito, sans-serif">z</text>` : '')
    + (mood === 'think' && !props.includes('magnifier') && !props.includes('sign') ? '<circle cx="98" cy="22" r="3" fill="#afafaf"/><circle cx="106" cy="12" r="4.5" fill="#afafaf"/>' : '');
  const pr = props.map((p) => `<g class="m-prop m-prop-${p}">${PROPS[p] || ''}</g>`).join('');
  const front = (o.front || []).map((p) => PROPS[p] || '').join('');
  // 手臂挡在身前的动作（鼓掌、看表、捂脸）：手臂画在身体之后
  const inFront = arms === 'clap' || arms === 'watch' || arms === 'face';
  return `<ellipse class="m-shadow" cx="60" cy="112" rx="30" ry="4.5" fill="#000" opacity=".08"/>${inFront ? '' : armsSvg}`
    + `<rect x="40" y="100" width="14" height="10" rx="5" fill="#58a700"/><rect x="66" y="100" width="14" height="10" rx="5" fill="#58a700"/>`
    + `<path d="M32 14 h44 l18 18 v64 a8 8 0 0 1 -8 8 h-54 a8 8 0 0 1 -8 -8 v-74 a8 8 0 0 1 8 -8z" fill="${o.gold ? '#fffbea' : '#fff'}" stroke="${o.gold ? '#e5a500' : '#e5e5e5'}" stroke-width="${o.gold ? 4 : 3}"/>`
    + `<path d="M76 14 v12 a6 6 0 0 0 6 6 h12 z" fill="${o.gold ? '#ffc800' : '#58cc02'}" stroke="${o.gold ? '#e5a500' : '#58a700'}" stroke-width="2" stroke-linejoin="round"/>`
    + `${eye(49)}${eye(71)}<circle cx="38" cy="64" r="4.5" fill="#ffb3b3" opacity=".8"/><circle cx="82" cy="64" r="4.5" fill="#ffb3b3" opacity=".8"/>${mouth}`
    + `<rect x="36" y="82" width="22" height="5" rx="2.5" fill="#ffcfcf"/><rect x="62" y="82" width="22" height="5" rx="2.5" fill="#c9f2a8"/><rect x="36" y="91" width="34" height="4" rx="2" fill="#e5e5e5"/>`
    + `${inFront ? armsSvg : ''}${front}${extra}${pr}`;
}
