/**
 * Alur impor di halaman settings (PRD 4.5 + fitur P1 "Import subset Yomitan").
 *
 * Dua format diterima, dideteksi dari isi berkas:
 * - **Shirabe JSONL v1/v2** — satu header + satu entry per baris (v2 mendukung
 *   definisi berstruktur: tabel, daftar berpenanda).
 * - **Yomitan ZIP (format 3)** — `index.json` + `term_bank_*.json` (adapter subset,
 *   lihat `src/core/yomitan.ts`). Kanji/meta/media/tag bank diabaikan dan dilaporkan.
 *
 * Prinsip cepat dan aman:
 * - parsing/dekompresi berjalan streaming di halaman, entry dikirim per batch besar
 *   ke service worker dengan pipelining (beberapa batch dalam penerbangan sekaligus),
 *   sehingga pekerjaan CPU di halaman dan penulisan IndexedDB di worker saling tumpang
 *   tindih — pendekatan berbeda dari importer Yomitan yang menunggu setiap transaksi
 *   1000 entry secara berurutan;
 * - staging tetap dipakai: `IMPORT_ABORT` membuang seluruh data versi baru, dan commit
 *   hanya terjadi setelah semua batch selesai, jadi impor yang gagal tidak pernah
 *   menggantikan kamus aktif (berbeda dari importer Yomitan yang meninggalkan baris
 *   parsial).
 */

import { IMPORT_LIMITS } from '../core/limits.js';
import { codePointLength } from '../core/text.js';
import { parseEntry, parseHeader, splitLines, type DictionaryHeader, type ParsedEntry } from '../core/jsonl.js';
import { structuredText } from '../core/structured.js';
import {
  convertKanjiBank,
  convertTermBankChunks,
  convertTermMetaBank,
  newTermBankConversion,
  dictionaryHeaderFromIndex,
  parseYomitanIndex,
  type SkippedEntries,
} from '../core/yomitan.js';
import {
  ZipFormatError,
  findZipEntry,
  matchZipEntries,
  readZipEntries,
  readZipEntryBytes,
  readZipEntryText,
} from '../core/zip.js';
import { writeKanjiBatch } from '../data/kanji.js';
import { writeMediaBatch } from '../data/media.js';
import { appendMetaItems, flushMetaPacks, discardBufferedMeta } from '../data/meta.js';
import { appendImportBatch } from '../data/imports.js';
import { t } from '../ui/strings.js';
import type { DictionarySummary, ImportPhase } from '../data/schema.js';
import type { MessageType, RequestPayload, ResponseData } from '../messaging/protocol.js';

/**
 * Pengirim pesan ke service worker.
 *
 * Diinjeksi oleh pemanggil supaya modul ini dapat berjalan di dua tempat: halaman
 * pengaturan (memakai `request` dari `ui/page.js`) dan Web Worker impor (meneruskan
 * permintaan lewat halaman). Dengan begitu jalur impor yang sama dipakai di keduanya —
 * worker hanya menambah paralelisme CPU, bukan logika baru.
 */
export type ImportRequest = <K extends MessageType>(
  type: K,
  payload: RequestPayload<K>,
) => Promise<ResponseData<K>>;

let sendRequest: ImportRequest | null = null;

export function setImportRequestHandler(handler: ImportRequest): void {
  sendRequest = handler;
}

function request<K extends MessageType>(
  type: K,
  payload: RequestPayload<K>,
): Promise<ResponseData<K>> {
  if (sendRequest === null) {
    throw new Error('Handler request impor belum dipasang (setImportRequestHandler).');
  }
  return sendRequest(type, payload);
}

/** Jumlah batch yang boleh berada dalam penerbangan sekaligus (pipelining). */
const MAX_IN_FLIGHT_BATCHES = 6;

export type ImportFormat = 'jsonl' | 'zip';

export interface ImportProgress {
  fileName: string;
  phase: ImportPhase;
  linesRead: number;
  entriesWritten: number;
  /** Entry yang sudah dikirim ke service worker (termasuk yang masih ditulis). */
  entriesQueued: number;
  /** Byte berkas yang sudah dibaca atau diproses. */
  bytesRead: number;
  /** Total byte yang akan diproses (ukuran berkas, atau ukuran bank arsip). */
  bytesTotal: number;
}

/**
 * Persentase bilah progres impor.
 *
 * Pekerjaan impor selesai hanya bila byte sudah terbaca **dan** entry sudah tersimpan,
 * jadi bilah memakai bagian terkecil dari keduanya: pembacaan yang cepat tidak membuat
 * bilah hampir penuh sementara penulisan masih mengejar. Nilai 100 hanya diberikan pada
 * commit supaya bilah tidak pernah selesai sebelum datanya benar-benar tersimpan.
 */
export function importProgressPercent(update: ImportProgress): number {
  if (update.phase === 'committing' || update.phase === 'failed') {
    return 100;
  }
  if (update.bytesTotal <= 0) {
    return 0;
  }
  let fraction = update.bytesRead / update.bytesTotal;
  if (update.entriesQueued > 0) {
    fraction = Math.min(fraction, update.entriesWritten / update.entriesQueued);
  }
  return Math.min(99, Math.floor(fraction * 100));
}

/**
 * Nilai bilah berikutnya, tidak pernah lebih rendah dari nilai sebelumnya.
 *
 * Pekerjaan yang diketahui bertambah saat batch baru dikirim ke service worker, sehingga
 * perbandingan "selesai dibagi diketahui" dapat turun; bilah progres yang bergerak mundur
 * lebih membingungkan daripada bilah yang berhenti sejenak.
 */
export function nextProgressPercent(previous: number, update: ImportProgress): number {
  return Math.max(previous, importProgressPercent(update));
}

export interface ImportCallbacks {
  onProgress(update: ImportProgress): void;
  /** Tanya pengguna bila ID dataset sudah terpasang; kembali true untuk mengganti. */
  confirmReplace(existing: DictionarySummary, fileName: string): Promise<boolean>;
  isCancelled(): boolean;
}

export interface FileImportResult {
  fileName: string;
  status: 'ok' | 'failed' | 'skipped';
  format: ImportFormat;
  dictionaryName?: string;
  entries?: number;
  reason?: string;
  /** Waktu membaca + memvalidasi/mengonversi (ms). */
  parseMs?: number;
  /** Waktu menunggu penulisan storage/service worker (ms). */
  writeMs?: number;
  /** Komponen arsip ZIP yang diabaikan (bank kanji/meta/tag, dsb.). */
  ignoredComponents?: string[];
  /** Entry yang dilewati karena tidak valid (khusus adapter Yomitan). */
  skippedEntries?: SkippedEntries;
  truncatedDefinitions?: number;
  /** Bagian structured content yang tidak didukung dan dilaporkan (khusus Yomitan). */
  unsupportedParts?: string[];
  /** Jumlah kanji, nilai meta (pitch/frekuensi), dan berkas media yang tersimpan. */
  kanji?: number;
  meta?: number;
  media?: number;
  mediaBytes?: number;
  /** Berkas media yang dilewati (terlalu besar atau melebihi kuota kamus). */
  mediaSkipped?: number;
}

/** Deteksi format dari nama berkas dan empat byte pertama. */
export async function detectImportFormat(file: File): Promise<ImportFormat> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) {
    return 'zip';
  }
  return file.name.toLowerCase().endsWith('.zip') ? 'zip' : 'jsonl';
}

function approxEntryBytes(entry: ParsedEntry): number {
  let bytes = 64;
  for (const text of [entry.expression, entry.reading, ...entry.definitions.map(structuredText), ...entry.partOfSpeech, ...entry.tags, ...entry.rules]) {
    bytes += text.length * 3 + 8;
  }
  return bytes;
}

/** Sesi impor satu berkas: staging, batch berpipeline, commit/abort. */
class ImportSession {
  #importId: string | null = null;
  #version: string | null = null;
  #queue: ParsedEntry[] = [];
  #queueBytes = 0;
  #nextSeq = 0;
  #entriesWritten = 0;
  #linesRead = 0;
  #bytesRead = 0;
  #bytesTotal: number;
  #writeWaitMs = 0;
  #inflight: Promise<void>[] = [];
  #failure: unknown = null;

  constructor(
    private readonly callbacks: ImportCallbacks,
    private readonly file: { name: string; size: number },
  ) {
    this.#bytesTotal = file.size;
  }

  get entriesWritten(): number {
    return this.#entriesWritten;
  }

  get importId(): string | null {
    return this.#importId;
  }

  /** Total waktu yang dihabiskan menunggu batch entry ditulis (untuk laporan durasi). */
  get writeWaitMs(): number {
    return this.#writeWaitMs;
  }

  /**
   * Versi dataset staging.
   *
   * Data turunan kamus (kanji/meta/media) ditulis langsung oleh halaman ini — origin
   * extension sama dengan service worker, jadi tidak perlu melewati pesan — dan harus
   * memakai versi yang sama dengan entry supaya abort/commit membersihkannya sekaligus.
   */
  get version(): string | null {
    return this.#version;
  }

  /** Mulai impor; false berarti pengguna menolak penggantian kamus. */
  async begin(header: DictionaryHeader): Promise<boolean> {
    const started = await request('IMPORT_BEGIN', {
      fileName: this.file.name,
      fileSize: this.file.size,
      header,
      replace: false,
    });
    if (started.status === 'needs-confirm') {
      const existing = started.existing;
      if (existing === null) {
        throw new Error('Kamus existing tidak ditemukan.');
      }
      const confirmed = await this.callbacks.confirmReplace(existing, this.file.name);
      if (!confirmed) {
        return false;
      }
      const retry = await request('IMPORT_BEGIN', {
        fileName: this.file.name,
        fileSize: this.file.size,
        header,
        replace: true,
      });
      if (retry.importId === null) {
        throw new Error('Impor pengganti tidak dapat dimulai.');
      }
      this.#importId = retry.importId;
      this.#version = retry.version;
      return true;
    }
    if (started.importId === null) {
      throw new Error('Impor tidak dapat dimulai.');
    }
    this.#importId = started.importId;
    this.#version = started.version;
    return true;
  }

  /** Tambahkan satu entry ke batch berjalan; batch dikirim saat anggaran byte tercapai. */
  async push(entry: ParsedEntry): Promise<void> {
    await this.pushMany([entry]);
  }

  /**
   * Tambahkan banyak entry sekaligus.
   *
   * Loop-nya sinkron (satu `await` per potongan, bukan per entry), sehingga impor kamus
   * besar tidak dihabiskan untuk rantai promise.
   */
  async pushMany(entries: readonly ParsedEntry[]): Promise<void> {
    for (const entry of entries) {
      this.#queue.push(entry);
      this.#queueBytes += approxEntryBytes(entry);
      if (
        this.#queueBytes >= IMPORT_LIMITS.importBatchTargetBytes ||
        this.#queue.length >= IMPORT_LIMITS.writeBatchSize
      ) {
        await this.flush();
      }
    }
  }

  /** Tandai progres baris yang sudah dibaca (dipakai untuk laporan progres). */
  noteLines(lines: number): void {
    this.#linesRead = Math.max(this.#linesRead, lines);
  }

  /** Tambahkan byte yang baru dibaca dari berkas (progres impor JSONL). */
  addBytes(bytes: number): void {
    this.#bytesRead += bytes;
  }

  /**
   * Tetapkan byte yang sudah diproses beserta totalnya (progres impor ZIP).
   *
   * Total ZIP bukan ukuran berkas arsip (terkompresi), melainkan jumlah ukuran bank
   * yang benar-benar dibaca, sehingga persentasenya bermakna.
   */
  setBytes(read: number, total: number): void {
    this.#bytesRead = read;
    this.#bytesTotal = total;
  }

  /** Laporkan satu langkah progres (nama berkas, fase, baris, entry, dan byte). */
  report(phase: ImportPhase): void {
    this.callbacks.onProgress({
      fileName: this.file.name,
      phase,
      linesRead: this.#linesRead,
      entriesWritten: this.#entriesWritten,
      entriesQueued: this.#nextSeq,
      bytesRead: this.#bytesRead,
      bytesTotal: this.#bytesTotal,
    });
  }

  async flush(): Promise<void> {
    if (this.#queue.length === 0 || this.#importId === null) {
      return;
    }
    const entries = this.#queue;
    const startSeq = this.#nextSeq;
    const linesRead = this.#linesRead;
    this.#queue = [];
    this.#queueBytes = 0;
    this.#nextSeq += entries.length;
    const importId = this.#importId;

    const task = (async () => {
      try {
        // Ditulis langsung lewat lapisan data (IndexedDB), bukan lewat service worker:
        // worker impor berjalan di origin yang sama, dan mengirim batch entry (jutaan
        // baris) lewat pesan berarti menyalin data dua kali dan membuat halaman menjadi
        // titik serial. `appendImportBatch` juga memperbarui heartbeat job agar sweep
        // tidak menganggap impor ini ditinggalkan.
        const response = await appendImportBatch(importId, entries, startSeq, linesRead);
        this.#entriesWritten = Math.max(this.#entriesWritten, response.entriesWritten);
      } catch (error) {
        this.#failure ??= error;
      }
    })();
    this.#inflight.push(task);

    if (this.#inflight.length >= MAX_IN_FLIGHT_BATCHES) {
      await this.#drain();
    }
    this.#throwIfFailed();
  }

  /**
   * Tunggu batch yang masih berjalan sambil melaporkan progres.
   *
   * Batch diselesaikan satu per satu: tanpa ini, tahap terakhir impor (menunggu batch
   * terakhir ditulis) menampilkan angka yang berhenti walau penulisan masih berjalan.
   */
  async #drain(): Promise<void> {
    const pending = this.#inflight;
    this.#inflight = [];
    const started = performance.now();
    for (const task of pending) {
      await task;
      this.report('writing');
    }
    this.#writeWaitMs += performance.now() - started;
  }

  /** Tunggu semua batch selesai lalu commit staging menjadi kamus aktif. */
  async commit(aux?: {
    kanjiCount: number;
    metaCount: number;
    mediaCount: number;
    mediaBytes: number;
  }): Promise<void> {
    await this.flush();
    await this.#drain();
    this.#throwIfFailed();
    if (this.#importId === null) {
      throw new Error('Impor tidak dapat dimulai.');
    }
    // Kamus kanji/pitch tidak punya term bank: hitungan data turunan juga menentukan
    // apakah impor ini benar-benar memuat sesuatu.
    const total =
      this.#entriesWritten +
      (aux?.kanjiCount ?? 0) +
      (aux?.metaCount ?? 0) +
      (aux?.mediaCount ?? 0);
    if (total === 0) {
      throw new Error(t('settings.importEmptyFile'));
    }
    this.report('committing');
    const commitStarted = performance.now();
    await request('IMPORT_COMMIT', {
      importId: this.#importId,
      ...(aux === undefined ? {} : { aux }),
    });
    this.#writeWaitMs += performance.now() - commitStarted;
    this.#importId = null;
  }

  /** Buang staging; kamus lama tidak tersentuh. */
  async abort(): Promise<void> {
    await Promise.all(this.#inflight);
    this.#inflight = [];
    const importId = this.#importId;
    this.#importId = null;
    this.#queue = [];
    if (importId === null) {
      return;
    }
    try {
      await request('IMPORT_ABORT', { importId });
    } catch {
      // Staging juga dibersihkan oleh sweep startup service worker.
    }
  }

  #throwIfFailed(): void {
    if (this.#failure !== null) {
      throw this.#failure;
    }
  }
}

class ImportLineError extends Error {
  readonly line: number;
  readonly reason: string;

  constructor(line: number, reason: string) {
    super(reason);
    this.name = 'ImportLineError';
    this.line = line;
    this.reason = reason;
  }
}

/**
 * Iterator baris berkas: byte mentah dihitung sebelum dekode supaya progres mengikuti
 * ukuran berkas (bukan panjang string hasil dekode).
 */
async function* iterateLines(
  file: File,
  onBytes: (bytes: number) => void,
): AsyncGenerator<string> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done === true) {
        break;
      }
      onBytes(chunk.value.byteLength);
      buffer += decoder.decode(chunk.value, { stream: true });
      const { lines, rest } = splitLines(buffer);
      buffer = rest;
      for (const line of lines) {
        yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      yield buffer;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Beri kesempatan browser menggambar frame di antara potongan parsing. */
function yieldToBrowser(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

const ZIP_BANK_PATTERN = /^term_bank_\d+\.json$/;
/** Bank kanji (`kanji_bank_*.json`) dan bank meta istilah (pitch accent/frekuensi). */
const ZIP_KANJI_BANK_PATTERN = /^kanji_bank_\d+\.json$/;
const ZIP_META_BANK_PATTERN = /^term_meta_bank_\d+\.json$/;
/** Berkas media yang disimpan hanya bila direferensikan definisi. */
const ZIP_MEDIA_PATTERN = /\.(?:png|jpe?g|gif|webp|svg|avif)$/iu;
/**
 * Komponen arsip yang tetap diabaikan dan dilaporkan namanya.
 *
 * Media tidak lagi masuk daftar ini: berkas yang direferensikan definisi disimpan, dan
 * yang dilewati (terlalu besar atau melebihi kuota) dilaporkan sebagai hitungan.
 */
const ZIP_IGNORED_PATTERN =
  /^(?:kanji_meta_bank_|tag_bank_|.*\.(?:mp3|ogg|opus|m4a|wav|css|txt))$/iu;
/** Jumlah berkas media per transaksi penulisan. */
const MEDIA_WRITE_BATCH = 24;
/**
 * Jumlah record kanji/meta per transaksi penulisan.
 *
 * Lebih kecil dari {@link IMPORT_LIMITS.writeBatchSize} (30.000): biaya per record
 * didominasi IndexedDB, bukan per transaksi, jadi potongan 10.000 menghasilkan langkah
 * progres ~1,5 s per transaksi pada kamus frekuensi 478.000 baris **tanpa** menambah
 * durasi total (diukur: 75,5 s vs 76,4 s untuk potongan 30.000).
 */
const AUX_WRITE_BATCH = 10_000;

/** Benar bila berkas arsip ini diimpor (bukan komponen yang diabaikan). */
function isImportedBank(name: string): boolean {
  return ZIP_BANK_PATTERN.test(name) || ZIP_KANJI_BANK_PATTERN.test(name) || ZIP_META_BANK_PATTERN.test(name);
}

function bankOrder(name: string): number {
  return Number(name.match(/\d+/u)?.[0] ?? 0);
}

/** Impor Shirabe JSONL: streaming per baris, validasi ketat (gagal = seluruh berkas batal). */
async function importJsonlFile(
  file: File,
  session: ImportSession,
  callbacks: ImportCallbacks,
  startedAt: number,
): Promise<FileImportResult> {
  let header: DictionaryHeader | null = null;
  let dictionaryName = '';
  let linesRead = 0;
  let linesSinceYield = 0;

  session.report('reading');
  for await (const line of iterateLines(file, (bytes) => session.addBytes(bytes))) {
    linesRead += 1;
    if (line.trim().length === 0) {
      continue;
    }
    if (codePointLength(line) > IMPORT_LIMITS.maxLineCodePoints) {
      throw new ImportLineError(
        linesRead,
        `baris melebihi ${IMPORT_LIMITS.maxLineCodePoints} code point`,
      );
    }
    if (header === null) {
      const parsedHeader = parseHeader(line);
      if (!parsedHeader.ok) {
        throw new ImportLineError(linesRead, parsedHeader.reason);
      }
      header = parsedHeader.value;
      dictionaryName = header.name;
      const proceed = await session.begin(header);
      if (!proceed) {
        return { fileName: file.name, status: 'skipped', format: 'jsonl', dictionaryName };
      }
      session.report('validating');
      continue;
    }
    const parsed = parseEntry(line, { schemaVersion: header.schemaVersion });
    if (!parsed.ok) {
      throw new ImportLineError(linesRead, parsed.reason);
    }
    session.noteLines(linesRead);
    await session.push(parsed.value);

    linesSinceYield += 1;
    if (linesSinceYield >= IMPORT_LIMITS.parseChunkSize) {
      linesSinceYield = 0;
      session.report('writing');
      await yieldToBrowser();
      if (callbacks.isCancelled()) {
        throw new Error(t('settings.importAborted'));
      }
    }
  }

  if (header === null) {
    throw new Error(t('settings.importNoHeader'));
  }
  await session.commit();
  const totalMs = performance.now() - startedAt;
  const writeMs = session.writeWaitMs;
  return {
    fileName: file.name,
    status: 'ok',
    format: 'jsonl',
    dictionaryName,
    entries: session.entriesWritten,
    parseMs: Math.max(0, totalMs - writeMs),
    writeMs,
  };
}

/**
 * Impor Yomitan ZIP: term bank, bank kanji, bank meta (pitch/frekuensi), dan media
 * yang direferensikan definisi. Komponen lain dilaporkan diabaikan.
 */
async function importYomitanZipFile(
  file: File,
  session: ImportSession,
  callbacks: ImportCallbacks,
  startedAt: number,
): Promise<FileImportResult> {
  const zipEntries = await readZipEntries(file);
  const indexEntry = findZipEntry(zipEntries, 'index.json');
  if (indexEntry === undefined) {
    throw new ZipFormatError('Arsip tidak memuat index.json; ini bukan kamus Yomitan format 3.');
  }
  const metadata = parseYomitanIndex(await readZipEntryText(file, indexEntry));
  if (!metadata.ok) {
    throw new ZipFormatError(metadata.reason);
  }

  const byBankOrder = (a: { name: string }, b: { name: string }): number =>
    bankOrder(a.name) - bankOrder(b.name);
  const banks = matchZipEntries(zipEntries, ZIP_BANK_PATTERN).sort(byBankOrder);
  const kanjiBanks = matchZipEntries(zipEntries, ZIP_KANJI_BANK_PATTERN).sort(byBankOrder);
  const metaBanks = matchZipEntries(zipEntries, ZIP_META_BANK_PATTERN).sort(byBankOrder);
  // Kamus kanji dan kamus pitch/frekuensi tidak punya term bank sama sekali: dulu
  // arsip seperti itu ditolak, padahal justru itu isi kamusnya.
  if (banks.length === 0 && kanjiBanks.length === 0 && metaBanks.length === 0) {
    throw new ZipFormatError(
      'Arsip tidak memuat term_bank, kanji_bank, maupun term_meta_bank; tidak ada data untuk diimpor.',
    );
  }
  const ignoredComponents = zipEntries
    .filter((entry) => entry.name !== 'index.json' && !isImportedBank(entry.name))
    .filter((entry) => ZIP_IGNORED_PATTERN.test(entry.name) || !entry.name.includes('/'))
    .map((entry) => entry.name);

  const header = dictionaryHeaderFromIndex(metadata.value);
  const proceed = await session.begin(header);
  if (!proceed) {
    return {
      fileName: file.name,
      status: 'skipped',
      format: 'zip',
      dictionaryName: header.name,
    };
  }
  const version = session.version;
  if (version === null) {
    throw new Error('Sesi impor tidak memuat versi dataset.');
  }

  // Progres ZIP diukur dari ukuran bank yang dibaca (ukuran berkas arsip terkompresi
  // tidak sebanding dengan pekerjaan yang tersisa). Media yang direferensikan definisi
  // baru diketahui setelah bank term dikonversi, jadi totalnya ditambahkan saat itu.
  const bankBytes = [...banks, ...kanjiBanks, ...metaBanks].reduce(
    (total, entry) => total + entry.uncompressedSize,
    0,
  );
  let totalBytes = bankBytes;
  let bytesConsumed = 0;
  let auxWriteMs = 0;
  session.setBytes(0, totalBytes);
  session.report('reading');

  /**
   * Progres di dalam satu bank.
   *
   * Kamus frekuensi/pitch sering hanya punya **satu** bank berukuran puluhan MB (JPDB:
   * 48 MB, 515.000 baris) yang penulisannya memakan sebagian besar waktu impor. Progres
   * yang hanya dilaporkan setelah bank selesai membuat bilah tampak berhenti di 0%
   * selama satu menit, jadi byte bank dihitung bertahap mengikuti potongan yang selesai.
   */
  const reportBank = (base: number, size: number, fraction: number, phase: ImportPhase): void => {
    session.setBytes(base + Math.round(size * fraction), totalBytes);
    session.report(phase);
  };

  /** Ukur waktu penulisan data turunan agar laporan durasi tidak menghitungnya sebagai validasi. */
  const timed = async <T>(task: Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await task;
    } finally {
      auxWriteMs += performance.now() - started;
    }
  };

  const skipped: SkippedEntries = { count: 0, example: null, reason: null };
  const unsupported = new Map<string, number>();
  // Jalur media yang benar-benar direferensikan definisi; hanya berkas ini yang disimpan.
  const referencedMedia = new Set<string>();
  let truncatedDefinitions = 0;
  let flattenedDefinitions = 0;
  let kanjiWritten = 0;
  let metaWritten = 0;
  let mediaStored = 0;
  let mediaBytes = 0;
  let mediaSkipped = 0;
  let rowsRead = 0;

  for (const bank of banks) {
    const base = bytesConsumed;
    session.report('reading');
    const text = await readZipEntryText(file, bank);
    bytesConsumed += bank.uncompressedSize;
    session.report('validating');
    let rows: unknown;
    try {
      // Satu kali parse per bank (importer Yomitan mem-parse tiap bank dua kali:
      // validasi schema lalu konversi).
      rows = JSON.parse(text);
    } catch (error) {
      throw new ZipFormatError(`${bank.name} bukan JSON valid: ${(error as Error).message}`);
    }
    // Baris dihitung sejak parse selesai (bukan setelah konversi/penulisan) supaya teks
    // progres tidak menampilkan "0 baris" selama konversi — bagian termahal impor.
    rowsRead += Array.isArray(rows) ? rows.length : 0;
    session.noteLines(rowsRead);

    // Konversi per potongan: bank besar tidak dikonversi dalam satu blok sinkron, dan
    // entry yang sudah selesai langsung dikirim ke penulisan (tumpang tindih).
    const conversion = newTermBankConversion();
    let converted = 0;
    const rowTotal = Array.isArray(rows) ? rows.length : 0;
    const collect = (): void => {
      skipped.count += conversion.skipped.count;
      skipped.example ??= conversion.skipped.example;
      skipped.reason ??= conversion.skipped.reason;
    };
    for (const chunk of convertTermBankChunks(rows, conversion)) {
      converted += chunk.length;
      await session.pushMany(chunk);
      reportBank(base, bank.uncompressedSize, rowTotal === 0 ? 1 : Math.min(converted, rowTotal) / rowTotal, 'writing');
      await yieldToBrowser();
      if (callbacks.isCancelled()) {
        throw new Error(t('settings.importAborted'));
      }
    }
    collect();
    truncatedDefinitions += conversion.truncatedDefinitions;
    flattenedDefinitions += conversion.flattenedDefinitions;
    for (const [label, count] of conversion.unsupported) {
      unsupported.set(label, (unsupported.get(label) ?? 0) + count);
    }
    for (const path of conversion.media) {
      referencedMedia.add(path);
    }
    if (rowTotal === 0) {
      reportBank(base, bank.uncompressedSize, 1, 'writing');
    }
  }

  // Bank kanji: data kanji, bukan istilah, jadi ditulis langsung ke store sendiri.
  for (const bank of kanjiBanks) {
    const base = bytesConsumed;
    session.report('reading');
    const rows = parseBankJson(await readZipEntryText(file, bank), bank.name);
    bytesConsumed += bank.uncompressedSize;
    session.report('validating');
    const conversion = convertKanjiBank(rows);
    for (const [label, count] of conversion.unsupported) {
      unsupported.set(label, (unsupported.get(label) ?? 0) + count);
    }
    if (conversion.skipped > 0) {
      skipped.count += conversion.skipped;
      skipped.reason ??= t('settings.importSkippedKanji');
    }
    rowsRead += Array.isArray(rows) ? rows.length : 0;
    session.noteLines(rowsRead);
    // Ditulis per potongan: kamus kanji bisa memuat puluhan ribu baris dan satu transaksi
    // raksasa menahan seluruh record sekaligus di memori halaman.
    const total = conversion.entries.length;
    for (let start = 0; start < total; start += AUX_WRITE_BATCH) {
      const batch = conversion.entries.slice(start, start + AUX_WRITE_BATCH);
      kanjiWritten += (await timed(writeKanjiBatch(version, header.id, batch))).written;
      reportBank(base, bank.uncompressedSize, Math.min(start + batch.length, total) / total, 'writing');
      await yieldToBrowser();
      if (callbacks.isCancelled()) {
        throw new Error(t('settings.importAborted'));
      }
    }
    if (total === 0) {
      reportBank(base, bank.uncompressedSize, 1, 'writing');
    }
  }

  // Bank meta istilah: pitch accent dan frekuensi (dipakai kartu entri saat lookup).
  for (const bank of metaBanks) {
    const base = bytesConsumed;
    session.report('reading');
    const rows = parseBankJson(await readZipEntryText(file, bank), bank.name);
    bytesConsumed += bank.uncompressedSize;
    session.report('validating');
    const conversion = convertTermMetaBank(rows);
    for (const [label, count] of conversion.unsupported) {
      unsupported.set(label, (unsupported.get(label) ?? 0) + count);
    }
    if (conversion.skipped > 0) {
      skipped.count += conversion.skipped;
      skipped.reason ??= t('settings.importSkippedMeta');
    }
    rowsRead += Array.isArray(rows) ? rows.length : 0;
    session.noteLines(rowsRead);
    // Kamus frekuensi bisa memuat ratusan ribu baris; potongan menjaga ukuran transaksi
    // dan memori tetap terbatas (pola yang sama dengan penulisan entry). Penulisan
    // disimpan berurutan: IndexedDB menyerialkan transaksi pada satu koneksi, jadi
    // beberapa batch sekaligus hanya menumpuk antrean tanpa menambah throughput.
    const total = conversion.entries.length;
    for (let start = 0; start < total; start += AUX_WRITE_BATCH) {
      const batch = conversion.entries.slice(start, start + AUX_WRITE_BATCH);
      // Item meta dibuffer dan ditulis sebagai record pack (lihat src/data/meta.ts); flush
      // terakhir dilakukan sebelum commit.
      const written = await timed(appendMetaItems(version, header.id, batch));
      metaWritten += written.items;
      reportBank(base, bank.uncompressedSize, Math.min(start + batch.length, total) / total, 'writing');
      await yieldToBrowser();
      if (callbacks.isCancelled()) {
        throw new Error(t('settings.importAborted'));
      }
    }
    if (total === 0) {
      reportBank(base, bank.uncompressedSize, 1, 'writing');
    }
  }

  // Media: hanya berkas yang direferensikan definisi. Berkas yang terlalu besar atau
  // melebihi kuota kamus dilewati dan dihitung, sehingga impor tidak pernah batal
  // hanya karena lampiran gambar.
  const mediaTargets = zipEntries.filter(
    (entry) => referencedMedia.has(entry.name) && ZIP_MEDIA_PATTERN.test(entry.name),
  );
  // Total progres baru lengkap sekarang: berkas media yang tidak direferensikan definisi
  // tidak pernah dibaca.
  const mediaTotalBytes = mediaTargets.reduce(
    (total, entry) => total + entry.uncompressedSize,
    0,
  );
  totalBytes = bankBytes + mediaTotalBytes;
  const mediaBase = bytesConsumed;
  session.setBytes(mediaBase, totalBytes);
  let mediaBatch: { path: string; bytes: Uint8Array }[] = [];
  for (const entry of mediaTargets) {
    // Berkas yang dilewati tetap dihitung sebagai selesai supaya bilah tidak berhenti.
    bytesConsumed += entry.uncompressedSize;
    if (
      entry.uncompressedSize > IMPORT_LIMITS.maxMediaFileBytes ||
      mediaBytes + entry.uncompressedSize > IMPORT_LIMITS.maxMediaBytesPerDictionary
    ) {
      mediaSkipped += 1;
      continue;
    }
    mediaBatch.push({ path: entry.name, bytes: await readZipEntryBytes(file, entry) });
    if (mediaBatch.length >= MEDIA_WRITE_BATCH) {
      const written = await timed(writeMediaBatch(version, header.id, mediaBatch));
      mediaStored += written.stored;
      mediaBytes += written.bytes;
      mediaSkipped += written.skipped;
      mediaBatch = [];
      session.setBytes(bytesConsumed, totalBytes);
      session.report('writing');
      await yieldToBrowser();
      if (callbacks.isCancelled()) {
        throw new Error(t('settings.importAborted'));
      }
    }
  }
  if (mediaBatch.length > 0) {
    const written = await timed(writeMediaBatch(version, header.id, mediaBatch));
    mediaStored += written.stored;
    mediaBytes += written.bytes;
    mediaSkipped += written.skipped;
  }

  // Durasi ditulis sebelum commit: penulisan bank kanji/meta/media berjalan di halaman ini
  // (bukan lewat antrean entry), sehingga tanpa pemisahan ini semuanya terhitung sebagai
  // "baca+validasi" dan laporannya menyesatkan untuk kamus frekuensi/pitch.
  const pendingMeta = await timed(flushMetaPacks());
  metaWritten += pendingMeta.items;
  await session.commit({
    kanjiCount: kanjiWritten,
    metaCount: metaWritten,
    mediaCount: mediaStored,
    mediaBytes,
  });
  const totalMs = performance.now() - startedAt;
  const writeMs = session.writeWaitMs + auxWriteMs;
  return {
    fileName: file.name,
    status: 'ok',
    format: 'zip',
    dictionaryName: header.name,
    entries: session.entriesWritten,
    parseMs: Math.max(0, totalMs - writeMs),
    writeMs,
    ignoredComponents,
    skippedEntries: skipped.count > 0 ? skipped : undefined,
    truncatedDefinitions: truncatedDefinitions > 0 ? truncatedDefinitions : undefined,
    unsupportedParts: unsupportedReport(unsupported, flattenedDefinitions),
    kanji: kanjiWritten > 0 ? kanjiWritten : undefined,
    meta: metaWritten > 0 ? metaWritten : undefined,
    media: mediaStored > 0 ? mediaStored : undefined,
    mediaBytes: mediaStored > 0 ? mediaBytes : undefined,
    mediaSkipped: mediaSkipped > 0 ? mediaSkipped : undefined,
  };
}

/** Parse satu bank JSON; galat parse menyebut nama bank agar pengguna tahu berkas mana. */
function parseBankJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ZipFormatError(`${name} bukan JSON valid: ${(error as Error).message}`);
  }
}

/** Ringkasan bagian structured content yang tidak didukung (label + jumlah). */
function unsupportedReport(unsupported: Map<string, number>, flattened: number): string[] | undefined {
  const parts = [...unsupported]
    .sort(([left], [right]) => left.localeCompare(right, 'id'))
    .map(([label, count]) => `${label} (${formatCount(count)})`);
  if (flattened > 0) {
    parts.push(`${t('settings.importFlattenedContent')} (${formatCount(flattened)})`);
  }
  return parts.length > 0 ? parts : undefined;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value);
}

async function importOneFile(file: File, callbacks: ImportCallbacks): Promise<FileImportResult> {
  const startedAt = performance.now();
  const format = await detectImportFormat(file);
  const session = new ImportSession(callbacks, { name: file.name, size: file.size });
  try {
    if (file.size > IMPORT_LIMITS.maxFileBytes) {
      throw new Error(
        t('settings.importTooLarge', { limit: `${IMPORT_LIMITS.maxFileBytes / (1024 * 1024)} MB` }),
      );
    }
    return format === 'zip'
      ? await importYomitanZipFile(file, session, callbacks, startedAt)
      : await importJsonlFile(file, session, callbacks, startedAt);
  } catch (error) {
    await session.abort();
    // Item meta yang belum ditulis dibuang bersama staging; versi ini tidak akan commit.
    discardBufferedMeta();
    if (error instanceof ImportLineError) {
      return {
        fileName: file.name,
        status: 'failed',
        format,
        reason: t('settings.importInvalidLine', { line: error.line, reason: error.reason }),
      };
    }
    return {
      fileName: file.name,
      status: 'failed',
      format,
      reason: error instanceof Error ? error.message : t('error.INTERNAL'),
    };
  }
}

/** Impor beberapa berkas secara berurutan; kamus lama tetap utuh bila satu berkas gagal. */
export async function importFiles(
  files: readonly File[],
  callbacks: ImportCallbacks,
): Promise<FileImportResult[]> {
  const results: FileImportResult[] = [];
  for (const file of files) {
    if (callbacks.isCancelled()) {
      results.push({ fileName: file.name, status: 'skipped', format: 'jsonl' });
      continue;
    }
    results.push(await importOneFile(file, callbacks));
  }
  return results;
}
