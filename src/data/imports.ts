/**
 * Siklus impor kamus: staging, commit, rollback, dan sweep startup (PRD 4.5, 9.2).
 *
 * Model data:
 * - Setiap impor membuat job di store `imports` dengan `version` dataset sendiri.
 * - Selama impor, entry ditulis ke `entries` dengan version staging tersebut.
 * - Commit hanya memindahkan pointer `activeVersion` pada metadata kamus dan
 *   menghapus job; dataset lama baru dihapus setelah commit berhasil.
 * - Karena itu impor yang gagal tidak pernah menyentuh kamus yang sedang aktif.
 */

import { IMPORT_LIMITS } from '../core/limits.js';
import { parseHeader, type DictionaryHeader, type ParsedEntry } from '../core/jsonl.js';
import {
  STORES,
  StorageError,
  getAllRecords,
  getRecord,
  requestToPromise,
  withTransaction,
} from './db.js';
import { deleteVersionData, writeEntryBatch } from './entries.js';
import { nextOrder } from './dictionaries.js';
import {
  type DictionaryRecord,
  type DictionarySummary,
  type ImportJobRecord,
  type ImportPhase,
  newDatasetVersion,
  toDictionarySummary,
} from './schema.js';

/** Job impor dianggap ditinggalkan bila tidak ada aktivitas selama durasi ini. */
export const IMPORT_JOB_TIMEOUT_MS = 60_000;

export interface ImportProgressUpdate {
  phase: ImportPhase;
  linesRead: number;
  entriesWritten: number;
  failure?: { line?: number; reason: string };
}

export interface BeginImportParams {
  fileName: string;
  fileSize: number;
  header: DictionaryHeader;
  replace: boolean;
}

export interface BeginImportResult {
  status: 'started' | 'needs-confirm';
  importId: string | null;
  /** Versi dataset staging yang baru dibuat; `null` saat impor belum dimulai. */
  version: string | null;
  existing: DictionarySummary | null;
}

/** Hitungan data turunan yang ditulis importer di luar entry (kanji/meta/media). */
export interface ImportAuxCounts {
  kanjiCount?: number;
  metaCount?: number;
  mediaCount?: number;
  mediaBytes?: number;
}

/**
 * Mulai impor baru.
 *
 * Bila kamus dengan ID yang sama sudah terpasang dan `replace` belum dikonfirmasi,
 * impor tidak dimulai dan pemanggil menerima ringkasan kamus existing.
 */
export async function beginImport(params: BeginImportParams): Promise<BeginImportResult> {
  const headerCheck = parseHeader(JSON.stringify(params.header));
  if (!headerCheck.ok) {
    throw new StorageError('STORAGE_ERROR', `Header dataset tidak valid: ${headerCheck.reason}`);
  }
  if (params.fileSize > IMPORT_LIMITS.maxFileBytes) {
    throw new StorageError(
      'STORAGE_ERROR',
      `Ukuran file melebihi batas ${Math.round(IMPORT_LIMITS.maxFileBytes / (1024 * 1024))} MB.`,
    );
  }

  const existing = await getRecord<DictionaryRecord>(STORES.dictionaries, params.header.id);
  if (existing !== undefined && !params.replace) {
    return {
      status: 'needs-confirm',
      importId: null,
      version: null,
      existing: toDictionarySummary(existing),
    };
  }

  const now = Date.now();
  const job: ImportJobRecord = {
    id: newDatasetVersion(),
    version: newDatasetVersion(),
    dictionaryId: params.header.id,
    dictionaryName: params.header.name,
    fileName: params.fileName.slice(0, 200),
    fileSize: params.fileSize,
    header: {
      schemaVersion: params.header.schemaVersion,
      language: params.header.language,
      definitionLanguage: params.header.definitionLanguage,
      license: params.header.license,
      attribution: params.header.attribution,
    },
    phase: 'reading',
    linesRead: 0,
    entriesWritten: 0,
    approxSize: 0,
    startedAt: now,
    heartbeatAt: now,
    replace: params.replace,
  };

  await withTransaction([STORES.imports], 'readwrite', async (transaction) => {
    const store = transaction.objectStore(STORES.imports);
    const jobs = (await requestToPromise(store.getAll())) as ImportJobRecord[];
    const live = jobs.find(
      (candidate) =>
        candidate.dictionaryId === job.dictionaryId && now - candidate.heartbeatAt < IMPORT_JOB_TIMEOUT_MS,
    );
    if (live !== undefined) {
      throw new StorageError(
        'CONFLICT',
        'Masih ada impor berjalan untuk kamus ini. Tunggu sampai selesai atau batalkan.',
      );
    }
    store.put(job);
  });

  return { status: 'started', importId: job.id, version: job.version, existing: null };
}

/**
 * Tambahkan satu batch entry ke staging.
 *
 * `startSeq` dikirim pemanggil sehingga beberapa batch dapat ditulis paralel
 * (pipelining) tanpa kehilangan urutan; penghitung job memakai nilai maksimum agar
 * batch yang tiba tidak berurutan tetap aman. Entry dan penghitung job ditulis dalam
 * satu transaksi, jadi hitungan tidak pernah menyimpang dari data yang tersimpan.
 */
export async function appendImportBatch(
  importId: string,
  entries: readonly ParsedEntry[],
  startSeq: number,
  linesRead: number,
): Promise<{ written: number; entriesWritten: number }> {
  if (entries.length === 0) {
    return { written: 0, entriesWritten: 0 };
  }
  if (entries.length > IMPORT_LIMITS.writeBatchSize) {
    throw new StorageError('STORAGE_ERROR', 'Batch entry terlalu besar untuk diproses sekaligus.');
  }
  if (!Number.isInteger(startSeq) || startSeq < 0) {
    throw new StorageError('STORAGE_ERROR', 'Nomor urut batch tidak valid.');
  }

  return withTransaction([STORES.entries, STORES.imports], 'readwrite', async (transaction) => {
    const importStore = transaction.objectStore(STORES.imports);
    const job = (await requestToPromise(importStore.get(importId))) as ImportJobRecord | undefined;
    if (job === undefined) {
      throw new StorageError('NOT_FOUND', 'Job impor tidak ditemukan atau sudah dibatalkan.');
    }
    const end = startSeq + entries.length;
    if (end > IMPORT_LIMITS.maxEntries) {
      throw new StorageError(
        'STORAGE_ERROR',
        `Dataset melebihi batas ${IMPORT_LIMITS.maxEntries.toLocaleString('id-ID')} entry.`,
      );
    }
    const result = writeEntryBatch(
      transaction,
      job.version,
      job.dictionaryId,
      startSeq,
      entries,
    );
    const entriesWritten = Math.max(job.entriesWritten, end);
    importStore.put({
      ...job,
      phase: 'writing',
      linesRead: Math.max(job.linesRead, linesRead),
      entriesWritten,
      approxSize: job.approxSize + result.bytes,
      heartbeatAt: Date.now(),
    } satisfies ImportJobRecord);
    return { written: result.written, entriesWritten };
  });
}

/**
 * Commit staging menjadi kamus aktif.
 *
 * Langkah pertama (satu transaksi) menulis metadata kamus dengan `activeVersion`
 * baru dan menghapus job. Setelah itu versi lama dihapus dari storage; bila proses
 * terputus di antaranya, `versions` pada metadata masih mencatat versi lama dan
 * sweep startup menyelesaikan pembersihannya.
 */
export async function commitImport(
  importId: string,
  aux: ImportAuxCounts = {},
): Promise<DictionaryRecord> {
  const { record, staleVersions } = await withTransaction(
    [STORES.imports, STORES.dictionaries],
    'readwrite',
    async (transaction) => {
      const importStore = transaction.objectStore(STORES.imports);
      const job = (await requestToPromise(importStore.get(importId))) as ImportJobRecord | undefined;
      if (job === undefined) {
        throw new StorageError('NOT_FOUND', 'Job impor tidak ditemukan atau sudah dibatalkan.');
      }
      // Kamus kanji, pitch, atau frekuensi tidak punya term bank sama sekali: data
      // turunan (kanji/meta/media) juga menentukan apakah staging memuat sesuatu.
      const staged =
        job.entriesWritten +
        (aux.kanjiCount ?? 0) +
        (aux.metaCount ?? 0) +
        (aux.mediaCount ?? 0);
      if (staged === 0) {
        throw new StorageError('STORAGE_ERROR', 'Dataset tidak berisi entry, kanji, maupun meta.');
      }
      const dictionaryStore = transaction.objectStore(STORES.dictionaries);
      const records = (await requestToPromise(dictionaryStore.getAll())) as DictionaryRecord[];
      const existing = records.find((candidate) => candidate.id === job.dictionaryId);
      const now = Date.now();

      const committed: DictionaryRecord = {
        id: job.dictionaryId,
        name: job.dictionaryName,
        language: job.header.language,
        definitionLanguage: job.header.definitionLanguage,
        schemaVersion: job.header.schemaVersion,
        license: job.header.license,
        attribution: job.header.attribution,
        entryCount: job.entriesWritten,
        status: existing?.status ?? 'active',
        order: existing?.order ?? nextOrder(records),
        importedAt: now,
        activeVersion: job.version,
        versions: [...new Set([...(existing?.versions ?? []), job.version])],
        approxSize: job.approxSize,
        sourceFileName: job.fileName,
        kanjiCount: aux.kanjiCount ?? 0,
        metaCount: aux.metaCount ?? 0,
        mediaCount: aux.mediaCount ?? 0,
        mediaBytes: aux.mediaBytes ?? 0,
      };
      dictionaryStore.put(committed);
      importStore.delete(importId);
      return {
        record: committed,
        staleVersions: committed.versions.filter((version) => version !== committed.activeVersion),
      };
    },
  );

  await dropStaleVersions(record.id, staleVersions);
  const fresh = await getRecord<DictionaryRecord>(STORES.dictionaries, record.id);
  return fresh ?? record;
}

/** Hapus versi dataset lama sebuah kamus dan rapikan daftar `versions`. */
async function dropStaleVersions(dictionaryId: string, staleVersions: readonly string[]): Promise<void> {
  if (staleVersions.length === 0) {
    return;
  }
  for (const version of staleVersions) {
    await deleteVersionData(version);
  }
  await withTransaction([STORES.dictionaries], 'readwrite', async (transaction) => {
    const store = transaction.objectStore(STORES.dictionaries);
    const record = (await requestToPromise(store.get(dictionaryId))) as DictionaryRecord | undefined;
    if (record === undefined) {
      return;
    }
    store.put({ ...record, versions: [record.activeVersion] } satisfies DictionaryRecord);
  });
}

/** Batalkan impor: hapus job dan seluruh entry staging-nya. */
export async function abortImport(importId: string): Promise<boolean> {
  const job = await getRecord<ImportJobRecord>(STORES.imports, importId);
  if (job === undefined) {
    return false;
  }
  await deleteVersionData(job.version);
  await withTransaction([STORES.imports], 'readwrite', async (transaction) => {
    transaction.objectStore(STORES.imports).delete(importId);
  });
  return true;
}

/**
 * Sweep startup (PRD 9.2, risiko MV3):
 * - job impor yang ditinggalkan (heartbeat kedaluwarsa) dihapus beserta staging-nya;
 * - kamus dengan `pendingDelete` diselesaikan penghapusannya;
 * - versi dataset yang tidak lagi aktif dihapus dari storage.
 * Staging tidak pernah diperlakukan sebagai kamus aktif karena lookup hanya
 * membaca versi pada `activeVersion` sebuah metadata kamus.
 */
export async function sweepLeftovers(now = Date.now()): Promise<number> {
  let cleaned = 0;

  const jobs = await getAllRecords<ImportJobRecord>(STORES.imports);
  for (const job of jobs) {
    if (now - job.heartbeatAt <= IMPORT_JOB_TIMEOUT_MS) {
      continue;
    }
    try {
      await abortImport(job.id);
      cleaned += 1;
    } catch {
      // Pembersihan bersifat best-effort; sisa data tidak pernah dipakai untuk lookup.
    }
  }

  const records = await getAllRecords<DictionaryRecord>(STORES.dictionaries);
  for (const record of records) {
    if (record.pendingDelete === true) {
      try {
        for (const version of record.versions) {
          await deleteVersionData(version);
        }
        await deleteDictionaryRecord(record.id);
        cleaned += 1;
      } catch {
        // Dicoba lagi pada startup berikutnya.
      }
      continue;
    }
    const stale = record.versions.filter((version) => version !== record.activeVersion);
    if (stale.length === 0) {
      continue;
    }
    try {
      for (const version of stale) {
        await deleteVersionData(version);
      }
      await withTransaction([STORES.dictionaries], 'readwrite', async (transaction) => {
        const store = transaction.objectStore(STORES.dictionaries);
        const current = (await requestToPromise(store.get(record.id))) as DictionaryRecord | undefined;
        if (current !== undefined && current.activeVersion === record.activeVersion) {
          store.put({ ...current, versions: [current.activeVersion] } satisfies DictionaryRecord);
        }
      });
    } catch {
      // Dicoba lagi pada startup berikutnya.
    }
  }

  return cleaned;
}

/** Hapus metadata kamus (dipakai sweep untuk menyelesaikan `pendingDelete`). */
export async function deleteDictionaryRecord(id: string): Promise<void> {
  await withTransaction([STORES.dictionaries], 'readwrite', async (transaction) => {
    transaction.objectStore(STORES.dictionaries).delete(id);
  });
}
