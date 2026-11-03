import React, { useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { ACTIONS } from '../lib/mascot/actions';
import { HOLIDAYS, nextDate } from '../lib/mascot/holidays';
import { mascotData, subscribe } from '../lib/mascot/store';
import { mascotSvg, type Pose } from '../lib/mascot/svg';
import { fmtMonthDay } from '../lib/i18n';

/** 图鉴里的 52 项：动作 20、节日 23、彩蛋 9（1.9 · M13） */
interface Item { id: string; group: 'act' | 'hol' | 'egg'; name: string; pose: Pose; hint: () => string }
const ACT_HINT: Record<string, string> = {
  peek: '首页见', wave: '去“关于”看看', blink: '首页安静一会儿', jump: '点点它', point: '往窗口里拖文件', spin: '多点几下', doze: '首页安静一会儿',
  stretch: '首页见', yawn: '夜深了再来', watch: '耐心等一等', wipe: '比一份大文件', clap: '审完一份再回首页', plane: '导出一次', stamp: '生成一次审阅稿',
  gradcap: '生成一次定稿', clipboard: '复制一次摘要', sunglasses: '天黑以后', water: '用久了它会提醒你', trophy: '多比几份', cake: '一年以后',
};
const MILESTONE = (n: number) => () => { const left = n - mascotData().compares; return left > 0 ? t('再比 {n} 份', { n: left }) : t('快了'); };
const EGGS: Item[] = [
  { id: 'tap', group: 'egg', name: '点一下', pose: { mood: 'cheer' }, hint: () => t('点点它') },
  { id: 'poke', group: 'egg', name: '别戳啦', pose: { mood: 'oops' }, hint: () => t('多点几下试试') },
  { id: 'name', group: 'egg', name: '跳舞', pose: { mood: 'cheer', arms: 'up' }, hint: () => t('试试在首页打它的名字') },
  { id: 'fake', group: 'egg', name: '装睡', pose: { mood: 'sleepy' }, hint: () => t('按住它别放') },
  { id: 'streak', group: 'egg', name: '击掌', pose: { mood: 'cheer', arms: 'clap' }, hint: () => t('审阅时一口气别停') },
  { id: 'sunglasses', group: 'egg', name: '墨镜', pose: { front: ['sunglasses'] }, hint: () => t('天黑以后') },
  { id: 'm10', group: 'egg', name: '第 10 份', pose: { mood: 'cheer', arms: 'holdwave', props: ['trophy'] }, hint: MILESTONE(10) },
  { id: 'm100', group: 'egg', name: '第 100 份', pose: { mood: 'cheer', arms: 'holdwave', props: ['trophy'] }, hint: MILESTONE(100) },
  { id: 'm1000', group: 'egg', name: '第 1000 份', pose: { mood: 'cheer', arms: 'holdwave', props: ['trophy'] }, hint: MILESTONE(1000) },
];
export const DEX: Item[] = [
  ...ACTIONS.map((a): Item => ({ id: 'act:' + a.id, group: 'act', name: a.name, pose: a.pose, hint: () => t(ACT_HINT[a.id] || '再找找') })),
  ...HOLIDAYS.map((h): Item => ({ id: 'hol:' + h.id, group: 'hol', name: h.name, pose: { mood: 'cheer', props: [h.prop] }, hint: () => {
    if (h.id === 'anniversary') { const days = Math.ceil((mascotData().since + 365 * 86400000 - Date.now()) / 86400000); return days > 0 ? t('还有 {n} 天', { n: days }) : t('明年见'); }
    const d = nextDate(h.id); return d ? t('{d}见', { d: fmtMonthDay(d) }) : t('明年见');
  } })),
  ...EGGS.map((e) => ({ ...e, id: 'egg:' + e.id })),
];

/** 设置 · 关于与更新 底部：“对对图鉴（18 / 52）”，点开在同一页展开 */
export function Dex() {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<'all' | 'act' | 'hol' | 'egg'>('all');
  const [, tick] = useState(0);
  useEffect(() => subscribe(() => tick((n) => n + 1)), []);
  const seen = new Set(mascotData().seen);
  const n = (g?: string) => DEX.filter((x) => (!g || x.group === g) && seen.has(x.id)).length;
  const total = (g?: string) => DEX.filter((x) => !g || x.group === g).length;
  const items = DEX.filter((x) => group === 'all' || x.group === group);
  return (
    <div className="dex">
      <button type="button" className="dex-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{t('对对图鉴')}</span><span className="dex-n">{n()} / {total()}</span><span className="grow" /><span className="dex-chev" aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="dex-body">
          <div className="dex-tabs" role="tablist">
            {([['all', t('全部'), ''], ['act', t('动作'), 'act'], ['hol', t('节日'), 'hol'], ['egg', t('彩蛋'), 'egg']] as const).map(([k, label, g]) => (
              <button key={k} type="button" role="tab" aria-selected={group === k} className={group === k ? 'on' : ''} onClick={() => setGroup(k)}>
                {label}{g ? ` ${n(g)}/${total(g)}` : ''}
              </button>
            ))}
          </div>
          <ul className="dex-grid">
            {items.map((x) => {
              const got = seen.has(x.id);
              return (
                <li key={x.id} className={`dex-card${got ? '' : ' locked'}`}>
                  <svg viewBox="-20 -32 160 160" width="64" height="64" aria-hidden dangerouslySetInnerHTML={{ __html: mascotSvg(x.pose) }} />
                  <b>{got ? t(x.name) : '？？？'}</b>
                  <small>{got ? t('已遇见') : x.hint()}</small>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
