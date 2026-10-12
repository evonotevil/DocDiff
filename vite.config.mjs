import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const pkgVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version;

export default defineConfig({
  root: resolve(__dirname, 'renderer'),
  base: './',
  plugins: [react()],
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
