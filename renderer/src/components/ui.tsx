import React from 'react';
import * as I from './icons';

export function Switch({ on, onChange, disabled, label, size }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; size?: 'sm' }) {
  return <button type="button" className={`switch ${on ? 'on' : ''} ${size || ''}`} disabled={disabled} onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label} />;
}
export function Opt({ label, hint, children, disabled }: { label: string; hint?: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={`opt ${disabled ? 'disabled' : ''}`}>
      <span className="opt-text"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      {children}
    </label>
  );
}
export function Seg<T extends string | number>({ value, options, onChange, full, label }: { value: T; options: [T, React.ReactNode][]; onChange: (v: T) => void; full?: boolean; label?: string }) {
  return (
    <span className={`seg ${full ? 'full' : ''}`} role="group" aria-label={label}>
      {options.map(([v, l]) => <button type="button" key={String(v)} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}
    </span>
  );
}
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** 窗口宽度是否满足某个媒体查询（用来在窄窗口下自动收起侧栏） */
export function useMedia(q: string): boolean {
  const [m, setM] = React.useState(() => matchMedia(q).matches);
  React.useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** 文件名拆成两段：开头可被省略号截掉，结尾（扩展名前 6 个字 + 扩展名）永远完整显示 */
export function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
  const stem = ext ? name.slice(0, dot) : name;
  const chars = Array.from(stem);
  if (chars.length <= 6) return ['', stem + ext];
  return [chars.slice(0, -6).join(''), chars.slice(-6).join('') + ext];
}
/** 中间省略的文件名（1.8 beta.3）：宽度不够时省略号出现在中间，扩展名和结尾几个字始终可见。悬停看全名 */
export function MidName({ name, className, title }: { name: string; className?: string; title?: string | false }) {
  const [h, tl] = splitName(name);
  return <span className={`mid-name ${className || ''}`} title={title === false ? undefined : title ?? name}><span className="mn-h">{h}</span><span className="mn-t">{tl}</span></span>;
}
/** 文件类型标签（DOCX / PDF / TXT），固定宽度，保证同一列对齐 */
export function TypeTag({ type }: { type: string }) {
  const k = (type || 'docx').toLowerCase().replace(/^md$/, 'txt');
  return <span className={`badge ${k}`} aria-hidden="true">{k.toUpperCase()}</span>;
}

/** “ⓘ”悬停说明（beta.7 · 设置与首页排布）：说明文字最多一行，其余放进悬停 / 聚焦时出现的深色气泡 */
export function Info({ children, label }: { children: React.ReactNode; label: string }) {
  return <span className="qtip" tabIndex={0} aria-label={label}><I.IconInfo /><span className="qtip-b" role="tooltip">{children}</span></span>;
}
