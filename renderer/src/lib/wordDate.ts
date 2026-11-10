// Word 里批注、修订的时间（w:date）：Word 写的是“本地钟点”，后面却带着 Z（看起来像 UTC，其实不是）；
// 显示时也按本地钟点原样显示。新版 Word 另外在 commentsExtensible.xml 里写一份真正的 UTC（w16cex:dateUtc）。
// 1.9.6 起 DocDiff 读写都按这个约定：读的时候优先用 dateUtc，没有就把 w:date 当本地钟点；写的时候写本地钟点 + Z，
// 这样在 Word 里看到的时间就是你做决定 / 写回复时墙上的时间，和别人在 Word 里写的批注对得上。
const p2 = (x: number) => String(x).padStart(2, '0');
/** 毫秒时间 → Word 的 w:date（本地钟点 + Z） */
export function wordDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}Z`;
}
/** 给 docx 库用的 Date：它会按 toISOString 写出 UTC，所以先挪掉时区差，写出来的就是本地钟点 */
export function wordDateObj(ms: number): Date { return new Date(ms - new Date(ms).getTimezoneOffset() * 60000); }
/** Word 的 w:date（本地钟点）→ 真正的时间（ISO，UTC）。读不出来返回 undefined */
export function fromWordDate(s?: string | null): string | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return undefined;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
