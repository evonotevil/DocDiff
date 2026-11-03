// 对对的 20 个动作（1.9 · M1 + M8）。每个动作 = 一个姿势 + 一段动效（单次 ≤ 1.2 秒，不循环抖动；打盹的 2px 呼吸除外）。
// id 也是图鉴里的记录键。动效类在 styles.css 的 “对对 · 动作” 一节；“减少动态效果”时只显示姿势。
import type { Pose } from './svg';

export interface Action { id: string; name: string; pose: Pose; anim?: string; ms: number }

export const ACTIONS: Action[] = [
  // M1 基础 7 个
  { id: 'peek', name: '探头', pose: {}, anim: 'm-peek', ms: 400 },
  { id: 'wave', name: '挥手', pose: { arms: 'wave' }, anim: 'm-wave', ms: 900 },
  { id: 'blink', name: '眨眼', pose: { blink: true }, ms: 120 },
  { id: 'jump', name: '跳一下', pose: { mood: 'cheer' }, anim: 'm-jump', ms: 450 },
  { id: 'point', name: '看过去 + 指', pose: { arms: 'point', look: -3 }, anim: 'm-lean', ms: 250 },
  { id: 'spin', name: '转一圈', pose: { mood: 'cheer' }, anim: 'm-spin', ms: 800 },
  { id: 'doze', name: '打盹', pose: { mood: 'sleepy', props: ['nightcap'] }, anim: 'm-breathe', ms: 3000 },
  // M8 新增 13 个
  { id: 'stretch', name: '伸懒腰', pose: { arms: 'stretch', blink: true }, anim: 'm-stretch', ms: 900 },
  { id: 'yawn', name: '打哈欠', pose: { mood: 'sleepy', mouth: 'yawn' }, anim: 'm-stretch', ms: 900 },
  { id: 'watch', name: '看手表', pose: { arms: 'watch', props: ['watch'], look: -2 }, ms: 800 },
  { id: 'wipe', name: '擦汗', pose: { arms: 'wipe', props: ['sweat'] }, anim: 'm-wipe', ms: 900 },
  { id: 'clap', name: '鼓掌', pose: { mood: 'cheer', arms: 'clap' }, anim: 'm-clap', ms: 800 },
  { id: 'plane', name: '扔纸飞机', pose: { arms: 'throw', props: ['plane'] }, anim: 'm-throw', ms: 1000 },
  { id: 'stamp', name: '盖章', pose: { arms: 'hold', props: ['stamp'] }, anim: 'm-squash', ms: 500 },
  { id: 'gradcap', name: '戴学士帽', pose: { mood: 'cheer', props: ['gradcap'] }, anim: 'm-jump', ms: 450 },
  { id: 'clipboard', name: '举剪贴板', pose: { arms: 'hold', props: ['clipboard'] }, anim: 'm-lift', ms: 500 },
  { id: 'sunglasses', name: '戴墨镜', pose: { front: ['sunglasses'] }, anim: 'm-lift', ms: 500 },
  { id: 'water', name: '递一杯水', pose: { arms: 'hold', props: ['water'] }, anim: 'm-lift', ms: 500 },
  { id: 'trophy', name: '举奖杯', pose: { mood: 'cheer', arms: 'holdwave', props: ['trophy'] }, anim: 'm-jump', ms: 450 },
  { id: 'cake', name: '捧蛋糕', pose: { mood: 'cheer', arms: 'hold', props: ['cake'] }, anim: 'm-lift', ms: 500 },
];
export const ACTION: Record<string, Action> = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
