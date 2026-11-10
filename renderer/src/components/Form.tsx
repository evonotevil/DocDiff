import React, { useEffect, useRef, useState } from 'react';
import * as I from './icons';
import { Popover } from './Popover';

/**
 * 表单控件（设计规范 4.1「表单控件」，Figma 方案 G1–G3）。
 * 界面里不直接写 <select> / <input type=range|checkbox|radio|number>：浏览器的原生控件长相由系统决定（展开的菜单、滑块、勾选框跟着 macOS / Windows 变），
 * 和 DocDiff 不是一套。原生元素只允许出现在这个文件里，并且外观全部由这里的样式画（scripts/check-native-controls.mjs 检查）。
 */

export type SelectOption<T> = { value: T; label: React.ReactNode; /** 首字母跳转、读屏用的纯文字 */ text?: string; disabled?: boolean };

/** 下拉选择（组件 Select + SelectOption）：触发器 M 36 / S 30；展开 = 无标题 Popover，在下方 8px，宽 = 触发器宽、最少 160 */
export function Select<T extends string | number>({ value, options, onChange, size = 'm', label, disabled, className = '', title, minWidth = 160 }: {
  value: T; options: SelectOption<T>[]; onChange: (v: T) => void; size?: 'm' | 's'; label: string; disabled?: boolean; className?: string; title?: string; minWidth?: number;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(minWidth);
  const cur = options.find((o) => o.value === value);
  const show = () => { if (disabled) return; setW(Math.max(minWidth, btn.current?.offsetWidth || 0)); setOpen(true); };
  // 打开后焦点放在当前选中的一项上
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role=option]') || [])];
      (items.find((x) => x.getAttribute('aria-selected') === 'true') || items[0])?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);
  const pick = (v: T) => { setOpen(false); if (v !== value) onChange(v); btn.current?.focus(); };
  const onListKey = (e: React.KeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role=option]:not(:disabled)') || [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (k: number) => { e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, k))]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // 输入首字母跳到对应项
      const k = e.key.toLowerCase();
      const j = items.findIndex((x, n) => n > i && (x.dataset.text || '').toLowerCase().startsWith(k));
      const j2 = j >= 0 ? j : items.findIndex((x) => (x.dataset.text || '').toLowerCase().startsWith(k));
      if (j2 >= 0) go(j2);
    }
  };
  return (
    <>
      <button ref={btn} type="button" className={`sel-t ${size} ${open ? 'open' : ''} ${className}`} disabled={disabled} title={title}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); show(); } }}>
        <span className="sel-v">{cur ? cur.label : ''}</span>
        {open ? <I.IconUp /> : <I.IconDown />}
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={w} align="start" className="pop-menu sel-pop" label={label} noFocus>
        <div ref={list} role="listbox" aria-label={label} onKeyDown={onListKey}>
          {options.map((o) => (
            <button key={String(o.value)} type="button" role="option" aria-selected={o.value === value} disabled={o.disabled}
              data-text={o.text ?? (typeof o.label === 'string' ? o.label : '')}
              className={`menu-item sel-opt ${o.value === value ? 'on' : ''}`} onClick={() => pick(o.value)}>
              <span className="sel-ol">{o.label}</span>
              <span className="sel-ck" aria-hidden="true">{o.value === value && <I.IconCheck />}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

/** 输入框（组件 TextInput）：L 48（弹窗、设置）/ M 36（画布、卡片）/ S 30（审阅栏、工具栏） */
export const TextInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: 'l' | 'm' | 's'; error?: boolean }>(
  function TextInput({ size = 'm', error, className = '', ...p }, ref) {
    return <input ref={ref} {...p} className={`tin ${size} ${error ? 'err' : ''} ${className}`} aria-invalid={error || undefined} />;
  });

/** 多行输入（组件 Textarea）：TextInput 的多行形态 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }>(
  function Textarea({ error, className = '', ...p }, ref) {
    return <textarea ref={ref} {...p} className={`tin area ${error ? 'err' : ''} ${className}`} aria-invalid={error || undefined} />;
  });

/** 数字（组件 NumberInput）：TextInput M，居中、等宽数字，没有系统上下箭头；↑ ↓ 加减 1 */
export function NumberInput({ value, onChange, min, max, label, error }: { value: string; onChange: (v: string) => void; min?: number; max?: number; label: string; error?: boolean }) {
  const step = (d: number) => {
    const n = parseInt(value, 10);
    let v = (Number.isFinite(n) ? n : (min ?? 0)) + d;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    onChange(String(v));
  };
  return (
    <input className={`tin m num ${error ? 'err' : ''}`} inputMode="numeric" value={value} aria-label={label} aria-invalid={error || undefined}
      role="spinbutton" aria-valuemin={min} aria-valuemax={max} aria-valuenow={Number.isFinite(parseInt(value, 10)) ? parseInt(value, 10) : undefined}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
      onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); step(1); } else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); } }} />
  );
}

/** 复选框（组件 Checkbox）：20px；选中 Macaw 底 + 白勾；整行可点。“勾上后一起生效”的选项用它，立刻生效的设置用 Switch */
export function Checkbox({ checked, onChange, children, disabled, className = '' }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; disabled?: boolean; className?: string }) {
  return (
    <label className={`cbx ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''} ${className}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="cbx-box" aria-hidden="true">{checked && <I.IconCheck />}</span>
      <span className="cbx-t">{children}</span>
    </label>
  );
}

/** 滑块（组件 Slider）：轨道 8px Swan，走过的一段 Macaw；圆钮 24px + 3px 底边；值写在旁边的文字里 */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, label, valueText, width = 160, disabled }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; valueText?: string; width?: number; disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <input type="range" className="sld" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label} aria-valuetext={valueText}
      style={{ width, ['--v' as any]: `${pct}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
      onKeyDown={(e) => {
        // ← → 每次 5%（规范 4.1）；Home / End 由浏览器处理
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const d = ((max - min) * 0.05) * (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1);
          onChange(Math.max(min, Math.min(max, Math.round((value + d) / step) * step)));
        }
      }} />
  );
}

/** 单选卡片（组件 OptionCard）：几选一、每项有一句说明；放在 role=radiogroup 里 */
export function OptionCard({ checked, onSelect, title, children }: { checked: boolean; onSelect: () => void; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className={`opt-card ${checked ? 'on' : ''}`} onClick={onSelect}>
      <span className="oc-r" aria-hidden="true" />
      <b>{title}</b>
      {children && <span className="oc-d">{children}</span>}
    </button>
  );
}
