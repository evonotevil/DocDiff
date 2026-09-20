import type { DocModel, FileInfo, Block } from './model';

export function decodeText(data: Uint8Array): { text: string; encoding: string } {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(data.subarray(3)), encoding: 'UTF-8 (BOM)' };
  if (data[0] === 0xff && data[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(data.subarray(2)), encoding: 'UTF-16 LE' };
  if (data[0] === 0xfe && data[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(data.subarray(2)), encoding: 'UTF-16 BE' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(data), encoding: 'UTF-8' }; } catch {}
  try { return { text: new TextDecoder('gb18030', { fatal: true }).decode(data), encoding: 'GB18030 (GBK)' }; } catch {}
  try { return { text: new TextDecoder('big5', { fatal: true }).decode(data), encoding: 'Big5' }; } catch {}
  return { text: new TextDecoder('windows-1252').decode(data), encoding: 'Windows-1252' };
}

export function parseTxt(file: FileInfo): DocModel {
  const { text, encoding } = decodeText(file.data);
  const eol = /\r\n/.test(text) ? 'CRLF (Windows)' : /\r/.test(text) ? 'CR (旧 Mac)' : 'LF (Unix/macOS)';
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const blocks: Block[] = lines.map((l) => ({ kind: 'p', runs: l ? [{ t: l }] : [] }));
  return {
    file, type: 'txt', blocks, encoding,
    meta: { 编码: encoding, 换行符: eol, 行数: String(lines.length), 末尾换行: /\n$/.test(text) ? '有' : '无' },
  };
}

export function getText(data: Uint8Array) { return decodeText(data).text; }
