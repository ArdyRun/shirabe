/**
 * Validasi hasil build MV3 (PRD 3.1, 10 Keamanan).
 *
 * Memeriksa bahwa manifest valid, semua berkas yang dirujuk benar-benar ada,
 * content script berupa classic script (bukan ES module), permission tidak
 * bertambah di luar rencana, dan tidak ada `eval` pada bundle.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');

/**
 * Model izin Shirabe: pemindaian bekerja di semua situs http/https lewat content script
 * statis (seperti Yomitan/Hachidori), jadi hanya `storage` dan `contextMenus` yang diminta,
 * tanpa `scripting`/`activeTab` dan tanpa izin host opsional.
 */
const EXPECTED_PERMISSIONS = ['contextMenus', 'storage'];
const EXPECTED_HOST_PERMISSIONS = ['http://*/*', 'https://*/*'];

const errors = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

function assertFile(relativePath) {
  const absolute = path.join(distDir, relativePath);
  if (!existsSync(absolute)) {
    fail(`Berkas yang dirujuk manifest tidak ada: ${relativePath}`);
    return null;
  }
  return absolute;
}

if (!existsSync(distDir)) {
  fail('Direktori dist belum ada. Jalankan `npm run build`.');
  process.exit(report());
}

const manifestPath = path.join(distDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('dist/manifest.json tidak ditemukan.');
  process.exit(report());
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3) {
  fail(`manifest_version harus 3, ditemukan ${manifest.manifest_version}.`);
}
if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
  fail('Manifest harus memiliki nama.');
}
if (!/^\d+(\.\d+){1,3}$/.test(String(manifest.version))) {
  fail(`Versi manifest tidak valid: ${manifest.version}.`);
}
if (manifest.default_locale !== undefined && !existsSync(path.join(distDir, '_locales'))) {
  fail('default_locale dipakai tanpa direktori _locales.');
}

const permissions = manifest.permissions ?? [];
if (JSON.stringify([...permissions].sort()) !== JSON.stringify([...EXPECTED_PERMISSIONS].sort())) {
  fail(`Permission tidak sesuai rencana least privilege: ${JSON.stringify(permissions)}.`);
}
const hostPermissions = manifest.host_permissions ?? [];
if (
  JSON.stringify([...hostPermissions].sort()) !==
  JSON.stringify([...EXPECTED_HOST_PERMISSIONS].sort())
) {
  fail(`host_permissions tidak sesuai: ${JSON.stringify(hostPermissions)}.`);
}
if (manifest.optional_host_permissions !== undefined) {
  fail('optional_host_permissions tidak dipakai lagi (pemindaian semua situs statis).');
}
const contentScripts = manifest.content_scripts ?? [];
if (contentScripts.length !== 1) {
  fail(`Harus ada tepat satu content script statis, ditemukan ${contentScripts.length}.`);
} else {
  const [script] = contentScripts;
  const matches = [...(script.matches ?? [])].sort();
  if (JSON.stringify(matches) !== JSON.stringify([...EXPECTED_HOST_PERMISSIONS].sort())) {
    fail(`matches content script tidak sesuai: ${JSON.stringify(matches)}.`);
  }
  if (script.all_frames !== true) {
    fail('Content script harus mendukung iframe web (all_frames harus true).');
  }
  for (const file of script.js ?? []) {
    assertFile(file);
  }
}
if (manifest.background?.type !== 'module') {
  fail('Service worker harus berjalan sebagai ES module.');
}
assertFile(manifest.background?.service_worker ?? '');
assertFile(manifest.action?.default_popup ?? '');
assertFile(manifest.options_page ?? '');
for (const size of Object.keys(manifest.icons ?? {})) {
  assertFile(manifest.icons[size]);
}

const contentPath = assertFile('content.js');
const backgroundPath = assertFile(manifest.background?.service_worker ?? '');

if (contentPath !== null) {
  const source = readFileSync(contentPath, 'utf8');
  if (/^\s*(import|export)\s/m.test(source)) {
    fail('content.js mengandung pernyataan ESM; content script harus classic script.');
  }
  if (source.includes('import(')) {
    fail('content.js memakai dynamic import; bundle content script harus self-contained.');
  }
}

for (const absolute of [contentPath, backgroundPath]) {
  if (absolute === null) {
    continue;
  }
  const source = readFileSync(absolute, 'utf8');
  if (/\beval\s*\(/.test(source)) {
    fail(`${path.relative(distDir, absolute)} memakai eval().`);
  }
}

// Shirabe tidak boleh melakukan permintaan jaringan untuk lookup (PRD 10 Privasi).
const NETWORK_APIS = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource'];
for (const absolute of walk(distDir)) {
  if (!absolute.endsWith('.js')) {
    continue;
  }
  const source = readFileSync(absolute, 'utf8');
  for (const api of NETWORK_APIS) {
    if (source.includes(api)) {
      fail(`${path.relative(distDir, absolute)} memakai API jaringan (${api}).`);
    }
  }
}

for (const entry of walk(distDir)) {
  if (entry.endsWith('.map')) {
    continue;
  }
  if (statSync(entry).size > 6 * 1024 * 1024) {
    fail(`Berkas build terlalu besar: ${path.relative(distDir, entry)}`);
  }
}

function* walk(directory) {
  for (const name of readdirSync(directory)) {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) {
      yield* walk(absolute);
    } else {
      yield absolute;
    }
  }
}

function report() {
  for (const note of notes) {
    process.stdout.write(`catatan: ${note}\n`);
  }
  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`GAGAL: ${error}\n`);
    }
    return 1;
  }
  process.stdout.write('Validasi build MV3: OK\n');
  return 0;
}

process.exit(report());
