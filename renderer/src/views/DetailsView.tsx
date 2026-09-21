import React from 'react';
import type { DocModel } from '../lib/model';
import { blockText, countWords, docPlainText, fmtBytes, fmtDate } from '../lib/model';
import { t, tMeta } from '../lib/i18n';

const TYPE_NAME = (k: string) => ({ docx: t('Word 文档 (.docx)'), pdf: t('PDF 文档'), txt: t('纯文本') } as Record<string, string>)[k];

function stats(d: DocModel) {
  const text = docPlainText(d);
  const w = countWords(text);
  const nonEmpty = d.blocks.filter((b) => blockText(b).trim()).length;
  return {
    段落数: String(nonEmpty),
    标题数: String(d.blocks.filter((b) => b.kind === 'h').length),
    表格行数: String(d.blocks.filter((b) => b.kind === 'tr').length),
    列表项数: String(d.blocks.filter((b) => b.kind === 'li').length),
    字数: w.words.toLocaleString(),
    '字符数（含空格）': w.chars.toLocaleString(),
    '字符数（不含空格）': w.charsNoSpace.toLocaleString(),
  };
}

export function DetailsView({ A, B }: { A: DocModel; B: DocModel }) {
  const sections: [string, [string, string, string, boolean?][]][] = [];
  sections.push([t('文件'), [
    [tMeta('文件名'), A.file.name, B.file.name],
    [tMeta('格式'), TYPE_NAME(A.type) || A.type, TYPE_NAME(B.type) || B.type],
    [tMeta('文件大小'), `${fmtBytes(A.file.size)}${t('（{n} 字节）', { n: A.file.size.toLocaleString() })}`, `${fmtBytes(B.file.size)}${t('（{n} 字节）', { n: B.file.size.toLocaleString() })}`],
    [tMeta('位置'), A.file.path, B.file.path],
    [tMeta('创建时间'), fmtDate(A.file.birthtime), fmtDate(B.file.birthtime)],
    [tMeta('修改时间'), fmtDate(A.file.mtime), fmtDate(B.file.mtime)],
    ['SHA-256', A.sha256 || '', B.sha256 || '', true],
  ]]);
  const sa = stats(A), sb = stats(B);
  sections.push([t('内容统计'), [
    [tMeta('页数'), A.pageCount ? String(A.pageCount) : A.type === 'txt' ? '—' : tMeta('未知'), B.pageCount ? String(B.pageCount) : B.type === 'txt' ? '—' : tMeta('未知')],
    ...Object.keys(sa).map((k) => [tMeta(k), (sa as any)[k], (sb as any)[k]] as [string, string, string]),
  ]]);
  const keys = [...new Set([...Object.keys(A.meta), ...Object.keys(B.meta)])];
  const metaRows = keys.map((k) => {
    const f = (d: DocModel) => { const v = d.meta[k]; if (v === undefined) return '—'; return /时间$/.test(k) && v ? fmtDate(v) : tMeta(v) || tMeta('（空）'); };
    return [tMeta(k), f(A), f(B)] as [string, string, string];
  });
  if (metaRows.length) sections.push([t('文档属性'), metaRows]);
  const identical = A.sha256 === B.sha256;
  return (
    <div className="scroll">
      <div className="details selectable">
        {identical && <div className="err" style={{ background: 'var(--green-2)', color: 'var(--green-active)', marginBottom: 12 }}>{t('两个文件的 SHA-256 完全一致，是同一个文件。')}</div>}
        <table>
          <thead><tr><th>{t('属性')}</th><th><span className={`badge ${A.type}`}>{A.type.toUpperCase()}</span> {t('原始文档')}</th><th><span className={`badge ${B.type}`}>{B.type.toUpperCase()}</span> {t('修改后文档')}</th></tr></thead>
          <tbody>
            {sections.map(([title, rows]) => (
              <React.Fragment key={title}>
                <tr className="sect"><th colSpan={3}>{title}</th></tr>
                {rows.map(([k, a, b, mono]) => {
                  const diff = a !== b && k !== tMeta('位置') && k !== tMeta('文件名');
                  return (
                    <tr key={k} className={diff ? 'diff' : ''}>
                      <th>{k}</th>
                      <td className={`a ${mono ? 'mono' : ''}`}>{a}</td>
                      <td className={`b ${mono ? 'mono' : ''}`}>{b}</td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
