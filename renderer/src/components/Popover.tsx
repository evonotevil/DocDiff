import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * 弹出层（规范 3.0 · Popover）：白底 + 2px 边 + 浮层阴影，圆角 18，宽 300–360。
 * 从触发按钮下方弹出；改动即时生效，没有“确定”；Esc 或点外面关闭，焦点回到触发按钮。
 */
export function Popover({ anchor, open, onClose, title, right, width = 340, align = 'end', children, className = '', noFocus, label }: {
  /** 只是说明（如审阅稿首次提示）：打开时不抢焦点 */
  noFocus?: boolean;
  /** 标题不是纯文字时的无障碍名称 */
  label?: string;
  anchor: React.RefObject<HTMLElement>; open: boolean; onClose: () => void;
  title?: React.ReactNode; right?: React.ReactNode; width?: number; align?: 'start' | 'end';
  children: React.ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxH: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      if (!anchor.current) return; // 触发按钮已经卸载（比如切了模式）
      const r = anchor.current.getBoundingClientRect();
      const W = window.innerWidth, H = window.innerHeight;
      let left = align === 'end' ? r.right - width : r.left;
      left = Math.max(8, Math.min(W - width - 8, left));
      const below = r.bottom + 8;
      // 放不下时向上弹：用 bottom 贴住按钮上方 8px，高度按内容往上长（beta.7；以前按最大高度推，短菜单会飘到屏幕顶上）
      const up = H - below < 220 && r.top > H - below;
      setPos(up ? { bottom: H - r.top + 8, left, maxH: Math.min(H * 0.7, r.top - 16), up } : { top: below, left, maxH: H - below - 12, up });
    };
    // 滚动时跟着按钮走；按钮被滚出它所在的滚动区（或窗口）就关掉，不让菜单孤零零地飘着（1.9 · QA P2）
    const onScroll = (e: Event) => {
      const a = anchor.current;
      if (!a || (e.target instanceof Node && ref.current?.contains(e.target))) return;
      const r = a.getBoundingClientRect();
      let visible = r.bottom > 0 && r.top < window.innerHeight;
      for (let p = a.parentElement; p && visible; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if (oy !== 'auto' && oy !== 'scroll' && oy !== 'hidden') continue;
        const c = p.getBoundingClientRect();
        if (r.bottom <= c.top || r.top >= c.bottom) visible = false;
      }
      if (!visible) { closeRef.current(); return; }
      place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', onScroll, true); };
  }, [open, width, align]);
  // onClose 每次渲染都可能是新函数：放进 ref，监听只在打开 / 关闭时装卸。
  // 以前依赖 onClose，弹出层里的状态一变就重新装一次、把焦点抢回根节点（beta.5：弹出层里改名打一个字就退出）
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const tg = e.target as Node;
      if (ref.current?.contains(tg) || anchor.current?.contains(tg)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 1.9.1：里面还开着一层弹出层（如版本链里一行的“…”菜单），或输入框自己处理 Esc（起名时 Esc 取消），先交给它们
      if (ref.current?.querySelector('.pop')) return;
      const tg = e.target as HTMLElement | null;
      if (tg && ref.current?.contains(tg) && tg.closest?.('[data-own-esc]')) return;
      e.stopPropagation(); closeRef.current(); anchor.current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    // 打开时把焦点放进来一次；焦点已经在里面（比如自动聚焦的输入框）就不动
    const id = noFocus ? 0 : requestAnimationFrame(() => { if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true }); });
    return () => { cancelAnimationFrame(id); document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  if (!open || !pos) return null;
  return (
    // 点弹出层里面不往外冒泡（它在 DOM 里可能嵌在一行可点击的条目里，如“最近比较”的一行）
    <div ref={ref} tabIndex={-1} className={`pop${pos.up ? ' up' : ''} ${className}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={label || (typeof title === 'string' ? title : undefined)}
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width, maxHeight: pos.maxH, transformOrigin: `${pos.up ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}` }}>
      {title && <div className="pop-h"><span className="pop-t">{title}</span>{right && <span className="pop-r">{right}</span>}</div>}
      <div className="pop-b">{children}</div>
    </div>
  );
}

/** “…”菜单里的一项（组件 MenuItem）。菜单 = 无标题的 Popover，className="pop-menu"：上下各留 8px（不要用 “menu”，旧样式里有同名类） */
export function MenuItem({ icon, children, onClick, tone, disabled, title }: { icon?: React.ReactNode; children: React.ReactNode; onClick: () => void; tone?: 'danger'; disabled?: boolean; title?: string }) {
  return <button type="button" className={`menu-item ${tone || ''}`} onClick={onClick} disabled={disabled} title={title}>{icon}{children}</button>;
}
