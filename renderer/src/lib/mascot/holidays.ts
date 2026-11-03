// 节日对对（1.9 · M9）：22 个节日 + “我们的纪念日”，对所有人出现，不按地区筛选。
// 宗教节日只用中性道具和通用祝福。日期在本机算；每年不固定的节日查 holidays.data.ts（2026–2036）。
import { t } from '../i18n';
import { MOVABLE } from './holidays.data';
import { mascotData } from './store';

export interface Holiday { id: string; name: string; prop: string; line: string }
const H = (id: string, name: string, prop: string, line: string): Holiday => ({ id, name, prop, line });
export const HOLIDAYS: Holiday[] = [
  H('newYear', '元旦', 'fireworks', '新年快乐！新的一年也一起仔细看。'),
  H('springFestival', '春节', 'lantern', '新春快乐，万事顺意！'),
  H('lantern', '元宵节', 'tangyuan', '元宵快乐，吃汤圆了吗？'),
  H('valentine', '情人节', 'heart', '今天也要对文件温柔一点。'),
  H('pi', 'π 日', 'pie', '3.14159……今天是 π 日。'),
  H('aprilFools', '愚人节', 'disguise', '我是对对……的表哥。'),
  H('easter', '复活节', 'egg', '复活节快乐！找到彩蛋了吗？'),
  H('songkran', '泼水节', 'splash', '泼水节快乐！不会泼到你的文件。'),
  H('earthDay', '地球日', 'sprout', '这份能少打印一页就好啦。'),
  H('holi', '洒红节', 'holi', '洒红节快乐！我被染成彩色了。'),
  H('eid', '开斋节', 'fanous', '节日快乐，愿你平安喜乐。'),
  H('vesak', '卫塞节', 'lotus', '卫塞节安康。'),
  H('childrensDay', '儿童节', 'balloon', '儿童节快乐！今天可以多玩一会儿。'),
  H('dragonBoat', '端午节', 'zongzi', '端午安康，来个粽子？'),
  H('qixi', '七夕', 'stars', '七夕快乐。'),
  H('midAutumn', '中秋节', 'mooncake', '中秋快乐，月饼分你一半。'),
  H('diwali', '排灯节', 'diya', '排灯节快乐，愿光明常在。'),
  H('halloween', '万圣节', 'witch', '不给糖就捣乱……开玩笑的，开始吧。'),
  H('thanksgiving', '感恩节', 'harvestpie', '谢谢你一直用我。'),
  H('hanukkah', '光明节', 'top', '节日快乐！'),
  H('christmas', '圣诞节', 'santa', '节日快乐！'),
  H('newYearsEve', '跨年', 'party', '今年最后一份啦，辛苦了一整年。'),
  H('anniversary', '我们的纪念日', 'cake', '我们认识一周年啦！'),
];

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (s: string, days: number) => { const [y, m, d] = s.split('-').map(Number); return key(new Date(y, m - 1, d + days)); };
/** 节日当天前后的窗口（前 a 天到后 b 天） */
const inWin = (today: string, day: string | undefined, a = 0, b = 0) => !!day && today >= shift(day, -a) && today <= shift(day, b);

/** 这一天命中的所有节日 id */
export function hitsOn(now: Date): string[] {
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate(), k = key(now);
  const mv = MOVABLE[y] || {};
  const thanks = (() => { const first = new Date(y, 10, 1).getDay(); return key(new Date(y, 10, 1 + ((4 - first + 7) % 7) + 21)); })();
  const since = new Date(mascotData().since);
  const years = y - since.getFullYear();
  const hit: Record<string, boolean> = {
    newYear: m === 1 && d === 1,
    springFestival: inWin(k, mv.springFestival, 1, 1),
    lantern: inWin(k, mv.lantern),
    valentine: m === 2 && d === 14,
    pi: m === 3 && d === 14,
    aprilFools: m === 4 && d === 1,
    easter: inWin(k, mv.easter),
    songkran: m === 4 && d >= 13 && d <= 15,
    earthDay: m === 4 && d === 22,
    holi: inWin(k, mv.holi, 0, 1),
    eid: inWin(k, mv.eid, 0, 1),
    vesak: inWin(k, mv.vesak, 1, 1),
    childrensDay: m === 6 && d === 1,
    dragonBoat: inWin(k, mv.dragonBoat),
    qixi: inWin(k, mv.qixi),
    midAutumn: inWin(k, mv.midAutumn),
    diwali: inWin(k, mv.diwali, 1, 0),
    halloween: m === 10 && d === 31,
    thanksgiving: k === thanks,
    hanukkah: inWin(k, mv.hanukkah, 1, 0),
    christmas: m === 12 && (d === 24 || d === 25),
    newYearsEve: m === 12 && d === 31,
    anniversary: years >= 1 && m === since.getMonth() + 1 && d === since.getDate(),
  };
  return HOLIDAYS.filter((x) => hit[x.id]).map((x) => x.id);
}

/** 今天是哪个节日（没有就是 null）。同一天撞上两个时按上面的顺序取第一个 */
export function holidayOn(now = new Date()): (Holiday & { text: string }) | null {
  const id = hitsOn(now)[0];
  const h = HOLIDAYS.find((x) => x.id === id);
  if (!h) return null;
  const since = new Date(mascotData().since);
  const years = now.getFullYear() - since.getFullYear();
  const text = h.id === 'anniversary' && years > 1 ? t('我们认识 {n} 年啦！', { n: years }) : t(h.line);
  return { ...h, text };
}

/** 下一次是哪天（图鉴里“还没见过”的提示用）；一年多内都没有就返回 null */
export function nextDate(id: string, from = new Date()): Date | null {
  for (let i = 0; i < 400; i++) { const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i); if (hitsOn(d).includes(id)) return d; }
  return null;
}
