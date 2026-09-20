import type { DocModel, FileInfo } from './model';
import { sha256 } from './model';
import { parseDocx } from './docx';
import { parsePdf } from './pdf';
import { parseTxt } from './txt';

function friendly(e: any, file: FileInfo): Error {
  const m = String(e?.message || e);
  if (e?.name === 'NeedPassword' || /密码/.test(m)) return e;
  if (/central directory|zip|Corrupted/i.test(m)) return new Error(`「${file.name}」好像损坏了，或者不是真正的 Word 文档。试试在 Word 里重新另存为 .docx。`);
  if (/Invalid PDF|InvalidPDF|Missing PDF/i.test(m)) return new Error(`「${file.name}」无法作为 PDF 读取，文件可能已损坏或只下载了一部分。`);
  if (/ENOENT/.test(m)) return new Error(`找不到「${file.name}」，它可能被移动或删除了。`);
  if (/EACCES|EPERM/.test(m)) return new Error(`没有权限读取「${file.name}」。`);
  return e instanceof Error ? e : new Error(m);
}

export async function loadDoc(file: FileInfo, password?: string): Promise<DocModel> {
  try { return await loadDocInner(file, password); } catch (e: any) { throw friendly(e, file); }
}

async function loadDocInner(file: FileInfo, password?: string): Promise<DocModel> {
  let d: DocModel;
  if (file.ext === 'docx') d = await parseDocx(file);
  else if (file.ext === 'pdf') d = await parsePdf(file, password);
  else if (['txt', 'md', 'text', 'log', 'csv'].includes(file.ext)) d = parseTxt(file);
  else if (file.ext === 'doc') throw new Error('暂不支持旧版 .doc 格式。请在 Word 里「另存为」.docx 后再试。');
  else throw new Error(`还不支持 .${file.ext} 文件。目前支持 Word（.docx）、PDF 和文本（.txt）。`);
  d.sha256 = await sha256(file.data);
  return d;
}
