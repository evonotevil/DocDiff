// 对对在首页说的话（1.9 · M7 / M11）：按时间和场景挑一句，只在本机判断。
// 中文为键，英文在 dict.en.ts 里按英文重新写（不是翻译）。
import { t } from '../i18n';
import { todayCount } from './store';
import type { Pose } from './svg';
import { holidayOn } from './holidays';
import { markSeen } from './store';

export interface Line { text: string; pose?: Pose; act?: string }

/** justDone：刚审完一份回到首页 */
export function homeLine(now = new Date(), justDone = false): Line {
  if (justDone) return { text: t('上一份审完了，干得漂亮。'), act: 'clap' };
  // 节日：只换道具和一句话（第一次见到时记进图鉴）
  const hol = holidayOn(now);
  if (hol) { markSeen('hol:' + hol.id); return { text: hol.text, pose: { mood: 'cheer', props: [hol.prop] } }; }
  const h = now.getHours(), wd = now.getDay(), n = todayCount();
  const pool: Line[] = [{ text: t('把两份文件拖进来，我帮你一处处找。') }];
  if (h >= 6 && h < 10) pool.push({ text: t('早上好！今天要比哪两份？'), pose: { arms: 'hold', props: ['coffee'] } });
  if (h === 12) pool.push({ text: t('吃午饭了吗？') });
  if (h >= 13 && h < 18) pool.push({ text: t('下午也要仔细哦。') });
  if (h >= 22 || h < 5) pool.push(h >= 23 || h < 5 ? { text: t('这么晚还在改合同，辛苦啦。'), act: 'yawn' } : { text: t('这么晚还在改合同，辛苦啦。'), pose: { props: ['nightcap'] } });
  if (wd === 5) pool.push({ text: t('周五了，比完这份就收工？') });
  if (wd === 1) pool.push({ text: t('新的一周，慢慢来。') });
  if (n >= 2) pool.push({ text: t('今天第 {n} 份啦。', { n: n + 1 }) });
  // 和时间有关的话优先：有就不说通用那句
  const special = pool.slice(1);
  const from = special.length ? special : pool;
  return from[Math.floor(Math.random() * from.length)];
}

/** 点它时换的话 */
export const POKE = ['嘿！', '我在呢。', '今天也一起仔细看。', '找差异是我的强项。', '有我在，一处都跑不掉。'];
