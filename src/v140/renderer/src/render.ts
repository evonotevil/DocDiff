// 隐藏窗口：把 DOCX / TXT 排版成可打印页面，主进程随后 printToPDF
import { renderAsync } from 'docx-preview';
import { getText } from './lib/txt';

const api = (window as any).api;
const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

api.onRenderJob(async (job: { kind: string; data: Uint8Array; name: string }) => {
  try {
    const out = document.getElementById('out')!;
    const pageStyle = document.getElementById('page-style')!;
    if (job.kind === 'docx') {
      await renderAsync(new Blob([job.data]), out, document.getElementById('styles')!, {
        inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: true, renderHeaders: false, renderFooters: false,
        renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: true, ignoreWidth: false, ignoreHeight: false,
      });
      await new Promise((r) => setTimeout(r, 50));
      const sec = out.querySelector('section.docx') as HTMLElement | null;
      let size = '210mm 297mm', margin = '25.4mm';
      if (sec) {
        const st = sec.style;
        const w = st.width, h = st.minHeight || st.height;
        if (w && h) size = `${w} ${h}`;
        const pad = [st.paddingTop, st.paddingRight, st.paddingBottom, st.paddingLeft];
        if (pad.every(Boolean)) margin = pad.join(' ');
      }
      pageStyle.textContent = `
        @page { size: ${size}; margin: ${margin}; }
        html, body { background: #fff !important; }
        section.docx { padding: 0 !important; margin: 0 !important; width: auto !important; min-height: 0 !important; box-shadow: none !important; background: transparent !important; }
        section.docx + section.docx { break-before: page; }
        .docx-wrapper { padding: 0 !important; background: #fff !important; }
      `;
      // 等待图片加载
      await Promise.all(Array.from(out.querySelectorAll('img')).map((img) => (img as HTMLImageElement).complete ? 0 : new Promise((r) => { img.onload = img.onerror = r; })));
    } else {
      const text = getText(job.data as any);
      pageStyle.textContent = `@page { size: A4; margin: 20mm 18mm; } body { font: 10.5pt/1.5 "SF Mono", Menlo, "PingFang SC", monospace; color: #111; } pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; }`;
      out.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
    }
    await document.fonts.ready;
    api.renderDone({ ok: true });
  } catch (e: any) {
    api.renderDone({ error: String(e?.message || e) });
  }
});
