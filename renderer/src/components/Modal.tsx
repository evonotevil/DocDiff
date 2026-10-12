import React, { useEffect, useRef } from 'react';
import { t } from '../lib/i18n';
import * as I from './icons';

/**
 * 统一的弹窗：role="dialog" + aria-modal，打开时把焦点放进来，Tab 只在弹窗里循环，
 * Esc 关闭，关闭后焦点回到打开它的那个按钮。
 */
export function Modal({ title, onClose, children, className, labelledIcon, footer }: {
  title: React.ReactNode; onClose: () => void; children: React.ReactNode; className?: string; labelledIcon?: React.ReactNode; footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const focusables = () => Array.from(root?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])') || []).filter((e) => e.offsetParent !== null);
    const first = root?.querySelector<HTMLElement>('[autofocus], .modal-body input, .modal-body textarea') || root?.querySelector<HTMLElement>('.modal-body button:not([disabled])') || focusables()[0];
    requestAnimationFrame(() => (first || root)?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${className || ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h3 id={titleId}>{labelledIcon}{title}</h3>
          <button className="btn sm plain icon" onClick={onClose} title={t('关闭（Esc）')} aria-label={t('关闭')}><I.IconX /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="acts">{footer}</div>}
      </div>
    </div>
  );
}
