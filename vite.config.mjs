import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync, cpSync } from 'fs';

const pkgVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version;

export default defineConfig({
  root: resolve(__dirname, 'renderer'),
  base: './',
  plugins: [react(), {
    // 字体瘦身（1.8.1）：Electron 的 Chromium 都支持 woff2，去掉 fontsource 里的 woff 回退，安装包少一半字体文件
    name: 'woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/@fontsource[\\/].*\.css$/.test(id)) return null;
      return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, ''), map: null };
    },
  }, {
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
    // 字体不内联成 data: URI（1.8.1）：按需加载的子集保持独立文件
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'renderer/index.html'),
        render: resolve(__dirname, 'renderer/render.html'),
      },
    },
  },
});
