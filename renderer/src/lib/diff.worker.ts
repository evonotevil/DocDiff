// 大文档的比对放到这里跑，主线程只等结果，期间可以取消（直接 terminate）。
import { diffDocs, type DiffOptions, type DiffResult } from './engine';
import type { Block } from './model';

export interface DiffReq { id: number; blocksA: Block[]; blocksB: Block[]; opts: DiffOptions }
export type DiffRes =
  | { kind: 'ok'; id: number; res: DiffResult; ms: number }
  | { kind: 'err'; id: number; error: string };

self.onmessage = (e: MessageEvent<DiffReq>) => {
  const { id, blocksA, blocksB, opts } = e.data;
  const t0 = Date.now();
  try {
    const res = diffDocs(blocksA, blocksB, opts);
    (self as unknown as Worker).postMessage({ kind: 'ok', id, res, ms: Date.now() - t0 } satisfies DiffRes);
  } catch (err: any) {
    (self as unknown as Worker).postMessage({ kind: 'err', id, error: String(err?.message || err) } satisfies DiffRes);
  }
};
