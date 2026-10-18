import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const r = (p: string): string => path.resolve(dir, p);

/**
 * Identitas build yang dibekukan saat build.
 *
 * Dipakai UI untuk menampilkan versi kode yang benar-benar berjalan di halaman dan di
 * service worker. Tanpa ini, build lama yang masih dipakai browser (mis. service worker
 * belum dimuat ulang) hanya terlihat dari pesan error yang menyesatkan.
 */
const buildId = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/**
 * Build untuk halaman extension, service worker, action popup, settings, dan search.
 * Semua entry di sini berupa ES module (manifest service worker type: "module",
 * halaman HTML dengan <script type="module">), sehingga code splitting aman.
 */
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  // Worker impor memakai `new Worker(..., { type: 'module' })` agar dapat mengimpor modul
  // data/inti yang sama dengan halaman.
  worker: { format: 'es' },
  root: r('src'),
  publicDir: r('public'),
  build: {
    outDir: r('dist'),
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        background: r('src/background/index.ts'),
        action: r('src/action.html'),
        settings: r('src/settings.html'),
        search: r('src/search.html'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
