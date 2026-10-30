// 审阅稿写入放在 Worker 里：解压、改 XML、核对、重新打包都不占界面线程。
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { writeReview, prepareBase, type WriteInput, type WriteOutput, type Prepared } from './ooxml';

/** key：这份对方文件的标识（两份文件的 SHA）；同一份文件反复写时复用解压和预处理的结果 */
export type DraftReq = { id: number; key?: string } & Omit<WriteInput, 'io'>;
export type DraftRes =
  | { kind: 'ok'; id: number; out: WriteOutput }
  | { kind: 'err'; id: number; error: string };

const io = {
  parse: (s: string) => new DOMParser().parseFromString(s, 'application/xml') as unknown as Document,
  serialize: (d: Document) => new XMLSerializer().serializeToString(d as any),
};

let cache: { key: string; prep: Prepared } | null = null;
self.onmessage = async (e: MessageEvent<DraftReq>) => {
  const { id, key, ...inp } = e.data;
  try {
    if (key && cache?.key !== key) cache = { key, prep: await prepareBase(inp.base, io) };
    const out = await writeReview({ ...inp, io, prepared: key ? cache!.prep : undefined });
    (self as unknown as Worker).postMessage({ kind: 'ok', id, out } satisfies DraftRes, [out.bytes.buffer]);
  } catch (err: any) {
    (self as unknown as Worker).postMessage({ kind: 'err', id, error: String(err?.message || err) } satisfies DraftRes);
  }
};
