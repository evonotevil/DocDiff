import type { DocModel } from './model';
import { renderPdfPages, PageImage } from './pdf';
import pixelmatch from 'pixelmatch';

const api = (window as any).api;
const pdfCache = new Map<string, Promise<Uint8Array>>();
const pageCache = new Map<string, Promise<PageImage[]>>();

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

export function getPages(d: DocModel, scale: number, onProgress?: (i: number, n: number) => void): Promise<PageImage[]> {
  const k = `${d.sha256}@${scale}`;
  if (!pageCache.has(k)) {
    const p = getPdfBytes(d).then((bytes) => renderPdfPages(bytes, { scale, password: d.pdfPassword, onProgress, maxPages: 300 }));
    p.catch(() => pageCache.delete(k));
    pageCache.set(k, p);
  }
  return pageCache.get(k)!;
}

export interface Box { x: number; y: number; w: number; h: number }
export interface PageDiff { pct: number; diffUrl?: string; boxes: Box[]; aUrl?: string; bUrl?: string; aspect: number; aMissing?: boolean; bMissing?: boolean }

const urlCache = new WeakMap<HTMLCanvasElement, string>();
async function urlOf(c: HTMLCanvasElement): Promise<string> {
  if (urlCache.has(c)) return urlCache.get(c)!;
  const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/png'));
  const u = URL.createObjectURL(b);
  urlCache.set(c, u);
  return u;
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
  return { pct: (n / (w * h)) * 100, boxes, diffUrl: await urlOf(dc), aUrl: await urlOf(a.canvas), bUrl: await urlOf(cb), aspect: h / w };
}
