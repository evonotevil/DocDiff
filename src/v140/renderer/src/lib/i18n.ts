import { EN_DICT } from './dict.en';
// 中英文切换：以中文原文作为 key，英文在下面的词典里。t('…{n}…', { n }) 支持占位符。
export type Lang = 'zh' | 'en';

let LANG: Lang = 'zh';
export const lang = () => LANG;
export const isEn = () => LANG === 'en';
export function setLang(l: Lang) {
  LANG = l;
  try { localStorage.setItem('lang', l); } catch {}
  document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.lang = l;
}
export function initLang(): Lang {
  let l: Lang = /^zh\b/i.test(navigator.language) ? 'zh' : 'en';
  try { const s = localStorage.getItem('lang'); if (s === 'zh' || s === 'en') l = s; } catch {}
  setLang(l);
  return l;
}

export function t(zh: string, vars?: Record<string, string | number>): string {
  let s = LANG === 'en' ? (EN[zh] ?? zh) : zh;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
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

const EN = EN_DICT;
