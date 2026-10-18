/**
 * Store `kanji`: penulisan batch bank kanji Yomitan dan pembacaan untuk lookup kanji.
 *
 * Pembacaan hanya menyentuh index persisten `by_character`, lalu menyaring versi
 * dataset aktif lewat metadata kamus — staging tidak pernah tampak sebagai hasil.
 */

import { IMPORT_LIMITS } from '../core/limits.js';
import type { KanjiMatch, ParsedKanji } from '../core/types.js';
import { STORES, openDatabase, requestToPromise, withTransaction } from './db.js';
import { INDEX_BY_CHARACTER, type DictionaryRecord, type KanjiRecord, auxKey } from './schema.js';

function toRecord(
  version: string,
  dictionaryId: string,
  kanji: ParsedKanji,
): KanjiRecord {
  return {
    key: auxKey(version, kanji.character),
    version,
    dictionaryId,
    character: kanji.character,
    onyomi: kanji.onyomi,
    kunyomi: kanji.kunyomi,
    tags: kanji.tags,
    meanings: kanji.meanings,
    stats: kanji.stats,
  };
}

/** Tulis satu batch kanji milik sebuah versi dataset ke store `kanji`. */
export async function writeKanjiBatch(
  version: string,
  dictionaryId: string,
  kanji: readonly ParsedKanji[],
): Promise<{ written: number }> {
  return withTransaction([STORES.kanji], 'readwrite', async (transaction) => {
    const store = transaction.objectStore(STORES.kanji);
    for (const item of kanji) {
      store.put(toRecord(version, dictionaryId, item));
    }
    return { written: kanji.length };
  });
}

/**
 * Kanji untuk satu karakter dari semua kamus aktif.
 *
 * Urutan: `dictionaryOrder` lalu karakter (tie-break dalam satu kamus), dibatasi
 * `maxKanjiPerLookup` seperti batas lookup lainnya.
 */
export async function findKanjiMatches(character: string): Promise<KanjiMatch[]> {
  const database = await openDatabase();
  const transaction = database.transaction([STORES.kanji, STORES.dictionaries], 'readonly');
  const dictionaryRequest = transaction.objectStore(STORES.dictionaries).getAll();
  const kanjiRequest = transaction
    .objectStore(STORES.kanji)
    .index(INDEX_BY_CHARACTER)
    .getAll(character);
  const [dictionaryRecords, kanjiRecords] = await Promise.all([
    requestToPromise<DictionaryRecord[]>(dictionaryRequest),
    requestToPromise<KanjiRecord[]>(kanjiRequest),
  ]);
  const byId = new Map(dictionaryRecords.map((record) => [record.id, record]));
  const result: KanjiMatch[] = [];
  for (const record of kanjiRecords) {
    const dictionary = byId.get(record.dictionaryId);
    if (dictionary === undefined || dictionary.status !== 'active') {
      continue;
    }
    if (dictionary.activeVersion !== record.version) {
      continue;
    }
    result.push({
      dictionaryId: dictionary.id,
      dictionaryName: dictionary.name,
      dictionaryOrder: dictionary.order,
      character: record.character,
      onyomi: record.onyomi,
      kunyomi: record.kunyomi,
      tags: record.tags,
      meanings: record.meanings,
      stats: record.stats,
    });
  }
  result.sort(
    (a, b) => a.dictionaryOrder - b.dictionaryOrder || a.character.localeCompare(b.character),
  );
  return result.slice(0, IMPORT_LIMITS.maxKanjiPerLookup);
}
