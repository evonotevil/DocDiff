import React from 'react';

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} role="switch" aria-checked={on} />;
}
export function Opt({ label, hint, children, disabled }: { label: string; hint?: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={`opt ${disabled ? 'disabled' : ''}`}>
      <span className="opt-text"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      {children}
    </label>
  );
}
export function Seg<T extends string | number>({ value, options, onChange, full }: { value: T; options: [T, React.ReactNode][]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <span className={`seg ${full ? 'full' : ''}`}>
      {options.map(([v, l]) => <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </span>
  );
}
export function Card({ title, right, children, className, collapsible, open, onToggle }: {
  title?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode; className?: string;
  collapsible?: boolean; open?: boolean; onToggle?: () => void;
}) {
  return (
    <section className={`card ${className || ''}`}>
      {title && (
        <header className={`card-head ${collapsible ? 'clickable' : ''}`} onClick={collapsible ? onToggle : undefined}>
          <h3>{title}</h3>
          <span className="card-right" onClick={(e) => e.stopPropagation()}>{right}</span>
          {collapsible && <span className={`chev ${open ? 'open' : ''}`}>›</span>}
        </header>
      )}
      {(!collapsible || open) && children}
    </section>
  );
}
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
