import { EN_DICT } from './dict.en';
import { EN_19 } from './dict.en.19';
import { getSetting, setSetting } from './persist';
// 中英文切换：以中文原文作为 key，英文在下面的词典里。t('…{n}…', { n }) 支持占位符。
export type Lang = 'zh' | 'en';

let LANG: Lang = 'zh';
export const lang = () => LANG;
export const isEn = () => LANG === 'en';

export function setLang(l: Lang) {
  LANG = l;
  setSetting('lang', l);
  document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.lang = l;
}
export function initLang(): Lang {
  let l: Lang = /^zh\b/i.test(navigator.language) ? 'zh' : 'en';
  const s = getSetting('lang'); if (s === 'zh' || s === 'en') l = s;
  setLang(l);
  return l;
}

export function t(zh: string, vars?: Record<string, string | number>): string {
  let s = LANG === 'en' ? (EN[zh] ?? zh) : zh;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  if (LANG === 'en' && vars) s = plural(s, vars);
  // 伪本地化（1.9 · 只用于测试）：英文统一加长 40%，检查截断和溢出
  if (PSEUDO && LANG === 'en') s = s + ' ' + '~'.repeat(Math.ceil(s.length * 0.4));
  return s;
}
const PSEUDO = (() => { try { return localStorage.getItem('docdiff.pseudo') === '1'; } catch { return false; } })();

// 英文单复数（1.8.1）：词典里统一写复数，数字是 1 时改成单数；“file(s)”这类写法按数字选
const ONE = /(^|[^\d.,/])1 ((?:open |unchanged |undecided |tracked |identical )?)(page|paragraph|difference|change|version|record|set|document|file|decision|comparison|item|negotiation|template|comment|line|time|minute|day|area)s\b/g;
export function plural(s: string, vars: Record<string, string | number>) {
  const nums = Object.values(vars).filter((x) => typeof x === 'number') as number[];
  if (!nums.length) return s;
  s = s.replace(ONE, '$1' + '1 $2$3');
  if (s.includes('(s)')) s = s.split('(s)').join(nums.length === 1 && nums[0] === 1 ? '' : 's');
  return s;
}
/** 文档属性表里的中文字段名 */
export const tMeta = (k: string) => (LANG === 'en' ? (META_EN[k] ?? k) : k);

const META_EN: Record<string, string> = {
  标题: 'Title', 作者: 'Author', 主题: 'Subject', 关键词: 'Keywords', 备注: 'Comments',
  创建程序: 'Creator', PDF生成器: 'Producer', 文档创建时间: 'Created', 文档修改时间: 'Modified',
  PDF版本: 'PDF version', 线性化: 'Linearized', 加密: 'Encrypted', 含表单: 'Has form fields',
  页面尺寸: 'Page size', 是否为扫描件: 'Looks scanned',
  最后修改者: 'Last modified by', 修订号: 'Revision', 应用程序: 'Application', 公司: 'Company',
  模板: 'Template', '总编辑时间（分钟）': 'Total editing time (min)', 图片数量: 'Images',
  包含修订标记: 'Tracked changes', 批注数量: 'Comments',
  段落数: 'Paragraphs', 标题数: 'Headings', 表格行数: 'Table rows', 列表项数: 'List items',
  字数: 'Words', '字符数（含空格）': 'Characters (with spaces)', '字符数（不含空格）': 'Characters (no spaces)',
  是: 'Yes', 否: 'No', '（空）': '(empty)', 未知: 'Unknown',
};

// 1.9：按英文风格指南重写的条目覆盖旧译文
const EN: Record<string, string> = { ...EN_DICT, ...EN_19 };

/** 日期、数字一律按界面语言用 Intl 格式化（1.9 · 英文风格指南第 7 条）：中文 10月26日，英文 Oct 26 */
export const fmtMonthDay = (d: Date) => new Intl.DateTimeFormat(LANG === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' }).format(d);
/** 拼句子用的标点（1.9）：英文不用全角标点 */
export const colon = () => (LANG === 'en' ? ': ' : '：');
export const paren = (s: string) => (LANG === 'en' ? ` (${s})` : `（${s}）`);
export const bracket = (s: string) => (LANG === 'en' ? `[${s}] ` : `【${s}】`);
/** 短日期：今年内只写月日，跨年加年份（中文 10月26日 / 2025年10月26日；英文 Oct 26 / Oct 26, 2025） */
export const fmtShortDate = (ms: number) => {
  const d = new Date(ms), same = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(LANG === 'en' ? 'en-US' : 'zh-CN', same ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
};
/** 相对时间：交给 Intl.RelativeTimeFormat（英文 5 min ago、2 hr ago、yesterday） */
export const fmtAgo = (seconds: number) => {
  const rtf = new Intl.RelativeTimeFormat(LANG === 'en' ? 'en-US' : 'zh-CN', { numeric: 'auto', style: LANG === 'en' ? 'short' : 'long' });
  if (seconds < 3600) return rtf.format(-Math.max(1, Math.floor(seconds / 60)), 'minute');
  if (seconds < 86400) return rtf.format(-Math.floor(seconds / 3600), 'hour');
  return rtf.format(-Math.floor(seconds / 86400), 'day');
};
