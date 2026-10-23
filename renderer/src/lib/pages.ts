import type { DocModel } from './model';
import { openPdf, renderPdfPage, releasePage, PageImage } from './pdf';
import pixelmatch from 'pixelmatch';

const api = (window as any).api;
const pdfCache = new Map<string, Promise<Uint8Array>>();
const countCache = new Map<string, Promise<number>>();

/** 超过这个页数，图像 / OCR 比较前先告诉用户页数和预计时间，让他决定比全部还是只比一段（1.7.3） */
export const BIG_PAGES = 300;

/** 页码范围，从 1 开始，含两端 */
export interface PageRange { from: number; to: number }

export function getPdfBytes(d: DocModel): Promise<Uint8Array> {
  if (d.type === 'pdf') return Promise.resolve(d.file.data);
  const k = d.sha256!;
  if (!pdfCache.has(k)) {
    const p = api.renderToPdf({ kind: d.type, data: d.file.data, name: d.file.name }).then((b: any) => new Uint8Array(b));
    p.catch(() => pdfCache.delete(k));
    pdfCache.set(k, p);
  }
  return pdfCache.get(k)!;
}

/** 文档排成页面后的页数（Word / TXT 要先在本机排版） */
export function getPageCount(d: DocModel): Promise<number> {
  const k = d.sha256 || d.file.name;
  if (!countCache.has(k)) {
    const p = getPdfBytes(d).then(async (bytes) => { const pdf = await openPdf(bytes, d.pdfPassword); const n = pdf.numPages; await pdf.destroy(); return n; });
    p.catch(() => countCache.delete(k));
    countCache.set(k, p);
  }
  return countCache.get(k)!;
}

export const fullRange = (n: number): PageRange => ({ from: 1, to: Math.max(1, n) });
export const rangeKey = (r: PageRange) => `${r.from}-${r.to}`;

/**
 * 逐页渲染一份文档：每次只在内存里放一页的画布，交给 fn 用完就释放。
 * 1.7.2 以前一次把整份文档渲染成画布放进内存，所以只好截到 300 页；现在不再有上限。
 * 范围外的页不渲染；文档比范围短时，多出来的页码直接跳过。
 */
export async function forEachPage(d: DocModel, scale: number, range: PageRange, fn: (img: PageImage, i: number, n: number) => Promise<void> | void, alive: () => boolean = () => true) {
  const pdf = await openPdf(await getPdfBytes(d), d.pdfPassword);
  try {
    const to = Math.min(range.to, pdf.numPages);
    for (let i = range.from; i <= to; i++) {
      if (!alive()) return;
      const img = await renderPdfPage(pdf, i, scale);
      try { await fn(img, i, to - range.from + 1); } finally { releasePage(img); }
    }
  } finally { await pdf.destroy(); }
}

/**
 * 两份文档按页成对渲染：第 i 页对第 i 页。一方缺页时传 undefined。
 * 两份同时打开，但任何时候内存里最多只有一对画布。
 */
export async function forEachPagePair(A: DocModel, B: DocModel, scale: number, range: PageRange, fn: (a: PageImage | undefined, b: PageImage | undefined, i: number, n: number) => Promise<void>, alive: () => boolean = () => true) {
  const [pa, pb] = await Promise.all([openPdf(await getPdfBytes(A), A.pdfPassword), openPdf(await getPdfBytes(B), B.pdfPassword)]);
  try {
    const to = Math.min(range.to, Math.max(pa.numPages, pb.numPages));
    const n = to - range.from + 1;
    for (let i = range.from; i <= to; i++) {
      if (!alive()) return;
      const a = i <= pa.numPages ? await renderPdfPage(pa, i, scale) : undefined;
      const b = i <= pb.numPages ? await renderPdfPage(pb, i, scale) : undefined;
      try { await fn(a, b, i, n); } finally { releasePage(a); releasePage(b); }
    }
  } finally { await Promise.all([pa.destroy(), pb.destroy()]); }
}

/** 已经比完的页面结果（只有压缩后的图片地址，不占画布）；切走再切回图像模式不用重新渲染 */
const diffCache = new Map<string, PageDiff[]>();
export const imageCacheKey = (A: DocModel, B: DocModel, threshold: number, r: PageRange) => `${A.sha256}|${B.sha256}|${threshold}|${rangeKey(r)}`;
export const getCachedDiffs = (k: string) => diffCache.get(k);
export function setCachedDiffs(k: string, v: PageDiff[]) {
  diffCache.set(k, v);
  while (diffCache.size > 4) {
    const old = diffCache.keys().next().value as string;
    for (const d of diffCache.get(old) || []) for (const u of [d.aUrl, d.bUrl, d.diffUrl]) if (u) URL.revokeObjectURL(u);
    diffCache.delete(old);
  }
}

export interface Box { x: number; y: number; w: number; h: number }
export interface PageDiff { page?: number; pct: number; diffUrl?: string; boxes: Box[]; aUrl?: string; bUrl?: string; aspect: number; aMissing?: boolean; bMissing?: boolean }

// 页面截图压成 WebP 存地址，画布随即释放；差异图大面积是白色，PNG 更小也更清楚
async function urlOf(c: HTMLCanvasElement, type: 'image/webp' | 'image/png' = 'image/webp'): Promise<string> {
  const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), type, 0.92));
  return URL.createObjectURL(b);
}

export async function diffPage(a: PageImage | undefined, b: PageImage | undefined, threshold: number): Promise<PageDiff> {
  if (!a || !b) {
    const p = (a || b)!;
    return { pct: 100, boxes: [], aUrl: a ? await urlOf(a.canvas) : undefined, bUrl: b ? await urlOf(b.canvas) : undefined, aspect: p.height / p.width, aMissing: !a, bMissing: !b };
  }
  const w = a.width, h = a.height;
  const cb = document.createElement('canvas');
  cb.width = w; cb.height = h;
  const cx = cb.getContext('2d', { willReadFrequently: true })!;
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
  cx.drawImage(b.canvas, 0, 0, w, Math.round(b.height * (w / b.width)));
  const da = a.canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h);
  const db = cx.getImageData(0, 0, w, h);
  const out = new ImageData(w, h);
  const n = pixelmatch(da.data, db.data, out.data, w, h, { threshold, includeAA: false, alpha: 0.18, diffColor: [229, 77, 46], diffColorAlt: [18, 165, 148] } as any);
  // 差异像素 → 网格 → 连通区域
  const G = 10;
  const gw = Math.ceil(w / G), gh = Math.ceil(h / G);
  const grid = new Uint8Array(gw * gh);
  const d = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if ((d[i] === 229 && d[i + 1] === 77 && d[i + 2] === 46) || (d[i] === 18 && d[i + 1] === 165 && d[i + 2] === 148)) grid[Math.floor(y / G) * gw + Math.floor(x / G)] = 1;
  }
  const seen = new Uint8Array(gw * gh);
  const boxes: Box[] = [];
  const R = 2; // 合并半径（格）
  for (let s = 0; s < grid.length; s++) {
    if (!grid[s] || seen[s]) continue;
    let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
    const st = [s]; seen[s] = 1;
    while (st.length) {
      const c = st.pop()!;
      const cx0 = c % gw, cy0 = (c / gw) | 0;
      minx = Math.min(minx, cx0); maxx = Math.max(maxx, cx0); miny = Math.min(miny, cy0); maxy = Math.max(maxy, cy0);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const nx = cx0 + dx, ny = cy0 + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const ni = ny * gw + nx;
        if (grid[ni] && !seen[ni]) { seen[ni] = 1; st.push(ni); }
      }
    }
    boxes.push({ x: (minx * G - 3) / w, y: (miny * G - 3) / h, w: ((maxx - minx + 1) * G + 6) / w, h: ((maxy - miny + 1) * G + 6) / h });
    if (boxes.length > 300) break;
  }
  const dc = document.createElement('canvas');
  dc.width = w; dc.height = h;
  dc.getContext('2d')!.putImageData(out, 0, 0);
  const res = { pct: (n / (w * h)) * 100, boxes, diffUrl: await urlOf(dc, 'image/png'), aUrl: await urlOf(a.canvas), bUrl: await urlOf(cb), aspect: h / w };
  dc.width = dc.height = cb.width = cb.height = 0;
  return res;
}
