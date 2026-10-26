import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync, cpSync } from 'fs';

const pkgVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version;

export default defineConfig({
  root: resolve(__dirname, 'renderer'),
  base: './',
  plugins: [react(), {
    // pdf.js 的字符映射表和标准字体数据：中文 PDF 常用的不嵌入 CID 字体离不开它们（1.7.4）
    name: 'copy-pdfjs-resources',
    closeBundle() {
      for (const d of ['cmaps', 'standard_fonts']) cpSync(resolve(__dirname, 'node_modules/pdfjs-dist', d), resolve(__dirname, 'dist/pdfjs', d), { recursive: true });
    },
  }],
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'renderer/index.html'),
        render: resolve(__dirname, 'renderer/render.html'),
      },
    },
  },
});
