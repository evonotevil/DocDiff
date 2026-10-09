import { useEffect, useRef, useState } from 'react';
import { diffDocs, type DiffOptions, type DiffResult } from './engine';
import type { Block } from './model';
import type { DiffRes } from './diff.worker';

/**
 * 为什么是"自适应"而不是一律进 Worker：
 * 实测 1250 段 / 15% 改动的文档，diffDocs 只要约 230ms，而把结果 postMessage 回主线程
 * 的结构化克隆要约 430ms —— 一律进 Worker 反而更慢，因为反序列化同样阻塞主线程。
 * 只有"体量大 + 改动多"的文档（3000 段全文重写：diff 约 2.9s，克隆约 1.0s）才值得。
 * 所以这里按体量选路：小的同步算，大的进 Worker 并允许取消。
 */
const HEAVY_CHARS = 150_000;
const HEAVY_BLOCKS = 1500;

export function docChars(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.cells) { for (const c of b.cells) for (const r of c) n += r.t.length; }
    else for (const r of b.runs) n += r.t.length;
  }
  return n;
}
export function isHeavy(a: Block[], b: Block[]): boolean {
  return a.length + b.length > HEAVY_BLOCKS * 2 || docChars(a) + docChars(b) > HEAVY_CHARS;
}

export interface DiffTask { key: string; blocksA: Block[]; blocksB: Block[]; opts: DiffOptions }
export interface DiffState { res: DiffResult | null; running: boolean; heavy: boolean; error: string | null; cancelled: boolean; cancel: () => void; retry: () => void }

export function useDiff(task: DiffTask | null): DiffState {
  const [state, setState] = useState<{ key: string | null; res: DiffResult | null; running: boolean; error: string | null; cancelled: boolean }>(
    { key: null, res: null, running: false, error: null, cancelled: false },
  );
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const skip = useRef<string | null>(null); // 被用户取消掉的 key，不自动重试
  const [gen, setGen] = useState(0);          // 「重新比较」靠它把 effect 再踢一次

  const kill = () => { worker.current?.terminate(); worker.current = null; reqId.current++; };
  useEffect(() => () => kill(), []);

  const heavy = !!task && isHeavy(task.blocksA, task.blocksB);

  useEffect(() => {
    if (!task) return;                          // 任务为空时保留上一次结果，切 tab 回来是瞬时的
    if (task.key === state.key) return;          // 已经算过
    if (task.key === skip.current) return;       // 用户取消过这一次

    if (!isHeavy(task.blocksA, task.blocksB)) {
      try {
        const res = diffDocs(task.blocksA, task.blocksB, task.opts);
        setState({ key: task.key, res, running: false, error: null, cancelled: false });
      } catch (err: any) {
        setState({ key: task.key, res: null, running: false, error: String(err?.message || err), cancelled: false });
      }
      return;
    }

    kill();
    const id = ++reqId.current;
    setState((s) => ({ ...s, running: true, error: null, cancelled: false }));
    const w = new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<DiffRes>) => {
      const d = e.data;
      if (d.id !== reqId.current) return;
      w.terminate();
      if (worker.current === w) worker.current = null;
      if (d.kind === 'ok') setState({ key: task.key, res: d.res, running: false, error: null, cancelled: false });
      else setState({ key: task.key, res: null, running: false, error: d.error, cancelled: false });
    };
    w.onerror = () => {
      if (worker.current === w) worker.current = null;
      // Worker 起不来就退回主线程同步算，不能让用户卡在空界面
      try {
        const res = diffDocs(task.blocksA, task.blocksB, task.opts);
        setState({ key: task.key, res, running: false, error: null, cancelled: false });
      } catch (err: any) {
        setState({ key: task.key, res: null, running: false, error: String(err?.message || err), cancelled: false });
      }
    };
    w.postMessage({ id, blocksA: task.blocksA, blocksB: task.blocksB, opts: task.opts });
  }, [task?.key, state.key, gen]);

  return {
    res: task && state.key === task.key ? state.res : (state.running ? null : state.res),
    running: state.running,
    heavy,
    error: state.error,
    cancelled: state.cancelled,
    cancel: () => { kill(); skip.current = task?.key ?? null; setState((s) => ({ ...s, running: false, cancelled: true, res: null, key: null })); },
    retry: () => { skip.current = null; setState((s) => ({ ...s, cancelled: false, error: null, key: null })); setGen((g) => g + 1); },
  };
}
