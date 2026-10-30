// 「最近比较」一行的名字（1.8）：两份文件共同的名字只写一次，下面写两边不同的那一段。
// 例：合作协议-第一轮.docx / 合作协议-第三轮.docx → { common: '合作协议', a: '第一轮', b: '第三轮' }
// 没有像样的共同部分、或有一边没有不同的部分时返回 null，界面退回“A → B”。
const SEP = /[-_ .·—–（）()\[\]【】]/;
const stem = (n: string) => n.replace(/\.(docx|pdf|txt|md)$/i, '');
const trimSep = (s: string) => s.replace(/^[-_ .·—–]+|[-_ .·—–]+$/g, '');
export function pairName(aName: string, bName: string): { common: string; a: string; b: string } | null {
  const a = stem(aName), b = stem(bName);
  if (a === b) return null;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  // 收到分隔符边界上，避免把一个词切成两半（“第一轮/第三轮”不切成“第”+“一轮/三轮”）
  const cutP = (x: string, n: number) => { let k = n; while (k > 0 && !SEP.test(x[k - 1]) && !SEP.test(x[k] ?? '-')) k--; return k; };
  const cutS = (x: string, n: number) => { let k = n; while (k > 0 && !SEP.test(x[x.length - k]) && !SEP.test(x[x.length - k - 1] ?? '-')) k--; return k; };
  p = Math.min(cutP(a, p), cutP(b, p));
  s = Math.min(cutS(a, s), cutS(b, s));
  const pre = trimSep(a.slice(0, p)), suf = trimSep(a.slice(a.length - s));
  const da = trimSep(a.slice(p, a.length - s)), db = trimSep(b.slice(p, b.length - s));
  const common = pre && suf ? `${pre}-${suf}` : pre || suf;
  if (Array.from(common).length < 2 || !da || !db) return null;
  return { common, a: da, b: db };
}
