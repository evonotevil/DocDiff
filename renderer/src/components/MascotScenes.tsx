import React, { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { kbd } from '../lib/platform';
import { Mascot, Bubble, useFade, useMascotOn } from './Mascot';
import { homeLine, POKE } from '../lib/mascot/lines';
import { markSeen, gate, careAllowed, careShown, careOffToday } from '../lib/mascot/store';
import type { Pose } from '../lib/mascot/svg';

interface Shot { act?: string; pose?: Pose; mood?: 'happy' | 'cheer' | 'think' | 'sleepy' | 'oops'; line?: string; n: number }
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/**
 * 首页：对对从底栏上沿探头（1.9 · M3 / M7 / M12）。
 * 每次打开随机一个出场动作 + 一句话；拖文件时看向放置区；两份到齐时欢呼；3 分钟没动打盹。
 * 点它跳一下换句话；连点 5 下、长按 2 秒、在首页键入它的名字各有彩蛋。不挡按钮，不接收拖放。
 */
type PeekProps = { ready: boolean; error: boolean; justDone: boolean; narrow: boolean;
  /** 1.9.1 底部层级：提示条出现时气泡先收起，探头不动 */
  quiet?: boolean };
export function HomePeek(p: PeekProps) { return useMascotOn() ? <HomePeekInner {...p} /> : null; }
function HomePeekInner({ ready, error, justDone, narrow, quiet }: PeekProps) {
  const on = true;
  const n = useRef(0);
  const shot = (s: Omit<Shot, 'n'>) => setShot({ ...s, n: ++n.current });
  const [s, setShot] = useState<Shot>(() => {
    const l = homeLine(new Date(), justDone, document.documentElement.dataset.theme === 'dark');
    return { act: l.act || (l.pose ? 'peek' : pick(['peek', 'wave', 'blink', 'jump', 'stretch'])), pose: l.pose, line: l.text, n: 0 };
  });
  const [drag, setDrag] = useState(false);
  const [doze, setDoze] = useState(false);
  const bubble = useFade(s.line ? `${s.n}|${s.line}` : null, 4000);

  // 拖文件进窗口：眼睛看过去、抬手指向放置区
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => { if (!e.dataTransfer?.types.includes('Files')) return; depth++; setDrag(true); };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDrag(false); };
    const drop = () => { depth = 0; setDrag(false); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);
  const first = useRef(true);
  useEffect(() => { if (first.current) return; if (ready) shot({ act: 'jump', mood: 'cheer', line: t('齐了！按 Enter 开始') }); }, [ready]);
  useEffect(() => { if (first.current) return; if (error) shot({ mood: 'oops', line: t('这个文件我打不开…') }); }, [error]);
  useEffect(() => {
    first.current = false;
    markSeen('act:peek');
    if (s.pose?.props?.includes('cake')) markSeen('act:cake');
  }, []);
  useEffect(() => { if (drag) markSeen('act:point'); }, [drag]);

  // 3 分钟没动：戴睡帽打盹；一动就醒、眨眨眼
  useEffect(() => {
    let t0: any;
    const arm = () => { clearTimeout(t0); t0 = setTimeout(() => setDoze(true), 180000); };
    const wake = () => { setDoze((d) => { if (d) shot({ act: 'blink' }); return false; }); arm(); };
    arm();
    window.addEventListener('pointermove', wake); window.addEventListener('keydown', wake);
    return () => { clearTimeout(t0); window.removeEventListener('pointermove', wake); window.removeEventListener('keydown', wake); };
  }, []);

  // 彩蛋：在首页键入 duidui / diffy
  useEffect(() => {
    let buf = '';
    const key = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(tg.tagName) || tg.isContentEditable || e.key.length !== 1) return;
      buf = (buf + e.key.toLowerCase()).slice(-6);
      if (buf.endsWith('duidui') || buf.endsWith('diffy')) { buf = ''; markSeen('egg:name'); shot({ act: 'spin', line: t('被你发现啦！') }); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // 点它 / 连点 5 下 / 长按 2 秒
  const clicks = useRef<number[]>([]);
  const press = useRef<any>(0);
  const longDone = useRef(false);
  const onDown = () => { longDone.current = false; press.current = setTimeout(() => { longDone.current = true; markSeen('egg:fake'); shot({ mood: 'sleepy', line: t('……（偷偷睁一只眼）') }); }, 2000); };
  const onUp = () => clearTimeout(press.current);
  const onClick = () => {
    if (longDone.current) return;
    const now = Date.now();
    clicks.current = [...clicks.current.filter((x) => now - x < 2000), now];
    if (clicks.current.length >= 5) { clicks.current = []; markSeen('egg:poke'); shot({ act: 'spin', line: t('别戳啦，痒～') }); return; }
    markSeen('egg:tap');
    shot({ act: 'jump', line: t(pick(POKE)) });
  };

  if (!on) return null;
  const cur: Shot = doze ? { act: 'doze', n: -1 } : drag ? { pose: { arms: 'point', look: -3 }, line: t('放这儿！'), n: -2 } : s;
  const text = doze ? null : drag ? t('放这儿！') : bubble ? bubble.slice(bubble.indexOf('|') + 1) : null;
  return (
    <div className={`home-peek${narrow ? ' narrow' : ''}`}>
      <div className="peek-clip">
        <div className="peek-body" onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={onUp} onClick={onClick}>
          <Mascot size={72} act={cur.act} pose={cur.pose} mood={cur.mood} alive={!doze} replay={cur.n} />
        </div>
      </div>
      {text && !narrow && !quiet && <Bubble key={s.n + (drag ? 'd' : '')} text={text} />}
    </div>
  );
}

/**
 * 审阅时在检查器右下角探头 1.5 秒（1.9 · M4 / M12）：过半、最后一处、连续 20 处的击掌。
 * 由 App 在决定后调用 cue()；连续快速决定（< 0.8 秒一次）时等停下再出来。
 */
export function useReviewPeek() {
  const [cue, setCue] = useState<null | { act: string; line: string; n: number }>(null);
  const pending = useRef<null | { act: string; line: string; kind: string }>(null);
  const timer = useRef<any>(0);
  const hide = useRef<any>(0);
  const show = () => {
    const p = pending.current; pending.current = null;
    if (!p || !gate('review-peek:' + p.kind) || !gate('ambient')) return;
    setCue({ act: p.act, line: p.line, n: Date.now() });
    clearTimeout(hide.current); hide.current = setTimeout(() => setCue(null), 1500);
  };
  const schedule = () => { clearTimeout(timer.current); timer.current = setTimeout(show, 800); };
  const fire = (c: { act: string; line: string }, kind: string) => { pending.current = { ...c, kind }; schedule(); };
  /** 又做了一个决定：还在连按就往后推 */
  const nudge = () => { if (pending.current) schedule(); };
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(hide.current); }, []);
  return { cue, fire, nudge };
}

export function ReviewPeek({ cue }: { cue: { act: string; line: string; n: number } | null }) {
  const on = useMascotOn();
  if (!on || !cue) return null;
  return (
    <div className="review-peek" key={cue.n}>
      <Bubble text={cue.line} side="left" />
      <div className="peek-clip"><div className="peek-body"><Mascot size={56} act={cue.act} /></div></div>
    </div>
  );
}

/** 等待时陪着你（1.9 · M11）：比较 0–5 秒思考，5 秒后看手表，15 秒后擦汗；OCR 拿放大镜慢慢移动 */
/** 1.9.1：等待超过 5 秒，对对举着小牌子讲一条技巧，每 6 秒换一条 */
const TIPS = [
  '按 J / K 在修订之间跳转',
  '修订审阅里按 A 接受、R 拒绝、H 待议',
  '做错了按 U 撤销刚才的决定',
  '{find} 在两侧文档里查找',
  '把对方的新稿直接拖到首页，DocDiff 会认出是哪份往来稿',
  '在往来稿里点版本片，可以挑任意两版来比',
  '在版本链里给每一版起个名字，翻起来更好认',
  '比较设置里可以忽略全角 / 半角标点和引号样式',
  '打开「只看有变化的段落」，没改的内容会折起来',
  '按 N 给当前这处修订写备注',
  '把标准合同存成模板，对方改稿来了只放对方的文件',
  '{tabs} 切换比较模式',
];
function useTip(on: boolean) {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [i, setI] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => { if (!on || reduce) return; const id = setInterval(() => setI((x) => (x + 1) % TIPS.length), 6000); return () => clearInterval(id); }, [on, reduce]);
  return { i, text: t(TIPS[i], { find: kbd('mod+F'), tabs: kbd('mod+1') + ' – ' + kbd('mod+6') }) };
}
export function WaitMascot({ kind, title }: { kind: 'compare' | 'ocr'; title: string }) {
  const on = useMascotOn();
  const [sec, setSec] = useState(0);
  useEffect(() => { const t0 = Date.now(); const id = setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 500); return () => clearInterval(id); }, []);
  const long = sec >= 5;
  const tip = useTip(on && long);
  if (!on) return <><Mascot mood="think" size={96} /><h2>{title}</h2></>;
  const tipEl = long && <div className="wait-tip" role="status" key={tip.i}>{t('小技巧：{x}', { x: tip.text })}</div>;
  if (kind === 'ocr') return <><Mascot size={96} className="m-scan" pose={long ? { mood: 'think', arms: 'sign', props: ['sign'] } : { mood: 'think', arms: 'hold', props: ['magnifier'] }} /><h2>{title}</h2>{tipEl}</>;
  return (
    <>
      {/* 5 秒、15 秒时先看一眼表 / 擦一把汗（图鉴里的两个动作），然后举起牌子 */}
      {(() => { const act = sec >= 15 && sec < 17 ? 'wipe' : sec >= 5 && sec < 7 ? 'watch' : undefined;
        return <Mascot size={96} mood="think" act={act} replay={act ? (sec >= 15 ? 2 : 1) : 0} pose={long && !act ? { mood: 'think', arms: 'sign', props: ['sign'] } : undefined} />; })()}
      <h2>{sec >= 15 ? t('这份有点长，马上好') : long ? t('还差一点…') : title}</h2>
      {tipEl}
    </>
  );
}

/** 用久了提醒歇一歇（1.9 · M11）：按前台使用时间算，2 小时一次，一天最多两次；审阅中途不打断 */
export function useCare(canShow: boolean, on: boolean) {
  const [due, setDue] = useState(false);
  const [open, setOpen] = useState(false);
  const active = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) active.current += 60000;
      if (active.current >= 2 * 3600000) { active.current = 0; setDue(true); }
    }, 60000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (due && canShow && on && careAllowed()) { careShown(); setDue(false); setOpen(true); markSeen('act:water'); }
  }, [due, canShow, on]);
  const card = open ? (
    <div className="care-card" role="status" aria-live="polite">
      <Mascot size={56} act="water" />
      <div className="care-b">
        <b>{t('已经连续 2 小时啦，喝口水、动一动？')}</b>
        <div className="care-acts">
          <button type="button" className="btn sm primary" onClick={() => setOpen(false)}>{t('好的')}</button>
          <button type="button" className="btn sm plain" onClick={() => { careOffToday(); setOpen(false); }}>{t('今天不提醒')}</button>
        </div>
      </div>
    </div>
  ) : null;
  return card;
}
