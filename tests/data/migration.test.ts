/**
 * Migrasi skema IndexedDB: v1 → v2 menghapus index `by_version`, v3 → v4 mengganti store
 * `meta` satu-record-per-baris dengan `meta_packs` (record pack).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, requestToPromise, withTransaction } from '../../src/data/db.js';
import { findMetaMatches } from '../../src/data/meta.js';
import {
  DB_NAME,
  INDEX_BY_EXPRESSION,
  INDEX_BY_READING,
  LEGACY_INDEX_BY_VERSION,
  STORE_DICTIONARIES,
  LEGACY_STORE_META,
  STORE_ENTRIES,
  STORE_IMPORTS,
  STORE_KANJI,
  STORE_MEDIA,
  STORE_META_PACKS,
  type DictionaryRecord,
} from '../../src/data/schema.js';
import { resetDatabase } from '../helpers/dataset.js';

/** Buat database dengan skema lama (v1, termasuk index `by_version`) berisi satu entry. */
async function createLegacyDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const dictionaries = database.createObjectStore(STORE_DICTIONARIES, { keyPath: 'id' });
      dictionaries.put({
        id: 'lama',
        name: 'Kamus Lama',
        language: 'ja',
        definitionLanguage: 'id',
        schemaVersion: 1,
        license: '',
        attribution: '',
        entryCount: 1,
        status: 'active',
        order: 0,
        importedAt: Date.now(),
        activeVersion: 'v1',
        versions: ['v1'],
        approxSize: 100,
        sourceFileName: 'lama.jsonl',
      });
      const entries = database.createObjectStore(STORE_ENTRIES, { keyPath: 'key' });
      entries.createIndex(INDEX_BY_EXPRESSION, 'expressionNfc', { unique: false });
      entries.createIndex(INDEX_BY_READING, 'readingNfc', { unique: false });
      entries.createIndex(LEGACY_INDEX_BY_VERSION, 'version', { unique: false });
      entries.put({
        key: 'v1:000000000',
        version: 'v1',
        dictionaryId: 'lama',
        seq: 0,
        expression: '学生',
        expressionNfc: '学生',
        reading: 'がくせい',
        readingNfc: 'がくせい',
        definitions: ['pelajar'],
        partOfSpeech: ['n'],
        tags: [],
        rules: [],
      });
      database.createObjectStore(STORE_IMPORTS, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

beforeEach(async () => {
  await resetDatabase();
});

describe('migrasi database', () => {
  it('menghapus index by_version tanpa menghilangkan data lama', async () => {
    await createLegacyDatabase();
    const database = await openDatabase();

    const entriesStore = database.transaction(STORE_ENTRIES, 'readonly').objectStore(STORE_ENTRIES);
    expect(entriesStore.indexNames.contains(LEGACY_INDEX_BY_VERSION)).toBe(false);
    expect(entriesStore.indexNames.contains(INDEX_BY_EXPRESSION)).toBe(true);
    expect(entriesStore.indexNames.contains(INDEX_BY_READING)).toBe(true);

    const count = await requestToPromise(entriesStore.count());
    expect(count).toBe(1);
    const dictionaries = await requestToPromise(
      database.transaction(STORE_DICTIONARIES, 'readonly').objectStore(STORE_DICTIONARIES).count(),
    );
    expect(dictionaries).toBe(1);
  });

  it('tetap dapat menulis entry baru setelah migrasi', async () => {
    await createLegacyDatabase();
    await openDatabase();
    await withTransaction([STORE_ENTRIES], 'readwrite', async (transaction) => {
      transaction.objectStore(STORE_ENTRIES).put({
        key: 'v1:000000001',
        version: 'v1',
        dictionaryId: 'lama',
        seq: 1,
        expression: '先生',
        expressionNfc: '先生',
        reading: 'せんせい',
        readingNfc: 'せんせい',
        definitions: ['guru'],
        partOfSpeech: ['n'],
        tags: [],
        rules: [],
      });
    });
    closeDatabase();
    const database = await openDatabase();
    const count = await requestToPromise(
      database.transaction(STORE_ENTRIES, 'readonly').objectStore(STORE_ENTRIES).count(),
    );
    expect(count).toBe(2);
  });
});

/**
 * Buat database berskema v3 (store `meta` satu record per baris) berisi satu kamus dengan
 * data meta/pitch, seperti instalasi sebelum upgrade ke v4.
 */
async function createVersionThreeDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore(STORE_DICTIONARIES, { keyPath: 'id' }).put({
        id: 'v3',
        name: 'Kamus v3',
        language: 'ja',
        definitionLanguage: 'id',
        schemaVersion: 3,
        license: '',
        attribution: '',
        entryCount: 1,
        metaCount: 2,
        status: 'active',
        order: 0,
        importedAt: Date.now(),
        activeVersion: 'v3',
        versions: ['v3'],
        approxSize: 100,
        sourceFileName: 'v3.zip',
      });
      const entries = database.createObjectStore(STORE_ENTRIES, { keyPath: 'key' });
      entries.createIndex(INDEX_BY_EXPRESSION, 'expressionNfc', { unique: false });
      entries.createIndex(INDEX_BY_READING, 'readingNfc', { unique: false });
      database.createObjectStore(STORE_IMPORTS, { keyPath: 'id' });
      const meta = database.createObjectStore(LEGACY_STORE_META, { keyPath: 'key' });
      meta.createIndex(INDEX_BY_EXPRESSION, 'expressionNfc', { unique: false });
      meta.put({
        key: 'v3:食べる\u0000',
        version: 'v3',
        dictionaryId: 'v3',
        expression: '食べる',
        expressionNfc: '食べる',
        reading: '',
        readingNfc: '',
        values: [{ type: 'freq', reading: '', frequency: { value: 1200 } }],
      });
      database.createObjectStore(STORE_KANJI, { keyPath: 'key' }).createIndex('by_character', 'character');
      database.createObjectStore(STORE_MEDIA, { keyPath: 'key' }).createIndex('by_dictionary_path', ['dictionaryId', 'path']);
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

describe('migrasi v3 → v4 (meta sebagai record pack)', () => {
  it('menghapus store meta lama dan menandai kamus perlu impor ulang', async () => {
    await createVersionThreeDatabase();
    const database = await openDatabase();

    expect(database.objectStoreNames.contains(LEGACY_STORE_META)).toBe(false);
    expect(database.objectStoreNames.contains(STORE_META_PACKS)).toBe(true);

    const record = await requestToPromise<DictionaryRecord | undefined>(
      database.transaction(STORE_DICTIONARIES, 'readonly').objectStore(STORE_DICTIONARIES).get('v3'),
    );
    expect(record?.metaCount).toBe(0);
    expect(record?.metaStale).toBe(true);
    // Data entry tidak ikut hilang.
    expect(record?.entryCount).toBe(1);
  });

  it('lookup meta tetap kosong (bukan error) setelah data lama dibuang', async () => {
    await createVersionThreeDatabase();
    await openDatabase();
    expect(await findMetaMatches('食べる', '')).toEqual([]);
  });
});
