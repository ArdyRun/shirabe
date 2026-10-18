import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const r = (p: string): string => path.resolve(dir, p);

/**
 * Build terpisah untuk content script.
 *
 * Content script didaftarkan lewat `chrome.scripting.registerContentScripts`, yang
 * hanya mengeksekusi classic script (bukan ES module) dan tidak bisa mengimpor chunk
 * eksternal. Karena itu bundle ini harus self-contained: format IIFE tanpa code splitting.
 * CSS popup diimpor dengan `?inline` agar tidak menghasilkan file aset terpisah.
 */
export default defineConfig({
  root: r('src'),
  publicDir: false,
  build: {
    outDir: r('dist'),
    emptyOutDir: false,
    target: 'chrome120',
    sourcemap: true,
    lib: {
      entry: r('src/content/index.ts'),
      formats: ['iife'],
      name: 'ShirabeContent',
      fileName: () => 'content.js',
    },
  },
});
