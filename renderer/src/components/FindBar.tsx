import React, { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import * as I from './icons';

/**
 * 查找（1.9.1 · F3）：Ctrl / ⌘ + F 在比较页顶部打开。搜当前模式里两侧的文档文字，高亮所有匹配；
 * Enter / ↓ 下一个，Shift + Enter / ↑ 上一个，Esc 关闭。不过滤右侧的变更列表。
 *
 * 高亮用 CSS Custom Highlight API，不改文档的 DOM（文档里的 span 是差异标记，改了会打乱比较结果的渲染）。
 * 正文按需挂载的视图在查找栏开着、且有关键词时整篇挂载（FindAll），否则没挂上的段落搜不到。
 */
export const FindAll = createContext(false);

/** 不算文档文字的部分：列标题、折叠按钮、“已移动”标签、对齐提示等 */
const SKIP = '.findbar, button, .colhead, .rich-head, .movetag, .fold-cell, .fold, .phline, .align-chip, .ln, [aria-hidden="true"]';
/** 一段文字的单位：匹配不跨段落 */
const UNIT = '.td, .blk, .ct, [data-row]';

const hl = (): any => (typeof CSS !== 'undefined' ? (CSS as any).highlights : null);

function collect(root: HTMLElement, q: string): Range[] {
  const out: Range[] = [];
  if (!q) return out;
  const needle = q.toLocaleLowerCase();
  // 按段落把文字节点拼起来，再在拼好的文字里找（一个词常被差异标记切成几个 span）
  let unit: Element | null = null;
  let nodes: { n: Text; at: number }[] = [];
  let text = '';
  const flush = () => {
    if (text.length >= needle.length) {
      const hay = text.toLocaleLowerCase();
      for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
        const r = document.createRange();
        const pos = (k: number, end: boolean) => {
          let j = nodes.length - 1;
          for (let x = 0; x < nodes.length; x++) { const next = nodes[x + 1]?.at ?? Infinity; if (end ? k <= next : k < next) { j = x; break; } }
          return { n: nodes[j].n, o: k - nodes[j].at };
        };
        const s = pos(i, false), e = pos(i + needle.length, true);
        try { r.setStart(s.n, s.o); r.setEnd(e.n, e.o); out.push(r); } catch { /* 节点刚被换掉 */ }
      }
    }
    nodes = []; text = '';
  };
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const el = n.parentElement;
      if (!el || !n.nodeValue || el.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    const u = n.parentElement!.closest(UNIT) || n.parentElement;
    if (u !== unit) { flush(); unit = u; }
    nodes.push({ n, at: text.length });
    text += n.nodeValue;
  }
  flush();
  return out;
}

export function FindBar({ rootRef, onClose, dep, focusKey }: {
  /** 当前模式的画布 */
  rootRef: React.RefObject<HTMLElement>;
  onClose: () => void;
  /** 内容变了（换模式、重新比较、展开折叠）要重新搜 */
  dep: unknown[];
  /** 再按一次 Ctrl / ⌘ + F：重新聚焦并全选 */
  focusKey: number;
}) {
  const [q, setQ] = useState('');
  const [n, setN] = useState(0);
  const [cur, setCur] = useState(-1);
  const ranges = useRef<Range[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const curRef = useRef(cur); curRef.current = cur;

  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, [focusKey]);

  const paint = useCallback((i: number) => {
    const H = hl();
    if (!H) return;
    const all = ranges.current;
    H.set('dd-find', new (window as any).Highlight(...all.filter((_, k) => k !== i)));
    if (i >= 0 && all[i]) H.set('dd-find-cur', new (window as any).Highlight(all[i])); else H.delete('dd-find-cur');
  }, []);

  const reveal = (r: Range) => {
    const el = (r.startContainer.parentElement) as HTMLElement | null;
    const sc = el?.closest('.scroll') as HTMLElement | null;
    if (!el || !sc) return;
    const rb = r.getBoundingClientRect(), cb = sc.getBoundingClientRect();
    if (rb.top < cb.top + 40 || rb.bottom > cb.bottom - 40) sc.scrollTo({ top: sc.scrollTop + rb.top - cb.top - sc.clientHeight / 2, behavior: 'smooth' });
    if (rb.left < cb.left || rb.right > cb.right) sc.scrollTo({ left: sc.scrollLeft + rb.left - cb.left - sc.clientWidth / 3 });
  };

  /** 重新搜；keep：尽量留在原来那个匹配附近（内容变了时不跳回第一个） */
  const run = useCallback((keep: boolean) => {
    const root = rootRef.current;
    const prev = keep ? ranges.current[curRef.current] : null;
    ranges.current = root ? collect(root, q.trim() ? q : '') : [];
    const all = ranges.current;
    let i = all.length ? 0 : -1;
    if (prev && all.length) {
      const k = all.findIndex((r) => { try { return r.compareBoundaryPoints(Range.START_TO_START, prev) >= 0; } catch { return false; } });
      i = k >= 0 ? k : all.length - 1;
    }
    setN(all.length); setCur(i); paint(i);
    return i;
  }, [q, paint]);

  // 关键词变了：重新搜，跳到第一个
  useEffect(() => {
    const id = setTimeout(() => { const i = run(false); if (i >= 0) reveal(ranges.current[i]); }, 120);
    return () => clearTimeout(id);
  }, [q]);
  // 内容变了（换模式、整篇挂载完、展开）：重新搜，停在原处
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let id = 0;
    const mo = new MutationObserver(() => { clearTimeout(id); id = window.setTimeout(() => run(true), 150); });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    const first = window.setTimeout(() => run(true), 60);
    return () => { mo.disconnect(); clearTimeout(id); clearTimeout(first); };
  }, [rootRef.current, run, ...dep]);
  useEffect(() => () => { const H = hl(); H?.delete('dd-find'); H?.delete('dd-find-cur'); }, []);

  const go = (d: 1 | -1) => {
    const all = ranges.current;
    if (!all.length) return;
    const i = ((curRef.current < 0 ? (d > 0 ? -1 : 0) : curRef.current) + d + all.length) % all.length;
    setCur(i); paint(i); reveal(all[i]);
  };
  const miss = !!q.trim() && n === 0;
  return (
    <div className={`findbar${miss ? ' miss' : ''}`} role="search" aria-label={t('查找')}>
      <label className="find-in">
        <I.IconSearch />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('在两侧文档里查找')} aria-label={t('查找')} spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); go(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          }} />
      </label>
      <span className="find-n" aria-live="polite">{q.trim() ? (n ? t('{i} / {n}', { i: cur + 1, n }) : t('没有找到')) : ''}</span>
      <button type="button" className="ibtn sm" onClick={() => go(-1)} disabled={!n} title={t('上一个（Shift + Enter）')} aria-label={t('上一个')}><I.IconUp /></button>
      <button type="button" className="ibtn sm" onClick={() => go(1)} disabled={!n} title={t('下一个（Enter）')} aria-label={t('下一个')}><I.IconDown /></button>
      <button type="button" className="ibtn sm" onClick={onClose} title={t('关闭（Esc）')} aria-label={t('关闭查找')}><I.IconX /></button>
    </div>
  );
}

