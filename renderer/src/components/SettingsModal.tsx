import React, { useEffect, useState } from 'react';
import { t, Lang } from '../lib/i18n';
import { isMac, kbd } from '../lib/platform';
import { initialsOf, refreshReviewIndex } from '../lib/review';
import { fmtBytes, fmtDate } from '../lib/model';
import { DEFAULT_KEYWORDS } from '../lib/insight';
import { Modal } from './Modal';
import { Switch, Opt, Seg, Kbd } from './ui';
import * as I from './icons';

declare const __APP_VERSION__: string;
export const APP_VERSION = 'v' + __APP_VERSION__;
const api = (window as any).api;

export interface UpdInfo { status: 'new' | 'latest' | 'error' | 'off'; current: string; latest?: string; url?: string; notes?: string; pubDate?: string; error?: string }

export interface SettingsValues {
  lang: Lang; theme: 'light' | 'dark'; paperFollowTheme: boolean; sound: boolean; celebrate: boolean;
  reviewerName: string; reviewerInitials: string; authorName: string; commentAccepted: boolean;
  draftName: string; finalName: string;
  riskMoney: boolean; riskDate: boolean; keywords: string[];
  autoCheckUpdate: boolean;
}
type Tab = 'general' | 'review' | 'risk' | 'keys' | 'about';

function ShortcutRows() {
  const groups: [string, [string, string][]][] = [
    [t('通用'), [
      [t('打开原始文档'), kbd('mod+O')], [t('打开修改后文档'), kbd('mod+shift+O')],
      [t('新建比较'), kbd('mod+N')], [t('交换左右文档'), kbd('mod+shift+S')],
      [t('开始比较'), 'Enter'], [t('切换模式'), `${kbd('mod+1')} … ${kbd('mod+6')}`],
      [t('下一处 / 上一处差异'), 'J / K'],
      [t('收起 / 展开侧栏'), isMac ? '⌃⌘S' : 'Ctrl+Alt+S'], [t('收起 / 展开检查器'), isMac ? '⌥⌘I' : 'Ctrl+Alt+I'],
    ]],
    [t('修订审阅'), [
      [t('接受 / 拒绝'), 'A / R'], [t('标为待议'), 'H'], [t('写备注'), 'N'], [t('撤销上一次决定'), 'U'], [t('上一处 / 下一处'), '← / →'],
    ]],
  ];
  return (
    <div className="keys-table">
      {groups.map(([g, rows]) => (
        <React.Fragment key={g}>
          <div className="keys-group">{g}</div>
          {rows.map(([l, k]) => <div className="keys-row" key={l}><span className="kl">{l}</span><span className="kk"><Kbd>{k}</Kbd></span></div>)}
        </React.Fragment>
      ))}
    </div>
  );
}

function UpdateSection({ info, checking, onCheck, onSkip, auto, setAuto }: {
  info: UpdInfo | null; checking: boolean; onCheck: () => void; onSkip: (v: string) => void; auto: boolean; setAuto: (v: boolean) => void;
}) {
  const open = () => { if (info?.url) api.openUrl?.(info.url); };
  return (
    <div className="upd">
      <div className="upd-row">
        <div className="upd-ver">
          <b>DocDiff {APP_VERSION}</b>
          <span>
            {checking ? t('正在检查…')
              : info?.status === 'new' ? t('有新版本 {v}', { v: info.latest! })
              : info?.status === 'latest' ? t('已是最新版本')
              : info?.status === 'error' ? t('没能连上更新服务器：{e}', { e: t(info.error || '') })
              : info?.status === 'off' ? t('未配置更新地址')
              : t('还没有检查过')}
          </span>
        </div>
        <button className="btn sm" disabled={checking} onClick={onCheck}><I.IconRefresh />{t('检查更新')}</button>
      </div>
      {info?.status === 'new' && (
        <div className="nt ok upd-new">
          {info.notes ? <div className="upd-notes">{info.notes}</div> : null}
          <div className="upd-acts">
            <button className="btn primary sm" disabled={!info.url} onClick={open}><I.IconDownload />{t('打开下载页')}</button>
            <button className="btn sm plain" onClick={() => onSkip(info.latest!)}>{t('跳过这个版本')}</button>
          </div>
          <div className="upd-hint">{t('浏览器里下载完成后，像第一次安装那样覆盖安装即可，比较记录和设置都会保留。')}</div>
        </div>
      )}
      <Opt label={t('启动时自动检查更新')} hint={t('只向更新地址发一个普通请求，不会上传任何文件信息；关掉后应用完全不联网。')}>
        <Switch on={auto} onChange={setAuto} label={t('启动时自动检查更新')} />
      </Opt>
    </div>
  );
}

function KeywordEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft('');
  };
  return (
    <div className="kw-editor">
      <div className="kws">
        {value.map((k) => (
          <span className="kw" key={k}>{k}<button className="kw-x" onClick={() => onChange(value.filter((x) => x !== k))} aria-label={t('删除关键词 {k}', { k })} title={t('删除')}><I.IconX /></button></span>
        ))}
        {!value.length && <span className="kw-empty">{t('还没有关键词')}</span>}
      </div>
      <div className="kw-add">
        <input id="kw-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder={t('输入关键词，回车添加')} aria-label={t('添加关键词')} />
        <button className="btn sm" onClick={add} disabled={!draft.trim()}>{t('添加')}</button>
        <button className="btn sm plain" onClick={() => onChange(DEFAULT_KEYWORDS)}>{t('恢复默认')}</button>
      </div>
    </div>
  );
}


/** 审阅记录的占用与手动清理（1.7.3）：不再自动删除，由用户决定 */
const DAY = 86400000;
function ReviewStorage() {
  const [u, setU] = useState<{ count: number; bytes: number; oldest: number } | null>(null);
  const [ask, setAsk] = useState<null | 'old' | 'all'>(null);
  const [msg, setMsg] = useState('');
  const load = () => api.reviewUsage?.().then(setU).catch(() => setU(null));
  const [lib, setLibU] = useState<{ files: number; bytes: number } | null>(null);
  useEffect(() => { load(); api.libUsage?.().then(setLibU).catch(() => {}); }, []);
  if (!api.reviewUsage) return null;
  const ix: Record<string, { updated: number }> = (() => { try { return api.reviewIndex() || {}; } catch { return {}; } })();
  const cutoff = Date.now() - 90 * DAY;
  const oldN = Object.values(ix).filter((x) => (x.updated || 0) < cutoff).length;
  const run = async (kind: 'old' | 'all') => {
    const r = await api.reviewClean(kind === 'all' ? { all: true } : { olderThan: cutoff });
    setAsk(null);
    refreshReviewIndex();
    if (r?.ok) { setU(r.usage); setMsg(t('已删除 {n} 组审阅记录', { n: r.n })); } else setMsg(t('没能删除：{e}', { e: r?.error || '' }));
  };
  return (
    <div className="field review-storage">
      <label>{t('审阅记录')}</label>
      <div className="rs-usage">
        {u ? (u.count ? t('本机保存了 {n} 组比较的审阅结论，共 {s}；最早一组在 {d}。', { n: u.count, s: fmtBytes(u.bytes), d: fmtDate(u.oldest) }) : t('本机还没有保存审阅结论。')) : t('正在读取…')}
      </div>
      <small>{t('结论按两份文件的内容保存在本机应用数据目录，不会自动删除。')}</small>
      {lib && lib.files > 0 && <small>{t('模板和往来稿存了 {n} 个文件的拷贝，共 {s}。在首页删除模板或往来稿时一起清掉。', { n: lib.files, s: fmtBytes(lib.bytes) })}</small>}
      {u && u.count > 0 && (ask ? (
        <div className="rs-ask" role="alert">
          <span>{ask === 'all' ? t('删除全部 {n} 组审阅记录？删除后不能恢复。', { n: u.count }) : t('删除 90 天前的 {n} 组审阅记录？删除后不能恢复。', { n: oldN })}</span>
          <button className="btn sm plain" onClick={() => setAsk(null)}>{t('取消')}</button>
          <button className="btn sm red" onClick={() => run(ask)}>{t('删除')}</button>
        </div>
      ) : (
        <div className="rs-acts">
          <button className="btn sm" disabled={!oldN} onClick={() => { setMsg(''); setAsk('old'); }}>{t('清理 90 天前的记录（{n} 组）', { n: oldN })}</button>
          <button className="btn sm danger-outline" onClick={() => { setMsg(''); setAsk('all'); }}>{t('全部清空…')}</button>
        </div>
      ))}
      {msg && <small role="status">{msg}</small>}
    </div>
  );
}

export function SettingsModal({ v, set, onClose, upd, initialTab = 'general' }: {
  v: SettingsValues; set: <K extends keyof SettingsValues>(k: K, val: SettingsValues[K]) => void; onClose: () => void;
  upd: Omit<React.ComponentProps<typeof UpdateSection>, 'auto' | 'setAuto'>; initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabs: [Tab, string, React.ReactNode][] = [
    ['general', t('通用'), <I.IconGear key="g" />], ['review', t('审阅'), <I.IconRedline key="r" />], ['risk', t('风险'), <I.IconWarn key="w" />],
    ['keys', t('快捷键'), <I.IconKeyboard key="k" />], ['about', t('关于与更新'), <I.IconDownload key="a" />],
  ];
  return (
    <Modal title={t('设置')} onClose={onClose} className="settings-modal">
      <div className="set-grid">
        <div className="set-tabs" role="tablist" aria-orientation="vertical">
          {tabs.map(([k, label, icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{icon}<span>{label}</span></button>
          ))}
        </div>
        <div className="set-pane" role="tabpanel">
          {tab === 'general' && (
            <>
              <Opt label={t('语言 / Language')}><Seg value={v.lang} options={[['zh', '中文'], ['en', 'English']]} onChange={(x) => set('lang', x as Lang)} /></Opt>
              <Opt label={t('外观')}><Seg value={v.theme} options={[['light', t('浅色')], ['dark', t('深色')]]} onChange={(x) => set('theme', x as 'light' | 'dark')} /></Opt>
              <Opt label={t('深色模式下的文档纸张')} hint={t('保持浅色时，和打印出来的合同一致，Word 与 PDF 两侧也一致')}>
                <Seg value={v.paperFollowTheme ? 'dark' : 'light'} options={[['light', t('保持浅色')], ['dark', t('跟随主题')]]} onChange={(x) => set('paperFollowTheme', x === 'dark')} />
              </Opt>
              <Opt label={t('音效')} hint={t('审阅修订时的轻提示音')}><Switch on={v.sound} onChange={(x) => set('sound', x)} label={t('音效')} /></Opt>
              <Opt label={t('审阅完成时放彩纸')}><Switch on={v.celebrate} onChange={(x) => set('celebrate', x)} label={t('审阅完成时放彩纸')} /></Opt>
            </>
          )}
          {tab === 'review' && (
            <>
              <p className="set-intro">{t('你在修订审阅里做的每个决定都署这个名字：写进审阅稿的修订和批注、导出的报告都用它。')}</p>
              <div className="field-row">
                <div className="field grow"><label htmlFor="rv-name">{t('审阅人姓名')}</label><input id="rv-name" value={v.reviewerName} onChange={(e) => { set('reviewerName', e.target.value); if (!v.reviewerInitials || v.reviewerInitials === initialsOf(v.reviewerName)) set('reviewerInitials', initialsOf(e.target.value)); }} /></div>
                <div className="field narrow"><label htmlFor="rv-ini">{t('缩写')}</label><input id="rv-ini" value={v.reviewerInitials} maxLength={4} onChange={(e) => set('reviewerInitials', e.target.value)} /></div>
              </div>
              <div className="field">
                <label htmlFor="rv-author">{t('修订作者的默认名称')}</label>
                <input id="rv-author" value={v.authorName} placeholder={t('从对方文件读取，读不到时用“修改方”')} onChange={(e) => set('authorName', e.target.value)} />
                <small>{t('Word 里的修订记的是“谁改了文字”，也就是对方。导出时还可以针对每份文件单独修改。')}</small>
              </div>
              <Opt label={t('接受的修订也加批注')} hint={t('关掉后，只有拒绝和待议带批注')}><Switch on={v.commentAccepted} onChange={(x) => set('commentAccepted', x)} label={t('接受的修订也加批注')} /></Opt>
              <div className="field-row">
                <div className="field grow"><label htmlFor="rv-draft">{t('审阅稿文件名')}</label><input id="rv-draft" value={v.draftName} placeholder={t('{name}-我方意见')} onChange={(e) => set('draftName', e.target.value)} /></div>
                <div className="field grow"><label htmlFor="rv-final">{t('定稿文件名')}</label><input id="rv-final" value={v.finalName} placeholder={t('{name}-定稿')} onChange={(e) => set('finalName', e.target.value)} /></div>
              </div>
              <small className="set-hint">{t('{name} 会换成对方文件的名字。审阅稿会发回给对方，名字里别带只给自己看的字。')}</small>
              <ReviewStorage />
            </>
          )}
          {tab === 'risk' && (
            <>
              <p className="set-intro">{t('比较完成后，命中下面规则的变化会放在右栏最上方的「需要留意」里。判断完全靠规则，离线完成。')}</p>
              <Opt label={t('金额与付款')} hint={t('价款、比例、付款节点的变化，并算出变化幅度')}><Switch on={v.riskMoney} onChange={(x) => set('riskMoney', x)} label={t('金额与付款')} /></Opt>
              <Opt label={t('日期与期限')} hint={t('签订日期、服务期限、付款天数等')}><Switch on={v.riskDate} onChange={(x) => set('riskDate', x)} label={t('日期与期限')} /></Opt>
              <div className="field">
                <label htmlFor="kw-input">{t('自定义关键词')}</label>
                <KeywordEditor value={v.keywords} onChange={(x) => set('keywords', x)} />
                <small>{t('变化本身或所在条款的标题包含这些词，就会被置顶。')}</small>
              </div>
            </>
          )}
          {tab === 'keys' && <ShortcutRows />}
          {tab === 'about' && (
            <>
              <UpdateSection {...upd} auto={v.autoCheckUpdate} setAuto={(x) => set('autoCheckUpdate', x)} />
              <div className="set-about">{t('文档内容始终留在这台电脑上，比对过程不联网。')}</div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
