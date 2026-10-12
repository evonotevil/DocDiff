// 两种可以带走的结论：复制摘要（Markdown）和比对报告（PDF）。
// 两者都带“比对凭证”：文件、条件、范围、对齐方式和审阅状态，结论措辞不说“完全一致”。
import type { Block, DocModel, Sec } from './model';
import type { Change, DiffResult } from './engine';
import type { DecMap } from './review';
import type { Risk } from './insight';
import type { ScopeInfo } from './scope';
import { redlinePieces } from './exportDocx';
import { riskTag, riskText, noteText } from './describe';
import { fmtDate } from './model';
import { t, isEn } from './i18n';

const KIND: Record<string, string> = { del: '删除', ins: '新增', mod: '修改', fmt: '格式', move: '移动' };
const SEC: Record<Sec, string> = { header: '页眉', body: '正文', footnote: '脚注', footer: '页脚' };
const VERDICT: Record<string, string> = { a: '接受', r: '拒绝', h: '待议' };
const short = (s: string, n = 120) => { const x = s.replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n) + '…' : x; };
const sep = () => (isEn() ? '; ' : '；');

export interface Ctx {
  A: DocModel; B: DocModel; res: DiffResult; clauses: Map<number, string | null>; risks: Risk[];
  decisions: DecMap; scope: ScopeInfo; reviewer: string;
}

/** 变更按“区段 / 条款”分组，保持文档顺序 */
export function groupChanges(changes: Change[], clauses: Map<number, string | null>): { title: string; items: Change[] }[] {
  const out: { title: string; items: Change[] }[] = [];
  for (const c of changes) {
    const sec = c.sec || 'body';
    const title = sec !== 'body' ? t(SEC[sec]) : clauses.get(c.id) ?? t('开头部分');
    const last = out[out.length - 1];
    if (last && last.title === title) last.items.push(c);
    else out.push({ title, items: [c] });
  }
  return out;
}

export function changeBody(c: Change, q = (s: string) => `“${short(s)}”`): string {
  return c.kind === 'mod' ? `${q(c.before)} → ${q(c.after)}`
    : c.kind === 'del' ? q(c.before)
    : c.kind === 'ins' ? q(c.after)
    : c.kind === 'fmt' ? `${q(c.before)}（${noteText(c)}）`
    : `${q(c.before)}（${t('整段移动')}）`;
}

function verdictText(d: DecMap[number] | undefined): string {
  if (!d?.v) return d?.note ? t('备注：{n}', { n: d.note }) : '';
  return `${d.by ? d.by + ' · ' : ''}${t(VERDICT[d.v])}${d.note ? `：${d.note}` : ''}`;
}

/** 复制摘要：可以直接贴进邮件 / 飞书 / 文档 */
export function summaryMarkdown(x: Ctx): string {
  const { A, B, res, clauses, risks, decisions, scope } = x;
  const s = res.stats;
  const L: string[] = [
    t('## 文档差异摘要'), '',
    `- ${t('原始文档')}：${A.file.name}${A.sha256 ? `（SHA-256 ${A.sha256.slice(0, 12)}…）` : ''}`,
    `- ${t('修改后文档')}：${B.file.name}${B.sha256 ? `（SHA-256 ${B.sha256.slice(0, 12)}…）` : ''}`,
    `- ${res.changes.length
      ? t('在已比较的范围内发现 {n} 处差异：删除 {del}、新增 {ins}、修改 {mod}', { n: res.changes.length, del: s.del, ins: s.ins, mod: s.mod }) + (s.fmt ? t('、格式 {n}', { n: s.fmt }) : '') + (s.move ? t('、移动 {n}', { n: s.move }) : '')
      : t('在已比较的范围内未发现差异')}`,
  ];
  const decided = res.changes.filter((c) => decisions[c.id]?.v).length;
  if (decided) {
    const n = (v: string) => res.changes.filter((c) => decisions[c.id]?.v === v).length;
    L.push(`- ${t('审阅进度：已处理 {d}/{n}（接受 {a}、拒绝 {r}、待议 {h}）', { d: decided, n: res.changes.length, a: n('a'), r: n('r'), h: n('h') })}`);
  }
  if (risks.length) {
    L.push('', t('### 需要留意（{n}）', { n: risks.length }), '');
    const byId = new Map(res.changes.map((c) => [c.id, c]));
    risks.forEach((r, i) => {
      const c = byId.get(r.cid)!;
      const where = c.sec && c.sec !== 'body' ? t(SEC[c.sec]) : clauses.get(c.id) ?? t('开头部分');
      L.push(`${i + 1}. **${riskTag(r)}** ${where}：${changeBody(c)}（${riskText(r)}）`);
    });
  }
  if (res.changes.length) {
    L.push('', t('### 变更明细'));
    let k = 0;
    for (const g of groupChanges(res.changes, clauses)) {
      L.push('', `#### ${g.title}`, '');
      for (const c of g.items) {
        const v = verdictText(decisions[c.id]);
        L.push(`${++k}. **${t(KIND[c.kind])}**：${changeBody(c)}${v ? ` — ${v}` : ''}`);
      }
    }
  }
  L.push('', '---', '',
    `${t('比较条件')}：${scope.conditions.join(sep())}`,
    `${t('比较范围')}：${scope.compared.join(isEn() ? ', ' : '、')}${scope.notCompared.length ? `${sep()}${t('未比较')}：${scope.notCompared.join(isEn() ? ', ' : '、')}` : ''}`,
    `${t('对齐方式')}：${scope.alignment}`,
    t('由 DocDiff 在本机生成，文档没有上传。'));
  return L.join('\n');
}

// ---------------------------------------------------------------- PDF 报告
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function redlineHtml(res: DiffResult, blocksA: Block[], blocksB: Block[]): string {
  const out: string[] = [];
  let lastSec: Sec | undefined;
  const hasSec = res.rows.some((r) => r.sec && r.sec !== 'body');
  for (const r of res.rows) {
    const sec = r.sec || 'body';
    if (hasSec && sec !== lastSec) { out.push(`<div class="sec">${esc(t(SEC[sec]))}</div>`); lastSec = sec; }
    const rp = redlinePieces(r, () => undefined, false);
    if (!rp) continue;
    const list = rp.block === 'a' ? (r.aList || [r.ai!]) : (r.bList || [r.bi!]);
    list.forEach((bi, k) => {
      const blk = rp.block === 'a' ? blocksA[bi] : blocksB[bi];
      if (!blk) return;
      const pieces = rp.pieces.filter((p) => p.blk === k && !p.anchor);
      const span = (p: typeof pieces[number]) => {
        const txt = esc(p.t);
        const st = p.st || {};
        const style = `${st.b ? 'font-weight:700;' : ''}${st.i ? 'font-style:italic;' : ''}`;
        const inner = style ? `<span style="${style}">${txt}</span>` : txt;
        if (p.mark === 'del') return `<del>${inner}</del>`;
        if (p.mark === 'ins') return `<ins>${inner}</ins>`;
        if (p.mark === 'mdel') return `<del class="mv">${inner}</del>`;
        if (p.mark === 'mins') return `<ins class="mv">${inner}</ins>`;
        if (p.fmt) return `<span class="fmt">${inner}</span>`;
        return inner;
      };
      if (blk.kind === 'tr') {
        const n = Math.max(1, blk.cells?.length || 1);
        const cells = Array.from({ length: n }, (_, ci) => pieces.filter((p) => !p.sep && Math.min(n - 1, p.cell) === ci).map(span).join(''));
        out.push(`<table class="rt"><tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr></table>`);
        return;
      }
      const body = pieces.filter((p) => !p.sep).map(span).join('');
      const tag = blk.kind === 'h' ? `h${Math.min(4, (blk.level || 1) + 1)}` : 'p';
      const mk = blk.kind === 'li' ? `<span class="mk">${esc(blk.marker || '•')}</span>` : '';
      out.push(`<${tag}${blk.align === 'center' ? ' style="text-align:center"' : ''}>${mk}${body || '&nbsp;'}</${tag}>`);
    });
  }
  return out.join('\n');
}

export function reportHtml(x: Ctx, blocksA: Block[], blocksB: Block[]): string {
  const { A, B, res, clauses, risks, decisions, scope } = x;
  const byId = new Map(res.changes.map((c) => [c.id, c]));
  const where = (c: Change) => (c.sec && c.sec !== 'body' ? t(SEC[c.sec]) : clauses.get(c.id) ?? t('开头部分'));
  const n = (v: string) => res.changes.filter((c) => decisions[c.id]?.v === v).length;
  const decided = res.changes.filter((c) => decisions[c.id]?.v).length;
  const reviewers = [...new Set(res.changes.map((c) => decisions[c.id]?.by).filter(Boolean))];
  const conclusion = res.changes.length
    ? t('在以上范围和条件下发现 {n} 处差异。', { n: res.changes.length })
    : t('在以上范围和条件下未发现差异。');
  const riskRows = risks.map((r, i) => {
    const c = byId.get(r.cid)!;
    return `<tr><td class="num">${i + 1}</td><td><span class="tag">${esc(riskTag(r))}</span></td><td>${esc(where(c))}</td><td>${esc(changeBody(c))}</td><td>${esc(riskText(r))}</td><td>${esc(verdictText(decisions[c.id]))}</td></tr>`;
  }).join('');
  let k = 0;
  const groups = groupChanges(res.changes, clauses).map((g) => `
    <tr class="grp"><td colspan="5">${esc(g.title)}</td></tr>
    ${g.items.map((c) => {
      const d = decisions[c.id];
      return `<tr><td class="num">${++k}</td><td><span class="kind k-${c.kind}">${esc(t(KIND[c.kind]))}</span></td><td>${esc(changeBody(c))}</td><td>${d?.v ? esc(t(VERDICT[d.v])) : '—'}</td><td>${esc([d?.by, d?.at ? fmtDate(d.at) : '', d?.note].filter(Boolean).join(' · '))}</td></tr>`;
    }).join('')}`).join('');
  const fileRows = scope.files.map((f) => `<tr><th>${esc(f.side)}</th><td>${esc(f.name)}<div class="mono">SHA-256 ${esc(f.sha)}</div><div class="muted">${esc(f.size)} · ${esc(f.source)}${f.mtime ? ` · ${esc(t('修改于 {d}', { d: f.mtime }))}` : ''}</div></td></tr>`).join('');

  return `<!doctype html><html lang="${isEn() ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><title>${esc(t('DocDiff 比对报告'))}</title><style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif; color: #1d2a22; margin: 0; }
  h1 { font-size: 19pt; margin: 0; } h2 { font-size: 13pt; margin: 22px 0 8px; border-bottom: 1.5px solid #1d2a22; padding-bottom: 4px; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #1d2a22; padding-bottom: 8px; }
  .top small { color: #6b776f; font-size: 9pt; }
  .concl { margin: 12px 0 0; padding: 10px 12px; background: #f1f5ee; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  table.fixed { table-layout: fixed; } table.fixed td { word-break: break-word; }
  th, td { text-align: left; vertical-align: top; padding: 5px 7px; border-bottom: 1px solid #dfe5dc; }
  thead th { background: #f1f5ee; font-size: 8.5pt; color: #4c5a51; }
  table.kv th { width: 22%; color: #4c5a51; font-weight: 600; }
  .mono { font: 8.5pt ui-monospace, Menlo, Consolas, monospace; color: #4c5a51; word-break: break-all; }
  .muted { color: #6b776f; font-size: 8.5pt; }
  .num { width: 26px; color: #6b776f; }
  .tag, .kind { font-size: 8.5pt; font-weight: 700; padding: 0 5px; border-radius: 4px; background: #fff3cf; color: #7a5600; white-space: nowrap; }
  .k-del { background: #fdebe8; color: #b3261e; } .k-ins { background: #e1f5ee; color: #0b7558; } .k-mod { background: #eceeec; color: #4c5a51; } .k-fmt { background: #e7eefb; color: #2459a8; } .k-move { background: #f6e8f5; color: #8a2f86; }
  tr.grp td { background: #fafbf8; font-weight: 700; padding-top: 9px; }
  .rl { font-family: "Times New Roman", "Songti SC", SimSun, serif; font-size: 10.5pt; }
  .rl p, .rl h2, .rl h3, .rl h4 { margin: 0 0 6px; border: 0; } .rl h2 { font-size: 13pt; } .rl h3 { font-size: 11.5pt; }
  .rl .sec { margin: 14px 0 6px; font: 700 8.5pt sans-serif; color: #6b776f; letter-spacing: .05em; border-top: 1px dashed #c9cfcc; padding-top: 6px; }
  .rl del { color: #b3261e; text-decoration: line-through; } .rl ins { color: #0b7558; text-decoration: underline; }
  .rl .mv { color: #8a2f86; text-decoration-style: double; } .rl .fmt { text-decoration: underline dashed #2459a8; }
  .rl .mk { display: inline-block; min-width: 18px; color: #6b776f; }
  .rl table.rt { margin: 0 0 -1px; } .rl table.rt td { border: 1px solid #c9cfcc; }
  .foot { margin-top: 18px; color: #6b776f; font-size: 8.5pt; }
  .pb { page-break-before: always; }
  </style></head><body>
  <div class="top"><h1>${esc(t('DocDiff 比对报告'))}</h1><small>${esc(t('本地生成 · 未上传'))} · ${esc(fmtDate(Date.now()))}</small></div>
  <p class="concl"><b>${esc(conclusion)}</b>${decided ? ' ' + esc(t('已审阅 {d}/{n}：接受 {a}、拒绝 {r}、待议 {h}。', { d: decided, n: res.changes.length, a: n('a'), r: n('r'), h: n('h') })) : ''}${reviewers.length ? ' ' + esc(t('审阅人：{r}', { r: reviewers.join(isEn() ? ', ' : '、') })) : ''}</p>
  ${risks.length ? `<h2>${esc(t('需要留意（{n}）', { n: risks.length }))}</h2>
  <table class="fixed"><colgroup><col style="width:5%"><col style="width:9%"><col style="width:16%"><col style="width:30%"><col style="width:22%"><col style="width:18%"></colgroup><thead><tr><th>#</th><th>${esc(t('类别'))}</th><th>${esc(t('位置'))}</th><th>${esc(t('原文 → 修改后'))}</th><th>${esc(t('变化'))}</th><th>${esc(t('结论'))}</th></tr></thead><tbody>${riskRows}</tbody></table>` : ''}
  <h2>${esc(t('比对凭证'))}</h2>
  <table class="kv"><tbody>${fileRows}
    <tr><th>${esc(t('比较范围'))}</th><td>${esc(scope.compared.join(isEn() ? ', ' : '、'))}</td></tr>
    ${scope.notCompared.length ? `<tr><th>${esc(t('未比较'))}</th><td>${esc(scope.notCompared.join(sep()))}</td></tr>` : ''}
    <tr><th>${esc(t('比较条件'))}</th><td>${esc(scope.conditions.join(sep()))}</td></tr>
    <tr><th>${esc(t('对齐方式'))}</th><td>${esc(scope.alignment)}</td></tr>
  </tbody></table>
  ${res.changes.length ? `<h2>${esc(t('变更明细'))}</h2>
  <table class="fixed"><colgroup><col style="width:5%"><col style="width:9%"><col style="width:46%"><col style="width:9%"><col style="width:31%"></colgroup><thead><tr><th>#</th><th>${esc(t('类型'))}</th><th>${esc(t('原文 → 修改后'))}</th><th>${esc(t('结论'))}</th><th>${esc(t('审阅人 · 时间 · 备注'))}</th></tr></thead><tbody>${groups}</tbody></table>` : ''}
  ${res.changes.length ? `<h2 class="pb">${esc(t('附：修订全文'))}</h2><p class="muted">${esc(t('删除线 = 删除，下划线 = 新增，双线 = 移动，虚线 = 格式变化。'))}</p><div class="rl">${redlineHtml(res, blocksA, blocksB)}</div>` : ''}
  <p class="foot">${esc(t('由 DocDiff 在本机生成，文档没有上传。'))} ${esc(A.file.name)} → ${esc(B.file.name)}</p>
  </body></html>`;
}
