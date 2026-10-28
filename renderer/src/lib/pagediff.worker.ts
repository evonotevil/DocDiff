// 图像模式的逐像素比较（1.7.4 移出主线程）：pixelmatch、差异区域分组、差异图 PNG 编码都在这里做。
// 以前每页约 0.2–0.4 秒的像素循环在主线程上，十几页就是好几秒卡顿，期间还有大块 ImageData 触发的整堆 GC。
import pixelmatch from 'pixelmatch';

export interface PageDiffReq { id: number; w: number; h: number; a: ArrayBuffer; b: ArrayBuffer; threshold: number }
export interface Box { x: number; y: number; w: number; h: number }
export type PageDiffRes = { id: number; ok: true; n: number; boxes: Box[]; png: Blob } | { id: number; ok: false; error: string };

export function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, threshold: number) {
  const out = new Uint8ClampedArray(w * h * 4);
  const n = pixelmatch(a, b, out, w, h, { threshold, includeAA: false, alpha: 0.18, diffColor: [229, 77, 46], diffColorAlt: [18, 165, 148] } as any);
  // 差异像素 → 网格 → 连通区域
  const G = 10;
  const gw = Math.ceil(w / G), gh = Math.ceil(h / G);
  const grid = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if ((out[i] === 229 && out[i + 1] === 77 && out[i + 2] === 46) || (out[i] === 18 && out[i + 1] === 165 && out[i + 2] === 148)) grid[Math.floor(y / G) * gw + Math.floor(x / G)] = 1;
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
  return { n, boxes, out };
}

if (typeof (globalThis as any).WorkerGlobalScope !== 'undefined' && self instanceof (globalThis as any).WorkerGlobalScope) {
  self.onmessage = async (e: MessageEvent<PageDiffReq>) => {
    const { id, w, h, a, b, threshold } = e.data;
    try {
      const { n, boxes, out } = pixelDiff(new Uint8ClampedArray(a), new Uint8ClampedArray(b), w, h, threshold);
      const oc = new OffscreenCanvas(w, h);
      oc.getContext('2d')!.putImageData(new ImageData(out, w, h), 0, 0);
      const png = await oc.convertToBlob({ type: 'image/png' });
      (self as any).postMessage({ id, ok: true, n, boxes, png } satisfies PageDiffRes);
    } catch (err: any) {
      (self as any).postMessage({ id, ok: false, error: String(err?.message || err) } satisfies PageDiffRes);
    }
  };
}
