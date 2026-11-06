import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { mascotSvg, type Mood, type Pose } from '../lib/mascot/svg';
import { ACTION } from '../lib/mascot/actions';
import { markSeen } from '../lib/mascot/store';

export type { Mood, Pose };

/** 设置 · 通用「让对对出来走走」（1.9，默认开）。关掉时只保留 1.8 已有的出场，不带新动作和道具 */
export const MascotOn = createContext(true);
export const useMascotOn = () => useContext(MascotOn);
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 原创吉祥物“对对”：一张会笑的纸。
 *  - mood：五种表情（1.8 起）；
 *  - act：1.9 的 20 个动作之一（姿势 + 一次动效），开关关掉时退回 mood；
 *  - pose：直接给姿势（手臂、视线、道具……）；
 *  - alive：每 4–7 秒眨一次眼。
 * 图形和 Figma 品牌页 mascot/* 组件一致；纯装饰，不进读屏顺序。
 */
export function Mascot({ mood = 'happy', size = 120, className = '', act, pose, alive, replay }: {
  mood?: Mood; size?: number; className?: string; act?: string; pose?: Pose; alive?: boolean;
  /** 换一个值就重放一次动效 */
  replay?: number;
}) {
  const on = useMascotOn();
  const a = on && act ? ACTION[act] : undefined;
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!alive || reduced()) return;
    let t: any, u: any;
    const loop = () => { t = setTimeout(() => { setBlink(true); u = setTimeout(() => { setBlink(false); loop(); }, 120); }, 4000 + Math.random() * 3000); };
    loop();
    return () => { clearTimeout(t); clearTimeout(u); };
  }, [alive]);
  // 第一次见到某个动作就记进图鉴（只在开关打开时）
  useEffect(() => { if (a) markSeen('act:' + a.id); }, [a?.id]);
  const p: Pose = { mood, ...(on ? pose : undefined), ...(a ? a.pose : undefined) };
  if (blink && !p.blink && p.mood !== 'cheer' && p.mood !== 'sleepy') p.blink = true;
  const html = useMemo(() => mascotSvg(p), [JSON.stringify(p)]);
  const anim = a?.anim || '';
  return (
    <span key={replay} className={`mascot ${anim} ${className}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 120 120" width={size} height={size} overflow="visible" dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}

/** 对对旁边的一句话：4 秒后淡出（规范：说明只一行） */
export function Bubble({ text, side = 'right' }: { text: string; side?: 'right' | 'left' | 'top' }) {
  return <span className={`m-bubble ${side}`} role="status" aria-live="polite">{text}</span>;
}

/** 一段时间后自动收起的值（气泡用） */
export function useFade<T>(v: T | null, ms = 4000): T | null {
  const [cur, setCur] = useState<T | null>(v);
  const t = useRef<any>(0);
  useEffect(() => { setCur(v); clearTimeout(t.current); if (v !== null) t.current = setTimeout(() => setCur(null), ms); return () => clearTimeout(t.current); }, [v]);
  return cur;
}

export function Confetti({ n = 70 }: { n?: number }) {
  const colors = ['#58cc02', '#1cb0f6', '#ffc800', '#ff4b4b', '#ce82ff', '#ff9600'];
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{
          left: `${(i * 37) % 100}%`, background: colors[i % colors.length],
          animationDelay: `${(i % 14) * 0.07}s`, animationDuration: `${1.6 + (i % 5) * 0.25}s`,
          transform: `rotate(${i * 29}deg)`, width: 6 + (i % 3) * 3, height: 10 + (i % 4) * 2,
        }} />
      ))}
    </div>
  );
}
