/**
 * Regresi untuk halaman yang "tertinggal" setelah extension dimuat ulang.
 *
 * Skenario: pengguna menekan Reload di `chrome://extensions` (hal yang lazim saat
 * pengembangan) tanpa memuat ulang halaman yang sedang dibuka. Content script di halaman
 * itu kehilangan kontaknya ke service worker. Sebelum perbaikan, setiap hover menampilkan
 * "Terjadi kesalahan internal." tanpa menjelaskan apa pun; sekarang popup harus
 * menjelaskan bahwa extension baru dimuat ulang dan pemindaian dihentikan.
 *
 * Hover pertama diverifikasi berhasil, lalu `chrome.runtime.reload()` dijalankan (setara
 * tombol Reload), lalu hover kedua diverifikasi menampilkan penjelasan tersebut — bukan
 * pesan kesalahan internal, dan bukan kegagalan berulang.
 *
 * Jalankan: npm run build && node scripts/verify-stale-context.mjs
 */

import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const fixture = path.join(projectRoot, 'tests', 'fixtures', 'demo-mini.jsonl');

const PAGE_HTML = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Halaman uji konteks</title></head>
<body style="font-family: sans-serif; font-size: 20px; padding: 24px">
  <p id="line">今日は学生です。</p>
</body></html>`;

const failures = [];
function check(name, ok, detail = '') {
  if (!ok) {
    failures.push(name);
  }
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
}

/**
 * Ambil teks popup dari CDP: isinya berada di closed shadow root.
 *
 * Hanya subtree host popup yang dibaca (`data-shirabe="popup"`), sehingga teks halaman
 * tidak ikut terbaca dan header kosakata ikut terperiksa.
 */
async function popupText(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const parts = [];
    const walk = (node) => {
      if (node.nodeName === 'STYLE') {
        return;
      }
      if (node.nodeName === '#text' && typeof node.nodeValue === 'string') {
        parts.push(node.nodeValue);
      }
      for (const child of node.children ?? []) {
        walk(child);
      }
      for (const shadow of node.shadowRoots ?? []) {
        walk(shadow);
      }
    };
    let host = null;
    const findHost = (node) => {
      const attributes = node.attributes ?? [];
      for (let index = 0; index < attributes.length; index += 2) {
        if (attributes[index] === 'data-shirabe' && attributes[index + 1] === 'popup') {
          host = node;
          return;
        }
      }
      for (const child of node.children ?? []) {
        findHost(child);
        if (host !== null) return;
      }
      for (const shadow of node.shadowRoots ?? []) {
        findHost(shadow);
        if (host !== null) return;
      }
    };
    findHost(root);
    if (host === null) {
      return '';
    }
    walk(host);
    return parts.join(' ').replaceAll(/\s+/g, ' ').trim();
  } finally {
    await session.detach();
  }
}

async function hoverWord(page) {
  const point = await page.evaluate(() => {
    const node = document.getElementById('line').firstChild;
    const range = document.createRange();
    range.setStart(node, 3);
    range.setEnd(node, 4);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 3, y: rect.top + rect.height / 2 };
  });
  await page.keyboard.down('Alt');
  await page.mouse.move(point.x, point.y);
  await page.mouse.move(point.x + 1, point.y);
  await page.waitForTimeout(700);
  const text = await popupText(page);
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');
  await page.waitForTimeout(200);
  return text;
}

async function main() {
  if (!existsSync(path.join(distDir, 'manifest.json'))) {
    process.stderr.write('dist belum ada. Jalankan `npm run build` lebih dahulu.\n');
    return 1;
  }

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE_HTML);
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'shirabe-stale-'));
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`, '--no-first-run'],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;

    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${id}/settings.html`);
    await settings.waitForSelector('#dictionary-list', { state: 'attached' });
    await settings.setInputFiles('#import-input', fixture);
    await settings.waitForSelector('.dictionary');

    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForSelector('[data-shirabe="popup"]', { state: 'attached', timeout: 15000 });

    const before = await hoverWord(page);
    // Headword dirender sebagai tombol per kanji, jadi teks CDP memisahkan `学` dan
    // `生` dengan spasi. Bandingkan tanpa spasi agar pemeriksaan tidak bergantung pada
    // bentuk DOM internal popup.
    const beforeCompact = before.replaceAll(/\s+/g, '');
    check(
      'Hover berfungsi sebelum extension dimuat ulang',
      beforeCompact.includes('学生') && beforeCompact.includes('pelajar;mahasiswa'),
      before.slice(0, 120),
    );

    await worker.evaluate(() => chrome.runtime.reload());
    await page.waitForTimeout(2500);

    const after = await hoverWord(page);
    check(
      'Popup menjelaskan halaman perlu dimuat ulang setelah extension di-reload',
      after.includes('Muat ulang halaman ini (F5)') && !after.includes('kesalahan internal'),
      after.slice(0, 160),
    );

    const repeat = await hoverWord(page);
    check(
      'Pemindaian berhenti: hover berikutnya tidak memunculkan kegagalan lain',
      repeat === after,
      repeat.slice(0, 160),
    );
  } finally {
    await context.close();
    server.close();
    await rm(profileDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} pemeriksaan gagal.\n`);
    return 1;
  }
  process.stdout.write('\nSeluruh pemeriksaan konteks basi lulus.\n');
  return 0;
}

process.exitCode = await main();
