import React, { createContext, useContext, useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import * as I from './icons';

/**
 * 右栏面板（组件标准 · 右栏面板）
 * · 每块都能折叠，可以同时展开多块；展开状态记在本机，下次比较沿用
 * · “只看这一块”：其余面板隐藏，这一块占满右栏；再点一次、点“显示全部”或按 Esc 恢复
 * · grow 面板（变更列表、页面列表）吃满剩余高度，自己滚动
 */
const KEY = 'panels-v1';
const DEFAULT_CLOSED = new Set(['scope', 'settings', 'batch']);

type Ctx = { isOpen: (id: string) => boolean; toggle: (id: string) => void; focus: string | null; setFocus: (id: string | null) => void };
const PanelCtx = createContext<Ctx | null>(null);

export function usePanelState() {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
  });
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(open)); } catch {} }, [open]);
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal')) return;
      const tg = e.target as HTMLElement;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
      setFocus(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);
  const isOpen = (id: string) => (id in open ? open[id] : !DEFAULT_CLOSED.has(id));
  const ctx: Ctx = { isOpen, toggle: (id) => setOpen((o) => ({ ...o, [id]: !(id in o ? o[id] : !DEFAULT_CLOSED.has(id)) })), focus, setFocus };
  return ctx;
}

export function PanelGroup({ state, children, names }: { state: Ctx; children: React.ReactNode; names: Record<string, string> }) {
  const f = state.focus;
  // 当前这一页没有这块面板了（例如切换到别的模式），自动退出“只看”
  const present = f ? !!names[f] : true;
  useEffect(() => { if (f && !present) state.setFocus(null); }, [f, present]);
  return (
    <PanelCtx.Provider value={state}>
      {f && present && (
        <div className="focus-bar" role="status">
          <span>{t('只看：')}<b>{names[f]}</b></span>
          <button type="button" className="link-btn" onClick={() => state.setFocus(null)}>{t('显示全部')}</button>
        </div>
      )}
      {children}
    </PanelCtx.Provider>
  );
}

export function Panel({ id, title, count, icon, right, grow, children, className, tone }: {
  id: string; title: React.ReactNode; count?: React.ReactNode; icon?: React.ReactNode; right?: React.ReactNode;
  grow?: boolean; children?: React.ReactNode; className?: string; tone?: 'warn';
}) {
  const ctx = useContext(PanelCtx);
  const focused = ctx?.focus === id;
  const hidden = !!ctx?.focus && !focused;
  const open = focused || (ctx ? ctx.isOpen(id) : true);
  if (hidden) return null;
  const bodyId = `pnl-${id}`;
  return (
    <section className={`pnl ${grow ? 'grow' : ''} ${open ? '' : 'collapsed'} ${focused ? 'focused' : ''} ${tone ? 'tone-' + tone : ''} ${className || ''}`} data-panel={id}>
      <header className="pnl-h">
        <button type="button" className="pnl-tg" aria-expanded={open} aria-controls={bodyId} onClick={() => (focused ? ctx?.setFocus(null) : ctx?.toggle(id))}>
          <span className="pnl-chev" aria-hidden="true"><I.IconDown /></span>
          {icon && <span className="pnl-ic" aria-hidden="true">{icon}</span>}
          <span className="pnl-title">{title}</span>
          {count !== undefined && count !== null && <span className="pnl-count">{count}</span>}
        </button>
        {open && right}
        {ctx && (
          <button type="button" className={`icon-btn ${focused ? 'on' : ''}`} onClick={() => ctx.setFocus(focused ? null : id)}
            title={t(focused ? '显示全部（Esc）' : '只看这一块')} aria-label={t(focused ? '显示全部（Esc）' : '只看这一块')} aria-pressed={focused}>
            {focused ? <I.IconUnfocus /> : <I.IconFocus />}
          </button>
        )}
      </header>
      {open && <div className="pnl-b" id={bodyId}>{children}</div>}
    </section>
  );
}

/** 统一提示条（组件标准 · 提示条）：图标 + 粗体一句话 + 补充 + 最多一个操作 + 可选关闭 */
export function Notice({ tone = 'info', title, children, action, onClose, closeLabel, className, role }: {
  tone?: 'info' | 'warn' | 'err' | 'ok'; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode;
  onClose?: () => void; closeLabel?: string; className?: string; role?: string;
}) {
  const icon = tone === 'warn' ? <I.IconWarn /> : tone === 'err' ? <I.IconErr /> : tone === 'ok' ? <I.IconOk /> : <I.IconInfo />;
  return (
    <div className={`nt ${tone} ${className || ''}`} role={role || (tone === 'err' ? 'alert' : 'status')}>
      <span className="nt-ic" aria-hidden="true">{icon}</span>
      <div className="nt-tx">{title && <b>{title}</b>}{children && <span>{children}</span>}</div>
      {(action || onClose) && (
        <div className="nt-acts">
          {action}
          {onClose && <button type="button" className="icon-btn" onClick={onClose} title={closeLabel || t('知道了')} aria-label={closeLabel || t('知道了')}><I.IconX /></button>}
        </div>
      )}
    </div>
  );
}
