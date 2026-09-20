import React from 'react';
import type { DocModel } from '../lib/model';
import { blockText, countWords, docPlainText, fmtBytes, fmtDate } from '../lib/model';

const TYPE_NAME: Record<string, string> = { docx: 'Word 文档 (.docx)', pdf: 'PDF 文档', txt: '纯文本' };

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
  sections.push(['文件', [
    ['文件名', A.file.name, B.file.name],
    ['格式', TYPE_NAME[A.type] || A.type, TYPE_NAME[B.type] || B.type],
    ['文件大小', `${fmtBytes(A.file.size)}（${A.file.size.toLocaleString()} 字节）`, `${fmtBytes(B.file.size)}（${B.file.size.toLocaleString()} 字节）`],
    ['位置', A.file.path, B.file.path],
    ['创建时间', fmtDate(A.file.birthtime), fmtDate(B.file.birthtime)],
    ['修改时间', fmtDate(A.file.mtime), fmtDate(B.file.mtime)],
    ['SHA-256', A.sha256 || '', B.sha256 || '', true],
  ]]);
  const sa = stats(A), sb = stats(B);
  sections.push(['内容统计', [
    ['页数', A.pageCount ? String(A.pageCount) : A.type === 'txt' ? '—' : '未知', B.pageCount ? String(B.pageCount) : B.type === 'txt' ? '—' : '未知'],
    ...Object.keys(sa).map((k) => [k, (sa as any)[k], (sb as any)[k]] as [string, string, string]),
  ]]);
  const keys = [...new Set([...Object.keys(A.meta), ...Object.keys(B.meta)])];
  const metaRows = keys.map((k) => {
    const f = (d: DocModel) => { const v = d.meta[k]; if (v === undefined) return '—'; return /时间$/.test(k) && v ? fmtDate(v) : v || '（空）'; };
    return [k, f(A), f(B)] as [string, string, string];
  });
  if (metaRows.length) sections.push(['文档属性', metaRows]);
  const identical = A.sha256 === B.sha256;
  return (
    <div className="scroll">
      <div className="details selectable">
        {identical && <div className="err" style={{ background: 'var(--green-2)', color: 'var(--green-active)', marginBottom: 12 }}>两个文件的 SHA-256 完全一致，是同一个文件。</div>}
        <table>
          <thead><tr><th>属性</th><th><span className={`badge ${A.type}`}>{A.type.toUpperCase()}</span> 原始文档</th><th><span className={`badge ${B.type}`}>{B.type.toUpperCase()}</span> 修改后文档</th></tr></thead>
          <tbody>
            {sections.map(([title, rows]) => (
              <React.Fragment key={title}>
                <tr className="sect"><th colSpan={3}>{title}</th></tr>
                {rows.map(([k, a, b, mono]) => {
                  const diff = a !== b && k !== '位置' && k !== '文件名';
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
