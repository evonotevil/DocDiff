import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * 弹出层（规范 3.0 · Popover）：白底 + 2px 边 + 浮层阴影，圆角 18，宽 300–360。
 * 从触发按钮下方弹出；改动即时生效，没有“确定”；Esc 或点外面关闭，焦点回到触发按钮。
 */
export function Popover({ anchor, open, onClose, title, right, width = 340, align = 'end', children, className = '' }: {
  anchor: React.RefObject<HTMLElement>; open: boolean; onClose: () => void;
  title?: React.ReactNode; right?: React.ReactNode; width?: number; align?: 'start' | 'end';
  children: React.ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const W = window.innerWidth, H = window.innerHeight;
      let left = align === 'end' ? r.right - width : r.left;
      left = Math.max(8, Math.min(W - width - 8, left));
      const below = r.bottom + 8;
      // 放不下时向上弹
      const up = H - below < 220 && r.top > H - below;
      setPos(up ? { top: Math.max(8, r.top - 8 - Math.min(H * 0.7, 520)), left, maxH: Math.min(H * 0.7, r.top - 16) } : { top: below, left, maxH: H - below - 12 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, width, align]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const tg = e.target as Node;
      if (ref.current?.contains(tg) || anchor.current?.contains(tg)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchor.current?.focus(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [open, onClose]);
  if (!open || !pos) return null;
  return (
    <div ref={ref} tabIndex={-1} className={`pop ${className}`} role="dialog" aria-label={typeof title === 'string' ? title : undefined}
      style={{ top: pos.top, left: pos.left, width, maxHeight: pos.maxH }}>
      {title && <div className="pop-h"><span className="pop-t">{title}</span>{right && <span className="pop-r">{right}</span>}</div>}
      <div className="pop-b">{children}</div>
    </div>
  );
}

/** “…”菜单里的一项 */
export function MenuItem({ icon, children, onClick, tone }: { icon?: React.ReactNode; children: React.ReactNode; onClick: () => void; tone?: 'danger' }) {
  return <button type="button" className={`menu-item ${tone || ''}`} onClick={onClick}>{icon}{children}</button>;
}
