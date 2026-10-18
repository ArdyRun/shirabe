/**
 * Store `entries`: penulisan batch saat impor dan pembacaan untuk search core.
 *
 * Pembacaan lookup hanya menyentuh index persisten (bukan memuat seluruh kamus),
 * sesuai PRD 6.4: "Hindari memuat seluruh kamus ke RAM".
 */

import type { DictionaryEntry, LookupSource } from '../core/types.js';
import { normalizeQuery } from '../core/text.js';
import type { ParsedEntry } from '../core/jsonl.js';
import { structuredText } from '../core/structured.js';
import { STORES, openDatabase, requestToPromise, withTransaction } from './db.js';
import { findKanjiMatches } from './kanji.js';
import { findMetaMatches } from './meta.js';
import {
  INDEX_BY_EXPRESSION,
  INDEX_BY_READING,
  type DictionaryRecord,
  type EntryRecord,
  entryKey,
  versionKeyRange,
} from './schema.js';

export function toDictionaryEntry(record: EntryRecord, dictionary: DictionaryRecord): DictionaryEntry {
  return {
    entryId: record.key,
    dictionaryId: dictionary.id,
    dictionaryName: dictionary.name,
    dictionaryOrder: dictionary.order,
    expression: record.expression,
    reading: record.reading,
    definitions: record.definitions,
    partOfSpeech: record.partOfSpeech,
    tags: record.tags,
    rules: record.rules,
    ...(record.priority === undefined ? {} : { priority: record.priority }),
  };
}

async function findByIndex(indexName: string, text: string): Promise<DictionaryEntry[]> {
  const database = await openDatabase();
  const transaction = database.transaction([STORES.entries, STORES.dictionaries], 'readonly');
  const dictionaryRequest = transaction.objectStore(STORES.dictionaries).getAll();
  const entryRequest = transaction.objectStore(STORES.entries).index(indexName).getAll(text);
  const [dictionaryRecords, entryRecords] = await Promise.all([
    requestToPromise<DictionaryRecord[]>(dictionaryRequest),
    requestToPromise<EntryRecord[]>(entryRequest),
  ]);
  const byId = new Map(dictionaryRecords.map((record) => [record.id, record]));
  const result: DictionaryEntry[] = [];
  for (const record of entryRecords) {
    const dictionary = byId.get(record.dictionaryId);
    // Hanya entry dari kamus aktif dan versi dataset yang sedang aktif.
    if (dictionary === undefined || dictionary.status !== 'active') {
      continue;
    }
    if (dictionary.activeVersion !== record.version) {
      continue;
    }
    result.push(toDictionaryEntry(record, dictionary));
  }
  return result;
}

/** Sumber data untuk search core. */
export function createLookupSource(): LookupSource {
  return {
    findExactExpression: (text) => findByIndex(INDEX_BY_EXPRESSION, normalizeQuery(text)),
    findExactReading: (text) => findByIndex(INDEX_BY_READING, normalizeQuery(text)),
    findMeta: (expressionNfc, readingNfc) =>
      findMetaMatches(normalizeQuery(expressionNfc), normalizeQuery(readingNfc)),
    findKanji: (character) => findKanjiMatches(character),
  };
}

function toRecord(
  version: string,
  dictionaryId: string,
  seq: number,
  entry: ParsedEntry,
): EntryRecord {
  return {
    key: entryKey(version, seq),
    version,
    dictionaryId,
    seq,
    expression: entry.expression,
    expressionNfc: normalizeQuery(entry.expression),
    reading: entry.reading,
    readingNfc: normalizeQuery(entry.reading),
    definitions: entry.definitions,
    partOfSpeech: entry.partOfSpeech,
    tags: entry.tags,
    rules: entry.rules,
    ...(entry.priority === undefined ? {} : { priority: entry.priority }),
  };
}

/**
 * Perkiraan ukuran satu entry dalam byte (untuk ringkasan storage).
 * Loop per array tanpa menggabungkan array agar tidak ada alokasi per entry saat impor.
 */
export function estimateEntryBytes(entry: ParsedEntry): number {
  let bytes = 32 + entry.expression.length * 3 + entry.reading.length * 3;
  for (const text of entry.definitions.map(structuredText)) {
    bytes += text.length * 3 + 8;
  }
  for (const collection of [entry.partOfSpeech, entry.tags, entry.rules]) {
    for (const text of collection) {
      bytes += text.length * 3 + 8;
    }
  }
  return bytes;
}

/**
 * Tulis satu batch entry milik sebuah versi dataset ke dalam transaksi yang
 * sudah dibuka pemanggil. Ditulis dalam transaksi yang sama dengan pembaruan job
 * impor, sehingga hitungan entry dan data entry tidak pernah terpisah.
 */
export function writeEntryBatch(
  transaction: IDBTransaction,
  version: string,
  dictionaryId: string,
  startSeq: number,
  entries: readonly ParsedEntry[],
): { written: number; bytes: number } {
  const store = transaction.objectStore(STORES.entries);
  let seq = startSeq;
  let bytes = 0;
  for (const entry of entries) {
    store.put(toRecord(version, dictionaryId, seq, entry));
    bytes += estimateEntryBytes(entry);
    seq += 1;
  }
  return { written: entries.length, bytes };
}

/**
 * Hapus seluruh data milik sebuah versi dataset dari `entries`, `meta`, `kanji`,
 * dan `media`.
 *
 * Semua kunci store turunan berawalan `${version}:`, jadi penghapusan cukup satu
 * range delete per store (bukan iterasi per record); versi dataset yang gagal atau
 * digantikan tidak meninggalkan sisa di salah satu store.
 */
export async function deleteVersionData(version: string): Promise<void> {
  const range = versionKeyRange(version);
  await withTransaction(
    [STORES.entries, STORES.metaPacks, STORES.kanji, STORES.media],
    'readwrite',
    async (transaction) => {
      transaction.objectStore(STORES.entries).delete(range);
      transaction.objectStore(STORES.metaPacks).delete(range);
      transaction.objectStore(STORES.kanji).delete(range);
      transaction.objectStore(STORES.media).delete(range);
    },
  );
}

/** Jumlah seluruh entry yang tersimpan. */
export async function countAllEntries(): Promise<number> {
  const database = await openDatabase();
  const transaction = database.transaction(STORES.entries, 'readonly');
  return requestToPromise(transaction.objectStore(STORES.entries).count());
}
