/**
 * Verifikasi dataset di Chromium asli: impor satu berkas JSONL ke extension hasil
 * build, ukur waktunya, lalu jalankan serangkaian lookup dengan asersi opsional.
 *
 * Berguna untuk memeriksa dataset besar (mis. hasil konversi `yomitan-to-shirabe.mjs`)
 * sebelum dipakai, dan memastikan validasi impor extension menerima seluruh baris.
 *
 * Jalankan:
 *   npm run build
 *   node scripts/verify-dataset.mjs datasets/jmdict/jmdict-2026-10-16.jsonl \
 *     --expect '食べました=食べる' --expect 'たべる=食べる'
 */

import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const artifactsDir = path.join(projectRoot, 'artifacts', 'dataset-verify');
const IMPORT_TIMEOUT_MS = 20 * 60 * 1000;

function parseArgs(argv) {
  const args = { file: null, expects: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--expect') {
      const pair = argv[++index] ?? '';
      const separator = pair.lastIndexOf('=');
      if (separator > 0) {
        args.expects.push([pair.slice(0, separator), pair.slice(separator + 1)]);
      }
    } else if (!value.startsWith('--')) {
      args.file = value;
    }
  }
  return args;
}

async function sendMessage(page, type, payload) {
  return page.evaluate(
    ([messageType, messagePayload]) =>
      chrome.runtime.sendMessage({
        v: 1,
        id: crypto.randomUUID(),
        type: messageType,
        payload: messagePayload,
      }),
    [type, payload],
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.file === null) {
    process.stderr.write('Penggunaan: node scripts/verify-dataset.mjs <file.jsonl> [--expect query=expression]\n');
    return 1;
  }
  const file = path.resolve(args.file);
  if (!existsSync(file)) {
    process.stderr.write(`Berkas tidak ditemukan: ${file}\n`);
    return 1;
  }
  if (!existsSync(path.join(distDir, 'manifest.json'))) {
    process.stderr.write('dist belum ada. Jalankan `npm run build` lebih dahulu.\n');
    return 1;
  }

  await rm(artifactsDir, { recursive: true, force: true });
  await mkdir(artifactsDir, { recursive: true });
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'shirabe-verify-'));
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`, '--no-first-run'],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    process.stderr.write(`pageerror: ${error.message}\n`);
  });
  await page.goto(`chrome-extension://${id}/settings.html`);
  await page.waitForSelector('#dictionary-list', { state: 'attached' });

  const importStart = Date.now();
  await page.setInputFiles('#import-input', file);
  await page.waitForSelector('.dictionary', { timeout: IMPORT_TIMEOUT_MS });
  const importMs = Date.now() - importStart;
  const successMessages = await page.locator('.import-message--ok').allInnerTexts();

  const dictionaryText = await page.locator('.dictionary').first().innerText();
  const storageText = await page.locator('#storage-summary').innerText();
  const errorMessages = await page.locator('.import-message--error').allInnerTexts();

  const queries = [
    '食べる', '学生', '日本語', '東京都', 'はし',
    '食べました', '書いて', '高くない', 'します', '来た', '行った', 'みて',
    'たべる', 'がくせい',
    'ゾゾゾゾゾ',
  ];
  const results = [];
  for (const query of queries) {
    // Latensi diukur dari halaman extension ke service worker dan kembali (batas atas).
    const samples = [];
    let response = null;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const start = await page.evaluate(() => performance.now());
      response = await sendMessage(page, 'LOOKUP', { query, source: 'manual' });
      const end = await page.evaluate(() => performance.now());
      samples.push(end - start);
    }
    samples.sort((a, b) => a - b);
    const timing = {
      median: Number((samples[2] ?? 0).toFixed(1)),
      worst: Number((samples.at(-1) ?? 0).toFixed(1)),
    };
    if (response === null || response.response.ok !== true) {
      results.push({
        query,
        status: `error:${response?.response?.error?.code ?? 'INTERNAL'}`,
        timing,
      });
      continue;
    }
    const data = response.response.data;
    results.push({
      query,
      status: data.status,
      count: data.matches.length,
      timing,
      first: data.matches[0]
        ? {
            expression: data.matches[0].entry.expression,
            reading: data.matches[0].entry.reading,
            dictionary: data.matches[0].entry.dictionaryName,
            matchType: data.matches[0].matchType,
            definition: definitionText(data.matches[0].entry.definitions[0]),
          }
        : null,
    });
  }

/** Teks datar dari satu definisi (string pada v1, pohon `{tag, content}` pada v2). */
function definitionText(item) {
  if (item === undefined || item === null) {
    return '';
  }
  if (typeof item === 'string') {
    return item;
  }
  const parts = [];
  const walk = (value) => {
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      if (value.tag === 'rt' || value.tag === 'rp') {
        return;
      }
      walk(value.content);
    }
  };
  walk(item);
  return parts.join('').replace(/\s+/gu, ' ').trim();
}

  // Asersi tambahan: hasil lookup harus memuat ekspresi yang diharapkan.
  const failures = [];
  for (const [query, expected] of args.expects) {
    const response = await sendMessage(page, 'LOOKUP', { query, source: 'manual' });
    const matches = response.response.ok === true ? response.response.data.matches : [];
    const found = matches.some((match) => match.entry.expression === expected);
    if (!found) {
      failures.push(
        `${query} → ${expected} tidak ditemukan (hasil: ${matches
          .slice(0, 3)
          .map((match) => match.entry.expression)
          .join(', ') || 'kosong'})`,
      );
    }
  }

  const report = {
    measuredAt: new Date().toISOString(),
    dataset: path.relative(projectRoot, file),
    fileSizeMb: Number(((await import('node:fs')).statSync(file).size / (1024 * 1024)).toFixed(1)),
    importMs,
    dictionaryText,
    storageText,
    importErrors: errorMessages,
    importSummary: successMessages,
    results,
    expectFailures: failures,
  };
  await writeFile(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(artifactsDir, 'settings.png'), fullPage: true });

  process.stdout.write(`Impor ${report.dataset} (${report.fileSizeMb} MB): ${importMs} ms\n`);
  process.stdout.write(`Kamus: ${dictionaryText.replaceAll('\n', ' | ')}\n`);
  process.stdout.write(`Storage: ${storageText}\n`);
  for (const message of successMessages) {
    process.stdout.write(`Ringkasan impor: ${message.replaceAll('\n', ' | ')}\n`);
  }
  if (errorMessages.length > 0) {
    process.stdout.write(`Error impor: ${errorMessages.join(' / ')}\n`);
  }
  for (const row of results) {
    const first = row.first
      ? `${row.first.expression}（${row.first.reading}）[${row.first.matchType}] ${row.first.definition}`
      : '—';
    const timing = row.timing ? `±${String(row.timing.median).padStart(5)} ms (max ${row.timing.worst})` : '';
    process.stdout.write(
      `${String(row.query).padEnd(12)} ${String(row.status).padEnd(6)} ${String(row.count ?? 0).padStart(3)}  ${timing.padEnd(28)} ${first}\n`,
    );
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`GAGAL: ${failure}\n`);
    }
  }
  process.stdout.write(`Laporan: ${path.relative(projectRoot, path.join(artifactsDir, 'report.json'))}\n`);

  await context.close();
  await rm(profileDir, { recursive: true, force: true });
  return failures.length === 0 && errorMessages.length === 0 ? 0 : 1;
}

process.exit(await main());
