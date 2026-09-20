import JSZip from 'jszip';
import type { Block, Run, DocModel, FileInfo } from './model';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

type RPr = Partial<Omit<Run, 't'>>;
interface StyleDef { name: string; basedOn?: string; rPr: RPr; outline?: number; type: string; numId?: string; ilvl?: number }

function kids(el: Element | null | undefined, local?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!local || c.localName === local) out.push(c);
  return out;
}
function kid(el: Element | null | undefined, local: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === local) return c;
  return null;
}
function wattr(el: Element | null, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W, name) ?? el.getAttribute('w:' + name);
}
function toggle(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const v = wattr(el, 'val');
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}

function parseRPr(rPr: Element | null): RPr {
  const o: RPr = {};
  if (!rPr) return o;
  const b = toggle(kid(rPr, 'b')); if (b !== undefined) o.b = b;
  const i = toggle(kid(rPr, 'i')); if (i !== undefined) o.i = i;
  const u = kid(rPr, 'u'); if (u) o.u = toggle(u);
  const s = toggle(kid(rPr, 'strike')) ?? toggle(kid(rPr, 'dstrike')); if (s !== undefined) o.s = s;
  const sz = kid(rPr, 'sz'); if (sz) { const v = parseInt(wattr(sz, 'val') || '', 10); if (v) o.sz = v / 2; }
  const c = kid(rPr, 'color'); if (c) { const v = wattr(c, 'val'); if (v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v)) o.color = '#' + v.toUpperCase(); }
  const hl = kid(rPr, 'highlight'); if (hl) { const v = wattr(hl, 'val'); if (v && v !== 'none') o.hl = v; }
  const shd = kid(rPr, 'shd'); if (shd && !o.hl) { const v = wattr(shd, 'fill'); if (v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v) && v.toUpperCase() !== 'FFFFFF') o.hl = '#' + v.toUpperCase(); }
  const f = kid(rPr, 'rFonts'); if (f) { const v = wattr(f, 'eastAsia') || wattr(f, 'ascii') || wattr(f, 'hAnsi'); if (v) o.font = v; }
  return o;
}

const HL: Record<string, string> = { yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF', red: '#FF0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000' };

async function hashBytes(u8: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-1', u8);
  return [...new Uint8Array(h)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function parseDocx(file: FileInfo): Promise<DocModel> {
  const zip = await JSZip.loadAsync(file.data);
  const xml = async (p: string) => {
    const f = zip.file(p);
    if (!f) return null;
    return new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  };
  const doc = await xml('word/document.xml');
  if (!doc) throw new Error('不是有效的 DOCX 文件（缺少 word/document.xml）');

  // ---- styles ----
  const styles = new Map<string, StyleDef>();
  let defaultRPr: RPr = {};
  let defaultParaStyle = '';
  const stylesDoc = await xml('word/styles.xml');
  if (stylesDoc) {
    const dd = stylesDoc.getElementsByTagNameNS(W, 'rPrDefault')[0];
    if (dd) defaultRPr = parseRPr(kid(dd, 'rPr'));
    for (const s of Array.from(stylesDoc.getElementsByTagNameNS(W, 'style'))) {
      const id = wattr(s, 'styleId') || '';
      const pPr = kid(s, 'pPr');
      const numPr = kid(pPr, 'numPr');
      const def: StyleDef = {
        type: wattr(s, 'type') || '',
        name: wattr(kid(s, 'name'), 'val') || id,
        basedOn: wattr(kid(s, 'basedOn'), 'val') || undefined,
        rPr: parseRPr(kid(s, 'rPr')),
        outline: kid(pPr, 'outlineLvl') ? parseInt(wattr(kid(pPr, 'outlineLvl'), 'val') || '9', 10) : undefined,
        numId: wattr(kid(numPr, 'numId'), 'val') || undefined,
        ilvl: kid(numPr, 'ilvl') ? parseInt(wattr(kid(numPr, 'ilvl'), 'val') || '0', 10) : undefined,
      };
      styles.set(id, def);
      if (def.type === 'paragraph' && (wattr(s, 'default') === '1' || wattr(s, 'default') === 'true')) defaultParaStyle = id;
    }
  }
  const styleChain = (id: string | null | undefined): StyleDef[] => {
    const out: StyleDef[] = [];
    let cur = id ? styles.get(id) : undefined;
    let guard = 0;
    while (cur && guard++ < 20) { out.unshift(cur); cur = cur.basedOn ? styles.get(cur.basedOn) : undefined; }
    return out;
  };
  const styleRPr = (id: string | null | undefined): RPr => Object.assign({}, ...styleChain(id).map((s) => s.rPr));
  const headingLevel = (id: string | null | undefined): number => {
    for (const s of styleChain(id).reverse()) {
      const n = s.name.toLowerCase();
      const m = n.match(/^heading\s*(\d)/) || n.match(/^标题\s*(\d)/);
      if (m) return Math.min(6, parseInt(m[1], 10));
      if (n === 'title' || n === '标题') return 1;
      if (n === 'subtitle') return 2;
      if (s.outline !== undefined && s.outline < 9) return Math.min(6, s.outline + 1);
    }
    return 0;
  };

  // ---- numbering ----
  const numFmt = new Map<string, string>(); // `${numId}:${ilvl}` -> fmt
  const numText = new Map<string, string>();
  const numDoc = await xml('word/numbering.xml');
  if (numDoc) {
    const abs = new Map<string, Element>();
    for (const a of Array.from(numDoc.getElementsByTagNameNS(W, 'abstractNum'))) abs.set(wattr(a, 'abstractNumId') || '', a);
    for (const n of Array.from(numDoc.getElementsByTagNameNS(W, 'num'))) {
      const nid = wattr(n, 'numId') || '';
      const a = abs.get(wattr(kid(n, 'abstractNumId'), 'val') || '');
      if (!a) continue;
      for (const l of kids(a, 'lvl')) {
        const il = wattr(l, 'ilvl') || '0';
        numFmt.set(`${nid}:${il}`, wattr(kid(l, 'numFmt'), 'val') || 'bullet');
        numText.set(`${nid}:${il}`, wattr(kid(l, 'lvlText'), 'val') || '');
      }
    }
  }
  const counters = new Map<string, number[]>();

  // ---- rels & images ----
  const relsDoc = await xml('word/_rels/document.xml.rels');
  const rels = new Map<string, string>();
  if (relsDoc) for (const r of Array.from(relsDoc.getElementsByTagName('Relationship'))) rels.set(r.getAttribute('Id') || '', r.getAttribute('Target') || '');
  const imgHash = new Map<string, string>();
  const imageKey = async (rid: string) => {
    if (imgHash.has(rid)) return imgHash.get(rid)!;
    let target = rels.get(rid) || '';
    const p = target.startsWith('/') ? target.slice(1) : 'word/' + target;
    const f = zip.file(p.replace(/\/\.\//g, '/'));
    const h = f ? await hashBytes(await f.async('uint8array')) : rid;
    imgHash.set(rid, h);
    return h;
  };

  // ---- body walk ----
  const blocks: Block[] = [];

  const collectRuns = async (container: Element, base: RPr, out: Run[]) => {
    for (const el of kids(container)) {
      const ln = el.localName;
      if (ln === 'r') {
        const rPr = kid(el, 'rPr');
        const rs = wattr(kid(rPr, 'rStyle'), 'val');
        const st: RPr = { ...base, ...styleRPr(rs), ...parseRPr(rPr) };
        if (st.hl && HL[st.hl]) st.hl = HL[st.hl];
        for (const c of kids(el)) {
          const cl = c.localName;
          if (cl === 't') out.push({ ...st, t: c.textContent || '' });
          else if (cl === 'tab') out.push({ ...st, t: '\t' });
          else if (cl === 'br' || cl === 'cr') { if (wattr(c, 'type') !== 'page') out.push({ ...st, t: '\n' }); }
          else if (cl === 'noBreakHyphen') out.push({ ...st, t: '‑' });
          else if (cl === 'sym') { const ch = wattr(c, 'char'); if (ch) out.push({ ...st, t: String.fromCharCode(parseInt(ch, 16) & 0xffff) }); }
          else if (cl === 'drawing' || cl === 'pict' || cl === 'object') {
            const blip = c.getElementsByTagNameNS('*', 'blip')[0] || c.getElementsByTagNameNS('*', 'imagedata')[0];
            const rid = blip ? (blip.getAttribute('r:embed') || blip.getAttribute('r:id') || '') : '';
            // 文本框内的文字
            const txbx = Array.from(c.getElementsByTagNameNS(W, 'txbxContent'));
            if (txbx.length) {
              for (const tb of txbx) for (const p of kids(tb, 'p')) await collectRuns(p, st, out);
            } else {
              out.push({ ...st, t: '[图片]', img: rid ? await imageKey(rid) : 'img' });
            }
          } else if (cl === 'AlternateContent') {
            const choice = kid(c, 'Choice') || kid(c, 'Fallback');
            if (choice) await collectRuns(choice, st, out);
          }
        }
      } else if (ln === 'hyperlink' || ln === 'ins' || ln === 'smartTag' || ln === 'fldSimple' || ln === 'customXml' || ln === 'sdt' || ln === 'sdtContent' || ln === 'moveTo' || ln === 'dir' || ln === 'bdo') {
        await collectRuns(ln === 'sdt' ? (kid(el, 'sdtContent') || el) : el, base, out);
      }
      // del / moveFrom（已删除的修订）忽略
    }
  };

  const paraBlock = async (p: Element, inCell = false): Promise<Block> => {
    const pPr = kid(p, 'pPr');
    const ps = wattr(kid(pPr, 'pStyle'), 'val') || defaultParaStyle;
    const base: RPr = { ...defaultRPr, ...styleRPr(ps) };
    const runs: Run[] = [];
    await collectRuns(p, base, runs);
    const jc = wattr(kid(pPr, 'jc'), 'val');
    const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : undefined;
    const b: Block = { kind: 'p', runs, align };
    if (inCell) return b;
    const hl = headingLevel(ps);
    // 列表
    const numPr = kid(pPr, 'numPr');
    let numId = wattr(kid(numPr, 'numId'), 'val') || undefined;
    let ilvl = kid(numPr, 'ilvl') ? parseInt(wattr(kid(numPr, 'ilvl'), 'val') || '0', 10) : undefined;
    if (!numId) {
      for (const s of styleChain(ps).reverse()) if (s.numId) { numId = s.numId; ilvl = ilvl ?? s.ilvl; break; }
    }
    if (hl) { b.kind = 'h'; b.level = hl; }
    else if (numId && numId !== '0') {
      const lvl = ilvl || 0;
      const fmt = numFmt.get(`${numId}:${lvl}`) || 'bullet';
      b.kind = 'li';
      b.level = lvl;
      if (fmt === 'bullet' || fmt === 'none') { b.list = 'ul'; b.marker = lvl % 2 ? '◦' : '•'; }
      else {
        b.list = 'ol';
        const arr = counters.get(numId) || [];
        arr[lvl] = (arr[lvl] || 0) + 1;
        arr.length = lvl + 1;
        counters.set(numId, arr);
        const n = arr[lvl];
        let tpl = numText.get(`${numId}:${lvl}`) || `%${lvl + 1}.`;
        tpl = tpl.replace(/%(\d)/g, (_m, d) => {
          const v = arr[parseInt(d, 10) - 1] || 1;
          const f = parseInt(d, 10) - 1 === lvl ? fmt : numFmt.get(`${numId}:${parseInt(d, 10) - 1}`) || 'decimal';
          return fmtNum(v, f);
        });
        b.marker = tpl || `${n}.`;
      }
    }
    return b;
  };

  const walk = async (container: Element) => {
    for (const el of kids(container)) {
      const ln = el.localName;
      if (ln === 'p') blocks.push(await paraBlock(el));
      else if (ln === 'tbl') {
        for (const tr of kids(el, 'tr')) {
          const cells: Run[][] = [];
          for (const tc of kids(tr, 'tc')) {
            const cr: Run[] = [];
            const ps = tc.getElementsByTagNameNS(W, 'p');
            Array.from(ps).forEach(() => {});
            let first = true;
            for (const p of Array.from(ps)) {
              const pb = await paraBlock(p, true);
              if (!first) cr.push({ t: '\n' });
              first = false;
              cr.push(...pb.runs);
            }
            cells.push(cr);
          }
          blocks.push({ kind: 'tr', runs: [], cells });
        }
      } else if (ln === 'sdt') await walk(kid(el, 'sdtContent') || el);
      else if (ln === 'customXml' || ln === 'ins') await walk(el);
    }
  };
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (body) await walk(body);

  // 合并相邻同样式 run，去掉完全空的段落尾部
  for (const b of blocks) {
    if (b.kind === 'tr') b.cells = b.cells!.map(mergeRuns);
    else b.runs = mergeRuns(b.runs);
  }

  // ---- 元数据 ----
  const meta: Record<string, string> = {};
  const core = await xml('docProps/core.xml');
  if (core) {
    const g = (n: string) => core.getElementsByTagNameNS('*', n)[0]?.textContent?.trim() || '';
    Object.assign(meta, {
      标题: g('title'), 主题: g('subject'), 作者: g('creator'), 关键词: g('keywords'), 备注: g('description'),
      最后修改者: g('lastModifiedBy'), 修订号: g('revision'), 文档创建时间: g('created'), 文档修改时间: g('modified'),
    });
  }
  let pageCount: number | undefined;
  const appx = await xml('docProps/app.xml');
  if (appx) {
    const g = (n: string) => appx.getElementsByTagNameNS('*', n)[0]?.textContent?.trim() || '';
    meta['应用程序'] = [g('Application'), g('AppVersion')].filter(Boolean).join(' ');
    meta['公司'] = g('Company');
    meta['模板'] = g('Template');
    const pg = parseInt(g('Pages'), 10);
    if (pg) pageCount = pg;
    meta['总编辑时间（分钟）'] = g('TotalTime');
  }
  meta['图片数量'] = String(Object.keys(zip.files).filter((f) => f.startsWith('word/media/')).length);
  const hasTracked = doc.getElementsByTagNameNS(W, 'ins').length + doc.getElementsByTagNameNS(W, 'del').length;
  meta['包含修订标记'] = hasTracked ? `是（${hasTracked} 处，按“接受全部”后的内容比较）` : '否';
  const cmts = zip.file('word/comments.xml');
  meta['批注数量'] = cmts ? String((await xml('word/comments.xml'))!.getElementsByTagNameNS(W, 'comment').length) : '0';

  return { file, type: 'docx', blocks, meta, pageCount };
}

function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.t) continue;
    const last = out[out.length - 1];
    if (last && !last.img && !r.img && sameStyle(last, r)) last.t += r.t;
    else out.push({ ...r });
  }
  return out;
}

export function sameStyle(a: Partial<Run>, b: Partial<Run>): boolean {
  return !!a.b === !!b.b && !!a.i === !!b.i && !!a.u === !!b.u && !!a.s === !!b.s && (a.sz || 0) === (b.sz || 0) && (a.color || '') === (b.color || '') && (a.hl || '') === (b.hl || '') && (a.font || '') === (b.font || '');
}

function fmtNum(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter': return String.fromCharCode(96 + ((n - 1) % 26) + 1);
    case 'upperLetter': return String.fromCharCode(64 + ((n - 1) % 26) + 1);
    case 'lowerRoman': return roman(n).toLowerCase();
    case 'upperRoman': return roman(n);
    case 'chineseCounting': case 'chineseCountingThousand': case 'ideographTraditional': case 'chineseLegalSimplified': return zh(n);
    case 'decimalEnclosedCircle': case 'decimalEnclosedCircleChinese': return n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
    default: return String(n);
  }
}
function roman(n: number) {
  const m: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s;
}
function zh(n: number) {
  const d = '零一二三四五六七八九';
  if (n < 10) return d[n];
  if (n < 20) return '十' + (n % 10 ? d[n % 10] : '');
  if (n < 100) return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '');
  return String(n);
}
