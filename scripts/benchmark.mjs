/**
 * Benchmark NFR Shirabe (PRD 10, 12.3).
 *
 * Mengukur pada Chromium asli dengan dataset uji:
 * - waktu impor dataset 100.000 entry;
 * - latensi lookup p50/p95 untuk query exact, deinflection, no-hit, dan banyak hasil
 *   (diukur dari halaman pengaturan ke service worker dan kembali, yaitu batas atas
 *   dari waktu pemrosesan di dalam service worker);
 * - lookup pertama setelah worker dingin (restart browser) vs warm;
 * - waktu dari aktivasi hover hingga popup terlihat;
 * - pemakaian JS heap service worker sebelum/sesudah impor.
 *
 * Angka ini adalah pengukuran pada mesin yang dipakai, bukan jaminan performa.
 * Jalankan: npm run build && npm run bench:e2e
 */

import { chromium } from 'playwright';
import http from 'node:http';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const fixture = path.join(projectRoot, 'tests', 'fixtures', 'demo-mini.jsonl');
/** Jumlah entri fixture kecil (baris selain header). */
const fixtureEntryCount = (await readFile(fixture, 'utf8'))
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .length - 1;
const artifactsDir = path.join(projectRoot, 'artifacts', 'benchmark');
const LARGE_ENTRY_COUNT = 100_000;
const LOOKUP_ITERATIONS = 100;

const PAGE_HTML = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Benchmark Shirabe</title></head>
<body style="font-family: sans-serif; font-size: 20px; padding: 24px">
  <p>私は毎日<span id="word">学生</span>です。</p>
</body></html>`;

/** Dataset sintetis 100.000 entry (data uji, bukan kamus). */
async function generateLargeDataset(file) {
  const header = {
    type: 'shirabe-dictionary',
    schemaVersion: 2,
    id: 'shirabe-bench-large',
    name: 'Dataset Benchmark Sintetis',
    language: 'ja',
    definitionLanguage: 'id',
    license: 'CC0-1.0 — data sintetis untuk benchmark',
    attribution: 'Dibuat otomatis oleh scripts/benchmark.mjs',
  };
  const normals = ['食べる', '書く', '高い', 'する', '来る', '学生', '日本語', '東京都'];
  const kana = ['たべる', 'かく', 'たかい', 'する', 'くる', 'がくせい', 'にほんご', 'とうきょうと'];
  const pos = ['v1', 'v5k', 'adj-i', 'vs', 'vk', 'n', 'n', 'n'];
  const kanjiPool = '亜哀愛悪圧安暗案以位衣囲医依委威為畏胃尉異移萎域育一壱逸稲茨芋引印';
  const lines = [JSON.stringify(header)];
  for (let index = 0; index < LARGE_ENTRY_COUNT; index += 1) {
    const slot = index % normals.length;
    if (index < normals.length * 200) {
      // 1.600 entry awal memakai kata nyata agar lookup exact/deinflection terukur.
      lines.push(
        JSON.stringify({
          expression: normals[slot],
          reading: kana[slot],
          definitions: [`definisi contoh ${index}`],
          partOfSpeech: [pos[slot]],
          tags: [],
          rules: [pos[slot]],
        }),
      );
      continue;
    }
    const first = kanjiPool[index % kanjiPool.length];
    const second = kanjiPool[(index * 7) % kanjiPool.length];
    const third = kanjiPool[(index * 13) % kanjiPool.length];
    lines.push(
      JSON.stringify({
        expression: `${first}${second}${third}${index}`,
        reading: `よみ${index}`,
        definitions: [`definisi sintetis nomor ${index}`, `arti tambahan ${index}`],
        partOfSpeech: ['n'],
        tags: ['sintetis'],
        rules: [],
      }),
    );
  }
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function startServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE_HTML);
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function extensionId(context) {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return new URL(worker.url()).host;
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

async function measureLookups(page, query, options = {}) {
  const iterations = options.iterations ?? LOOKUP_ITERATIONS;
  const samples = [];
  let lastStatus = null;
  let lastCount = 0;
  for (let index = 0; index < iterations; index += 1) {
    const start = await page.evaluate(() => performance.now());
    const response = await sendMessage(page, 'LOOKUP', {
      query,
      source: 'manual',
      caretOffset: options.caretOffset ?? null,
    });
    const end = await page.evaluate(() => performance.now());
    samples.push(end - start);
    if (response.response.ok) {
      lastStatus = response.response.data.status;
      lastCount = response.response.data.matches.length;
    } else {
      lastStatus = `error:${response.response.error.code}`;
    }
  }
  samples.sort((a, b) => a - b);
  return {
    query,
    iterations,
    status: lastStatus,
    results: lastCount,
    p50: Number(percentile(samples, 50).toFixed(2)),
    p95: Number(percentile(samples, 95).toFixed(2)),
    max: Number(samples.at(-1)?.toFixed(2) ?? 0),
  };
}

async function main() {
  if (!existsSync(path.join(distDir, 'manifest.json'))) {
    throw new Error('dist belum ada. Jalankan `npm run build` lebih dahulu.');
  }
  await rm(artifactsDir, { recursive: true, force: true });
  await mkdir(artifactsDir, { recursive: true });

  const largeFile = await generateLargeDataset(path.join(os.tmpdir(), 'shirabe-bench-large.jsonl'));
  const { server, origin } = await startServer();

  const extensionDir = await mkdtemp(path.join(os.tmpdir(), 'shirabe-bench-ext-'));
  await cp(distDir, extensionDir, { recursive: true });
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [`${origin}/*`];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'shirabe-bench-profile-'));
  const launchOptions = {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run'],
  };

  let context = await chromium.launchPersistentContext(profileDir, launchOptions);
  const id = await extensionId(context);
  const browserVersion = context.browser()?.version() ?? 'unknown';
  let settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await settings.waitForSelector('#dictionary-list', { state: 'attached' });

  // Dataset MVP kecil terlebih dahulu, lalu dataset besar.
  await settings.setInputFiles('#import-input', fixture);
  await settings.waitForSelector('.dictionary', { timeout: 45000 });
  const smallLookupCold = await measureLookups(settings, '食べました', { iterations: 20 });

  // Pemakaian heap halaman settings selama impor (parsing streaming ada di halaman ini).
  // Catatan: heap service worker tidak dapat diukur lewat Playwright (CDP hanya untuk
  // Page/Frame), jadi angka worker perlu dibaca manual dari Chrome Task Manager.
  const pageSession = await context.newCDPSession(settings);
  await pageSession.send('Performance.enable');
  const readPageHeapMb = async () => {
    const metrics = await pageSession.send('Performance.getMetrics');
    const value = metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0;
    return Number((value / (1024 * 1024)).toFixed(2));
  };
  const heapBeforeImport = await readPageHeapMb();
  let peakPageHeap = heapBeforeImport;
  const sampler = setInterval(() => {
    void readPageHeapMb().then((value) => {
      peakPageHeap = Math.max(peakPageHeap, value);
    });
  }, 400);

  const importStart = Date.now();
  await settings.setInputFiles('#import-input', largeFile);
  await settings.waitForFunction(
    () => document.querySelectorAll('.dictionary').length === 2,
    null,
    { timeout: 300_000 },
  );
  const importMs = Date.now() - importStart;
  clearInterval(sampler);
  const heapAfterImport = await readPageHeapMb();
  // Beri kesempatan GC; angka pertama setelah impor masih memuat sampah batch terakhir.
  await settings.waitForTimeout(3000);
  const heapAfterSettle = await readPageHeapMb();
  await pageSession.detach();

  // Halaman settings baru sebagai baseline: halaman impor ditutup lebih dahulu agar
  // angka heap tidak tercampur dengan renderer yang sama.
  await settings.close();
  const freshPage = await context.newPage();
  await freshPage.goto(`chrome-extension://${id}/settings.html`);
  await freshPage.waitForSelector('.dictionary', { timeout: 30000 });
  const freshSession = await context.newCDPSession(freshPage);
  await freshSession.send('Performance.enable');
  const freshMetrics = await freshSession.send('Performance.getMetrics');
  const freshHeapMb = Number(
    ((freshMetrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0) /
      (1024 * 1024)).toFixed(2),
  );
  await freshSession.detach();
  settings = freshPage;

  const storageText = await settings.locator('#storage-summary').innerText();

  const benchmarks = [];
  benchmarks.push(await measureLookups(settings, '学生'));
  benchmarks.push(await measureLookups(settings, '食べました'));
  benchmarks.push(await measureLookups(settings, 'がくせい'));
  benchmarks.push(await measureLookups(settings, 'ゾゾゾゾゾ'));
  benchmarks.push(await measureLookups(settings, '서울'));

  // Hover: aktivasi modifier hingga popup terlihat.
  const hoverSamples = [];
  for (let index = 0; index < 20; index += 1) {
    await sendMessage(settings, 'SITE_SCAN_ENABLE', { origin });
    const page = index === 0 ? await context.newPage() : context.pages().at(-1);
    if (index === 0) {
      await page.goto(origin);
      await page.waitForSelector('[data-shirabe="popup"]', { state: 'attached' });
    } else {
      await page.reload();
      await page.waitForSelector('[data-shirabe="popup"]', { state: 'attached' });
    }
    await page.evaluate(() => {
      const host = document.querySelector('[data-shirabe="popup"]');
      window.__shirabeHoverStart = 0;
      window.__shirabeHoverVisible = 0;
      const observer = new MutationObserver(() => {
        if (host.hasAttribute('hidden') === false && window.__shirabeHoverVisible === 0) {
          window.__shirabeHoverVisible = performance.now();
        }
      });
      observer.observe(host, { attributes: true, attributeFilter: ['hidden'] });
    });
    const box = await page.locator('#word').boundingBox();
    await page.keyboard.down('Alt');
    await page.evaluate(() => {
      window.__shirabeHoverStart = performance.now();
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => window.__shirabeHoverVisible > 0, null, { timeout: 15000 });
    const elapsed = await page.evaluate(
      () => window.__shirabeHoverVisible - window.__shirabeHoverStart,
    );
    hoverSamples.push(elapsed);
    await page.keyboard.up('Alt');
    if (index === 0) {
      await page.screenshot({ path: path.join(artifactsDir, 'benchmark-hover.png') });
    }
  }
  hoverSamples.sort((a, b) => a - b);

  // Cold vs warm: restart browser lalu ukur lookup pertama.
  await context.close();
  context = await chromium.launchPersistentContext(profileDir, launchOptions);
  await extensionId(context);
  const coldPage = await context.newPage();
  await coldPage.goto(`chrome-extension://${id}/settings.html`);
  await coldPage.waitForSelector('.dictionary');
  const coldSamples = [];
  for (const query of ['食べました', '学生', 'がくせい', 'ゾゾゾ']) {
    const start = await coldPage.evaluate(() => performance.now());
    await sendMessage(coldPage, 'LOOKUP', { query, source: 'manual' });
    const end = await coldPage.evaluate(() => performance.now());
    coldSamples.push(Number((end - start).toFixed(2)));
  }
  const warmAfterCold = await measureLookups(coldPage, '食べました', { iterations: 20 });

  const report = {
    measuredAt: new Date().toISOString(),
    device: {
      platform: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cores: os.cpus().length,
      totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
      node: process.version,
    },
    browser: { channel: 'chromium', version: browserVersion },
    corpus: {
      // Dihitung dari berkas, bukan angka tetap, agar fixture boleh bertambah.
      smallDataset: { file: path.basename(fixture), entries: fixtureEntryCount },
      largeDataset: { file: path.basename(largeFile), entries: LARGE_ENTRY_COUNT },
      fileSizeMb: Number(
        ((await readFile(largeFile)).length / (1024 * 1024)).toFixed(2),
      ),
    },
    import: {
      entries: LARGE_ENTRY_COUNT,
      durationMs: importMs,
      entriesPerSecond: Math.round(LARGE_ENTRY_COUNT / (importMs / 1000)),
      storageSummary: storageText,
    },
    memory: {
      note: 'JS heap halaman pengaturan (proses parser impor). Heap service worker tidak dapat diukur via Playwright; baca dari Chrome Task Manager bila perlu.',
      pageHeapBeforeImportMb: heapBeforeImport,
      pageHeapPeakDuringImportMb: peakPageHeap,
      pageHeapAfterImportMb: heapAfterImport,
      pageHeapAfterSettleMb: heapAfterSettle,
      freshPageHeapMb: freshHeapMb,
    },
    lookup: {
      note: 'Diukur dari halaman extension ke service worker dan kembali (batas atas waktu pemrosesan worker).',
      firstLookupsSmallDatasetP50: smallLookupCold.p50,
      cases: benchmarks,
      afterRestart: { coldSamples, warm: warmAfterCold },
    },
    hoverToPopupMs: {
      iterations: hoverSamples.length,
      p50: Number(percentile(hoverSamples, 50).toFixed(2)),
      p95: Number(percentile(hoverSamples, 95).toFixed(2)),
      max: Number((hoverSamples.at(-1) ?? 0).toFixed(2)),
    },
  };

  await writeFile(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));

  const rows = benchmarks.map((row) => ({
    Query: row.query,
    Status: row.status,
    Hasil: row.results,
    'p50 (ms)': row.p50,
    'p95 (ms)': row.p95,
    'max (ms)': row.max,
  }));
  process.stdout.write(`\nImpor ${LARGE_ENTRY_COUNT} entry: ${importMs} ms (${report.import.entriesPerSecond} entry/detik)\n`);
  process.stdout.write(`Storage: ${storageText}\n`);
  process.stdout.write(
    `JS heap halaman settings: sebelum ${heapBeforeImport} MB, puncak saat impor ${peakPageHeap} MB, sesudah ${heapAfterImport} MB (setelah GC ${heapAfterSettle} MB)\n`,
  );
  process.stdout.write(
    `JS heap halaman settings baru (baseline sesudah impor): ${freshHeapMb} MB\n`,
  );
  process.stdout.write(`Hover -> popup: p50 ${report.hoverToPopupMs.p50} ms, p95 ${report.hoverToPopupMs.p95} ms\n`);
  process.stdout.write(`Lookup pertama setelah restart: ${coldSamples.join(', ')} ms\n`);
  process.stdout.write(`${JSON.stringify(rows, null, 1)}\n`);
  process.stdout.write(`Laporan: ${path.relative(projectRoot, path.join(artifactsDir, 'report.json'))}\n`);

  await context.close();
  server.close();
  await rm(profileDir, { recursive: true, force: true });
  await rm(extensionDir, { recursive: true, force: true });
  await rm(largeFile, { force: true });
}

await main();
