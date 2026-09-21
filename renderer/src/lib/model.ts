// 统一文档模型：所有格式都解析成 Block[]，每个 Block 由带样式的 Run 组成
export interface Run {
  t: string;
  b?: boolean; // 粗体
  i?: boolean; // 斜体
  u?: boolean; // 下划线
  s?: boolean; // 删除线
  sz?: number; // 字号 pt
  color?: string; // #RRGGBB
  hl?: string; // 高亮/底纹色
  font?: string;
  img?: string; // 图片指纹（内容哈希），用于检测图片变化
}

export type BlockKind = 'p' | 'h' | 'li' | 'tr';

export interface Block {
  kind: BlockKind;
  level?: number; // 标题级别 / 列表层级
  list?: 'ul' | 'ol';
  marker?: string; // 列表符号，如 "•" "1."
  align?: 'left' | 'center' | 'right' | 'justify';
  runs: Run[]; // p/h/li
  cells?: Run[][]; // tr
  page?: number; // PDF 页码（从 1 开始）
}

export interface FileInfo {
  path: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
  birthtime: number;
  data: Uint8Array;
}

export interface DocModel {
  file: FileInfo;
  type: 'docx' | 'pdf' | 'txt';
  blocks: Block[];
  meta: Record<string, string>;
  pageCount?: number;
  sha256?: string;
  encoding?: string;
  pdfPassword?: string;
}

export function blockText(b: Block): string {
  if (b.kind === 'tr') return (b.cells || []).map((c) => c.map((r) => r.t).join('')).join('\t');
  return b.runs.map((r) => r.t).join('');
}

export function docPlainText(d: DocModel): string {
  return d.blocks.map(blockText).join('\n');
}

export function countWords(text: string): { words: number; chars: number; charsNoSpace: number } {
  const cjk = (text.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g) || []).length;
  const latin = (text.replace(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
  return { words: cjk + latin, chars: [...text].length, charsNoSpace: [...text.replace(/\s/g, '')].length };
}

export async function sha256(data: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtDate(ms: number | string | undefined): string {
  if (ms === undefined || ms === '' || ms === null) return '';
  const d = typeof ms === 'number' ? new Date(ms) : new Date(ms);
  if (isNaN(d.getTime())) return String(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
