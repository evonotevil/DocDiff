// 拖放文件：主界面两个放文件的区域和 1.8 的弹窗（用模板比较、加入新版本）共用
import { useState } from 'react';
import type React from 'react';
import type { FileInfo } from './model';

const api = (window as any).api || {};

export async function filesFromDrop(e: React.DragEvent): Promise<FileInfo[]> {
  const out: FileInfo[] = [];
  for (const f of Array.from(e.dataTransfer.files)) {
    const p = api.pathForFile(f);
    if (p) out.push(await api.readPath(p));
    else out.push({ path: '', name: f.name, ext: f.name.split('.').pop()!.toLowerCase(), size: f.size, mtime: f.lastModified, birthtime: f.lastModified, data: new Uint8Array(await f.arrayBuffer()) });
  }
  return out;
}
export function useDrop(onFiles: (f: FileInfo[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: async (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(false); onFiles(await filesFromDrop(e)); },
    },
  };
}
