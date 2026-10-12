import React from 'react';

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button type="button" className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label} />;
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
