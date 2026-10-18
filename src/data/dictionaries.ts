/**
 * Pengelolaan kamus: daftar, aktivasi, urutan, penghapusan, dan ringkasan storage
 * (PRD 4.5, 4.6).
 */

import { STORES, getAllRecords, getRecord, requestToPromise, withTransaction } from './db.js';
import { deleteVersionData } from './entries.js';
import {
  type DictionaryRecord,
  type DictionarySummary,
  type StorageInfo,
  toDictionarySummary,
} from './schema.js';

export async function listDictionaryRecords(): Promise<DictionaryRecord[]> {
  const records = await getAllRecords<DictionaryRecord>(STORES.dictionaries);
  return records.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export async function listDictionarySummaries(): Promise<DictionarySummary[]> {
  const records = await listDictionaryRecords();
  return records.map(toDictionarySummary);
}

export async function getDictionaryRecord(id: string): Promise<DictionaryRecord | undefined> {
  return getRecord<DictionaryRecord>(STORES.dictionaries, id);
}

/** Urutan berikutnya (di bawah kamus yang sudah ada). */
export function nextOrder(records: readonly DictionaryRecord[]): number {
  return records.reduce((max, record) => Math.max(max, record.order + 1), 0);
}

export async function setDictionaryEnabled(
  id: string,
  enabled: boolean,
): Promise<DictionarySummary[]> {
  await withTransaction([STORES.dictionaries], 'readwrite', async (transaction) => {
    const store = transaction.objectStore(STORES.dictionaries);
    const record = (await requestToPromise(store.get(id))) as DictionaryRecord | undefined;
    if (record === undefined) {
      throw new Error(`Kamus ${id} tidak ditemukan.`);
    }
    store.put({ ...record, status: enabled ? 'active' : 'disabled' });
  });
  return listDictionarySummaries();
}

/** Terapkan urutan baru; ID yang tidak dikenal diabaikan. */
export async function reorderDictionaries(ids: readonly string[]): Promise<DictionarySummary[]> {
  await withTransaction([STORES.dictionaries], 'readwrite', async (transaction) => {
    const store = transaction.objectStore(STORES.dictionaries);
    const records = (await requestToPromise(store.getAll())) as DictionaryRecord[];
    const position = new Map(ids.map((id, index) => [id, index]));
    const ranked = records
      .map((record) => ({ record, rank: position.get(record.id) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.rank - b.rank || a.record.order - b.record.order);
    ranked.forEach((item, index) => {
      store.put({ ...item.record, order: index });
    });
  });
  return listDictionarySummaries();
}

/**
 * Hapus kamus beserta seluruh datanya (entry, meta, kanji, media).
 *
 * Metadata ditandai `pendingDelete` dan dinonaktifkan lebih dahulu, sehingga
 * kamus langsung tidak dipakai untuk lookup; bila proses terputus di tengah
 * penghapusan entry, sweep startup menyelesaikannya (PRD 9.2).
 */
export async function deleteDictionary(id: string): Promise<void> {
  const record = await getDictionaryRecord(id);
  if (record === undefined) {
    throw new Error(`Kamus ${id} tidak ditemukan.`);
  }
  await withTransaction([STORES.dictionaries], 'readwrite', async (transaction) => {
    transaction.objectStore(STORES.dictionaries).put({
      ...record,
      status: 'disabled',
      pendingDelete: true,
    } satisfies DictionaryRecord);
  });
  for (const version of record.versions) {
    await deleteVersionData(version);
  }
  await withTransaction([STORES.dictionaries], 'readwrite', async (transaction) => {
    transaction.objectStore(STORES.dictionaries).delete(id);
  });
}

/** Ringkasan pemakaian storage. */
export async function getStorageInfo(): Promise<StorageInfo> {
  const dictionaries = await listDictionaryRecords();
  // Jumlah entry dijumlahkan dari metadata kamus, bukan `count()` pada store `entries`:
  // hitungan store berjalan linear (≈420 ms untuk 93 ribu entry) dan itu menahan daftar
  // kamus muncul saat halaman pengaturan dibuka.
  const entryCount = dictionaries.reduce((total, record) => total + record.entryCount, 0);
  let usage = 0;
  let quota = 0;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage ?? 0;
      quota = estimate.quota ?? 0;
    }
  } catch {
    // Estimasi storage tidak wajib; UI menampilkan 0 bila tidak tersedia.
  }
  return {
    usage,
    quota,
    entryCount,
    dictionaryCount: dictionaries.length,
    available: true,
  };
}
