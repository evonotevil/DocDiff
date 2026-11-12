// 1.9.3（Figma F14）：模板 / 往来稿怎么用——在弹窗里用真实的界面元素“演”一遍，约 30 秒。
// 画面是一个缩小的 DocDiff（同样的卡片、按钮、文件片、版本链、审阅条样式），模拟光标、点击波纹、镜头推近，每步一句字幕。
// 底部步骤点可点；可以暂停 / 重播。中英文、深色模式跟着应用走。
// “减少动态效果”时不自动播放、不移动镜头：一步一张静态画面（这一步的最后状态），点步骤点切换。
// 文件名、内容都是虚构示例。
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import * as I from './icons';
import { Modal } from './Modal';
import { TypeTag, MidName } from './ui';

export type DemoKind = 'tpl' | 'lib';
const STEP_MS = 8000;
const W = 960, H = 540; // 场景的“真实尺寸”，按舞台宽度整体缩放

/** 一步里的节拍：at 毫秒起进入这个状态；target = 光标要去的元素（data-t）；click = 到了之后点一下；zoom = 镜头推近到某个元素 */
interface Beat { at: number; s: string; target?: string; click?: boolean; zoom?: string; drag?: boolean }
interface Step { cap: string; beats: Beat[] }

const STEPS: Record<DemoKind, () => Step[]> = {
  tpl: () => [
    { cap: t('① 新建模板，把自己的标准合同存进来'), beats: [
      { at: 0, s: 'empty' }, { at: 700, s: 'empty', target: 'new-tpl' }, { at: 1900, s: 'empty', target: 'new-tpl', click: true },
      { at: 2400, s: 'pick', target: 'pick-file' }, { at: 3700, s: 'pick', target: 'pick-file', click: true },
      { at: 4300, s: 'saved', target: 'tpl-row', zoom: 'tpl-card' }] },
    { cap: t('② 对方发来改稿，只拖进对方的文件'), beats: [
      { at: 0, s: 'drag0', target: 'ghost-start', drag: true }, { at: 800, s: 'drag1', target: 'drop-b', drag: true, zoom: 'drop-b' },
      { at: 3200, s: 'dropped', target: 'drop-b' }] },
    { cap: t('③ 自动认出是哪份模板，开始比较'), beats: [
      { at: 0, s: 'match' }, { at: 900, s: 'match', target: 'use-tpl', zoom: 'match' }, { at: 2300, s: 'match', target: 'use-tpl', click: true },
      { at: 2900, s: 'compare', target: 'chg-1' }] },
  ],
  lib: () => [
    { cap: t('① 比较完，点文件片「存为往来稿」'), beats: [
      { at: 0, s: 'cmp' }, { at: 700, s: 'cmp', target: 'chip-a' }, { at: 1800, s: 'cmp', target: 'chip-a', click: true },
      { at: 2300, s: 'menu', target: 'save-th', zoom: 'menu' }, { at: 3500, s: 'menu', target: 'save-th', click: true },
      { at: 4100, s: 'saved', target: 'ver-chip' }] },
    { cap: t('② 对方又发来一版：加入新版本'), beats: [
      { at: 0, s: 'v2' }, { at: 600, s: 'v2', target: 'ver-chip' }, { at: 1600, s: 'v2', target: 'ver-chip', click: true },
      { at: 2100, s: 'list2', target: 'add-ver', zoom: 'ver-pop' }, { at: 3300, s: 'list2', target: 'add-ver', click: true },
      { at: 3900, s: 'list3', target: 'v3-row', zoom: 'ver-pop' }] },
    { cap: t('③ 在版本链里点任意两版比较'), beats: [
      { at: 0, s: 'list3' }, { at: 700, s: 'list3', target: 'pair-a', zoom: 'ver-pop' }, { at: 1800, s: 'list3', target: 'pair-a', click: true },
      { at: 2500, s: 'pair', target: 'pair-go', zoom: 'ver-pop' }, { at: 3600, s: 'pair', target: 'pair-go', click: true },
      { at: 4200, s: 'v13', target: 'ver-chip' }] },
    { cap: t('④ 新一轮里看到「上轮」提示和条款历史'), beats: [
      { at: 0, s: 'hint' }, { at: 800, s: 'hint', target: 'hint', zoom: 'review' }, { at: 2400, s: 'hint', target: 'reuse' },
      { at: 3500, s: 'hint', target: 'reuse', click: true }, { at: 4100, s: 'reused', target: 'hist', zoom: 'review' }] },
  ],
};

const reduce = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function DemoDialog({ kind, onClose }: { kind: DemoKind; onClose: () => void }) {
  const steps = useMemo(() => STEPS[kind](), [kind]);
  const total = steps.length * STEP_MS;
  const still = reduce();
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(!still);
  const msRef = useRef(0); msRef.current = ms;
  // 时钟：按墙上时间走（掉帧也不会变慢）；播完停在最后
  useEffect(() => {
    if (!playing) return;
    const t0 = performance.now(), base = msRef.current;
    let raf = 0;
    const tick = (now: number) => { setMs(Math.min(total, base + Math.max(0, now - t0))); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);
  useEffect(() => { if (ms >= total) setPlaying(false); }, [ms, total]);
  const si = Math.max(0, Math.min(steps.length - 1, Math.floor(ms / STEP_MS)));
  const local = still ? STEP_MS : ms - si * STEP_MS;
  const beats = steps[si].beats;
  const bi = beats.reduce((k, b, i) => (local >= b.at ? i : k), 0);
  const beat = beats[bi];
  const restart = (to: number) => { setPlaying(false); setMs(to); msRef.current = to; if (!still) requestAnimationFrame(() => setPlaying(true)); };
  const go = (i: number) => restart(i * STEP_MS);
  const replay = () => restart(0);
  const title = kind === 'tpl' ? t('模板怎么用') : t('往来稿怎么用');
  return (
    <Modal title={title} mood="happy" onClose={onClose} className="demo-dlg">
      <Stage kind={kind} step={si} beat={beat} still={still} />
      <p className="demo-cap" aria-live="polite">{steps[si].cap}</p>
      <div className="demo-ctl">
        <div className="demo-dots" role="tablist" aria-label={t('步骤')}>
          {steps.map((s, i) => <button key={i} type="button" role="tab" aria-selected={i === si} className={i === si ? 'on' : ''} onClick={() => go(i)} aria-label={s.cap} title={s.cap} />)}
          <span className="n">{si + 1} / {steps.length}</span>
        </div>
        <span className="grow" />
        {!still && <button type="button" className="btn sm icon" onClick={() => { if (ms >= total) replay(); else setPlaying(!playing); }} aria-label={playing ? t('暂停') : t('播放')} title={playing ? t('暂停') : t('播放')}>{playing ? <I.IconPause /> : <I.IconPlay />}</button>}
        <button type="button" className="btn sm icon" onClick={replay} aria-label={t('重播')} title={t('重播')}><I.IconReplay /></button>
      </div>
    </Modal>
  );
}

/** 舞台：场景按宽度缩放；镜头推近 = 再放大并把目标挪到中间；光标用过渡动画移动 */
function Stage({ kind, step, beat, still }: { kind: DemoKind; step: number; beat: Beat; still: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.74);
  const [cam, setCam] = useState({ k: 1, x: 0, y: 0 });
  const [cur, setCur] = useState({ x: W * 0.5, y: H * 0.86 });
  const [ripple, setRipple] = useState(0);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setFit(el.clientWidth / W));
    ro.observe(el); setFit(el.clientWidth / W);
    return () => ro.disconnect();
  }, []);
  // 目标在场景坐标里的位置（不受缩放影响）
  const pos = (name?: string) => {
    const root = scene.current; if (!root || !name) return null;
    const el = root.querySelector<HTMLElement>(`[data-t="${name}"]`); if (!el) return null;
    let x = 0, y = 0, n: HTMLElement | null = el;
    while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  };
  useLayoutEffect(() => {
    const z = still ? null : pos(beat.zoom);
    if (z) { const k = Math.min(1.6, Math.max(1.15, Math.min(W / (z.w + 160), H / (z.h + 120)))); const cx = z.x + z.w / 2, cy = z.y + z.h / 2; setCam({ k, x: Math.min(0, Math.max(W - W * k, W / 2 - cx * k)), y: Math.min(0, Math.max(H - H * k, H / 2 - cy * k)) }); }
    else setCam({ k: 1, x: 0, y: 0 });
    const p = pos(beat.target);
    if (p) setCur({ x: p.x + Math.min(p.w * 0.6, p.w - 6), y: p.y + p.h * 0.6 });
    if (beat.click && !still) setRipple((r) => r + 1);
  }, [beat, step, kind, still]);
  return (
    <div className={`demo-stage${still ? ' still' : ''}`} ref={box} style={{ height: H * fit }} aria-hidden="true">
      <div className="demo-cam" style={{ transform: `scale(${fit}) translate(${cam.x}px, ${cam.y}px) scale(${cam.k})` }}>
        <div className="demo-scene" ref={scene} style={{ width: W, height: H }}>
          {kind === 'tpl' ? <TplScene step={step} s={beat.s} /> : <LibScene step={step} s={beat.s} />}
          {beat.drag && <div className="demo-ghost" style={{ left: cur.x - 30, top: cur.y - 18 }}><TypeTag type="docx" /><span>{t('服务协议-对方修改.docx')}</span></div>}
          {!still && beat.target && <span className="demo-cursor" style={{ left: cur.x, top: cur.y }}><svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2l16.5 12.2-7.3.9 4.3 8.2-3.2 1.6-4.3-8.3L2 21.6z" style={{ fill: 'var(--l-title)', stroke: 'var(--on-solid)' }} strokeWidth="2" strokeLinejoin="round" /></svg>{ripple > 0 && beat.click && <i key={ripple} className="demo-ripple" />}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------- 场景：用应用里同样的样式拼出来 ----------
const Win = ({ children, top }: { children: React.ReactNode; top?: React.ReactNode }) => (
  <div className="demo-win">
    <div className="demo-top">{top ?? <span className="demo-brand"><I.IlloNew size={18} />DocDiff</span>}</div>
    <div className="demo-body">{children}</div>
  </div>
);
const Drop = ({ side, file, over, tag }: { side: 0 | 1; file?: string; over?: boolean; tag?: string }) => (
  <div className={`demo-drop${over ? ' over' : ''}${file ? ' filled' : ''}`} data-t={tag}>
    <span className="lbl">{side ? t('修改后文档') : t('原始文档')}</span>
    {file ? <span className="fr"><TypeTag type="docx" /><MidName name={file} /></span> : <span className="ttl">{side ? t('拖入对方发来的文件') : t('拖入 Word、PDF 或 TXT')}</span>}
  </div>
);
function TplScene({ step, s }: { step: number; s: string }) {
  const hasTpl = step > 0 || s === 'saved';
  if (s === 'compare') return (
    <Win top={<><span className="filechip demo-fc"><TypeTag type="docx" /><span className="name">{t('标准服务协议')}</span></span><span className="demo-arrow">→</span><span className="filechip demo-fc"><TypeTag type="docx" /><span className="name">{t('服务协议-对方修改.docx')}</span></span></>}>
      <div className="demo-cmp">
        <div className="demo-paper"><p><b>{t('第五条 付款')}</b></p><p>{t('甲方应在收到发票后')}<del>{t('三十')}</del><ins>{t('十五')}</ins>{t('日内付款。')}</p><p>{t('逾期付款的，按日支付万分之五的违约金。')}</p></div>
        <div className="demo-list">
          {[[t('三十 → 十五'), 'mod'], [t('双方另行签署补充协议'), 'ins'], [t('万分之三 → 万分之五'), 'mod']].map(([x, k], i) => <div key={i} className={`demo-row k-${k}`} data-t={'chg-' + (i + 1)}><span className={`nb k-${k}`}>{i + 1}</span>{x}</div>)}
        </div>
      </div>
    </Win>
  );
  return (
    <Win>
      <div className="mod-card demo-mod"><div className="mod-h"><span className="mod-illo"><I.IlloNew /></span><h2>{t('新比较')}</h2></div>
        <div className="demo-drops">
          <Drop side={0} file={s === 'match' ? t('标准服务协议（模板）') : undefined} />
          <Drop side={1} tag="drop-b" over={s === 'drag1'} file={s === 'dropped' || s === 'match' ? t('服务协议-对方修改.docx') : undefined} />
        </div>
        {s === 'match' && <div className="demo-match" data-t="match"><I.IconOk /><span><b>{t('认出了模板「标准服务协议」2026-10 版')}</b><br />{t('对方是在这一版上改的。')}</span><button type="button" className="btn sm blue" data-t="use-tpl">{t('用模板比较')}</button></div>}
      </div>
      <div className="demo-cols">
        <div className="mod-card demo-mod"><div className="mod-h"><span className="mod-illo"><I.IlloLib /></span><div className="mod-tabs"><button className="on">{t('最近比较')}</button><button>{t('往来稿')}</button></div></div>
          <div className="demo-empty"><I.IlloNew size={48} /><span>{t('比较过的文件会出现在这里')}</span></div></div>
        <div className="mod-card demo-mod" data-t="tpl-card"><div className="mod-h"><span className="mod-illo"><I.IlloTpl /></span><h2>{t('模板')}</h2><span className="grow" /><button type="button" className="btn sm" data-t="new-tpl"><I.IconPlusDoc />{t('新建模板')}</button></div>
          {hasTpl
            ? <div className="lib-row demo-lr" data-t="tpl-row"><TypeTag type="docx" /><span className="nm">{t('标准服务协议')}</span><span className="meta">{t('1 个版本 · 最新 2026-10 版')}</span></div>
            : <div className="demo-empty"><I.IlloTpl size={48} /><span>{t('把标准合同存成模板')}</span></div>}
        </div>
      </div>
      {s === 'pick' && <div className="demo-sheet"><div className="demo-sheet-t">{t('选择文件')}</div>{[t('标准服务协议.docx'), t('保密协议（标准版）.docx'), t('采购框架协议.docx')].map((f, i) => <div key={f} className={`demo-file${i === 0 ? ' on' : ''}`} data-t={i === 0 ? 'pick-file' : undefined}><TypeTag type="docx" /><span>{f}</span></div>)}</div>}
      <span className="demo-anchor" data-t="ghost-start" style={{ left: 120, top: 470 }} />
    </Win>
  );
}
function LibScene({ step, s }: { step: number; s: string }) {
  const isThread = !(step === 0 && (s === 'cmp' || s === 'menu'));
  const pair = s === 'v13' ? 'V1 → V3' : step === 0 || s === 'v2' || s === 'list2' ? 'V1 → V2' : 'V2 → V3';
  const vers = s === 'v2' || s === 'list2' || (step === 0) ? 2 : 3;
  const chip = isThread
    ? <button type="button" className="ver-chip demo-vc" data-t="ver-chip"><span className="nm">{t('服务协议')}</span><span className="vv">{pair}</span><I.IconDown /></button>
    : <><span className="filechip demo-fc" data-t="chip-a"><TypeTag type="docx" /><span className="who">{t('原始')}</span><span className="name">{t('服务协议-我方.docx')}</span></span><span className="filechip demo-fc"><TypeTag type="docx" /><span className="who">{t('修改后')}</span><span className="name">{t('服务协议-对方.docx')}</span></span></>;
  const showPop = s === 'list2' || s === 'list3' || s === 'pair';
  return (
    <Win top={<>{chip}<span className="grow" /><span className="demo-pos">{t('第 3 / 12 处')}</span></>}>
      <div className="demo-cmp">
        <div className="demo-paper" data-t="review">
          {step === 3 ? (
            <div className="demo-rb">
              <div className="demo-rb-h">{t('第 3 处 · 第五条 付款 · 修改')}</div>
              <div className="demo-rb-x"><del>{t('三十日')}</del> → <ins>{t('十五日')}</ins></div>
              <div className="rb-hint reverted" data-t="hint"><span className="pill">{t('V2 你拒绝过这处修改，对方又改回来了')}</span><button type="button" className="link" data-t="reuse">{t('沿用：拒绝')}</button></div>
              {s === 'reused' && <div className="demo-decided"><span className="nb v-r">✕</span>{t('已拒绝')}</div>}
            </div>
          ) : (<><p><b>{t('第五条 付款')}</b></p><p>{t('甲方应在收到发票后')}<del>{t('三十')}</del><ins>{t('十五')}</ins>{t('日内付款。')}</p><p>{t('逾期付款的，按日支付万分之五的违约金。')}</p></>)}
        </div>
        <div className="demo-list">
          {step === 3
            ? <div className="insp-block clause-hist" data-t="hist"><div className="sh"><span className="t">{t('第五条 付款 · 条款历史')}</span></div>
                <div className="ch-row"><span className="vn them">V2</span><span className="tx">{t('三十日 → 十五日')}</span><span className="v">{t('拒绝')}</span></div>
                <div className="ch-row"><span className="vn us">V3</span><span className="tx">{t('十五日 → 三十日')}</span><span className="v">{t('我方')}</span></div></div>
            : [[t('三十 → 十五'), 'mod'], [t('双方另行签署补充协议'), 'ins'], [t('万分之三 → 万分之五'), 'mod']].map(([x, k], i) => <div key={i} className={`demo-row k-${k}`}><span className={`nb k-${k}`}>{i + 1}</span>{x}</div>)}
        </div>
      </div>
      {s === 'menu' && <div className="demo-pop demo-menu" data-t="menu"><div className="menu-item"><I.IconUpload />{t('换一个文件…')}</div><div className="menu-item" data-t="save-th"><I.IconPlusDoc />{t('存为往来稿')}</div></div>}
      {s === 'saved' && step === 0 && <div className="toast demo-toast">{t('已存为往来稿「服务协议」')}</div>}
      {showPop && (
        <div className="demo-pop demo-ver" data-t="ver-pop">
          <div className="demo-ver-h">{t('服务协议')}</div>
          {[[1, t('我方'), t('服务协议-我方.docx')], [2, t('对方'), t('服务协议-对方.docx')], [3, t('对方'), t('对方第二次修改.docx')]].slice(0, vers).map(([n, who, f]) => (
            <div key={n as number} className="ver-row demo-vr" data-t={n === 3 ? 'v3-row' : undefined}><span className={`vn ${who === t('我方') ? 'us' : 'them'}`}>V{n}</span><span className="sd">{who}</span><MidName name={f as string} /></div>
          ))}
          {s === 'list2'
            ? <button type="button" className="btn sm demo-add" data-t="add-ver"><I.IconPlusDoc />{t('加入新版本…')}</button>
            : <div className="demo-pair"><span className={`demo-pv${s === 'pair' ? ' on' : ''}`} data-t="pair-a">V1</span>→<span className="demo-pv on">V3</span><span className="grow" /><button type="button" className="btn sm" data-t="pair-go">{t('比较')}</button></div>}
        </div>
      )}
    </Win>
  );
}
