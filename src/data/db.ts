/**
 * Akses IndexedDB untuk Shirabe (PRD 6.1, 9.1).
 *
 * Service worker MV3 dapat dihentikan kapan saja, jadi tidak ada state penting
 * yang disimpan di memori global modul ini: koneksi dibuka ulang sesuai kebutuhan
 * dan ditutup bila ada `versionchange`.
 */

import {
  DB_NAME,
  DB_VERSION,
  INDEX_BY_CHARACTER,
  INDEX_BY_DICTIONARY_PATH,
  INDEX_BY_EXPRESSION,
  INDEX_BY_READING,
  LEGACY_INDEX_BY_VERSION,
  LEGACY_STORE_META,
  STORE_DICTIONARIES,
  STORE_ENTRIES,
  STORE_IMPORTS,
  STORE_KANJI,
  STORE_MEDIA,
  STORE_META_PACKS,
  type DictionaryRecord,
} from './schema.js';

let connection: IDBDatabase | null = null;
let opening: Promise<IDBDatabase> | null = null;

/** Kesalahan storage dengan kode terstruktur agar dapat dipetakan ke pesan UI. */
export class StorageError extends Error {
  readonly code: 'STORAGE_QUOTA' | 'STORAGE_ERROR' | 'NOT_FOUND' | 'CONFLICT';

  constructor(
    code: 'STORAGE_QUOTA' | 'STORAGE_ERROR' | 'NOT_FOUND' | 'CONFLICT',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}

function upgrade(database: IDBDatabase, oldVersion: number, transaction: IDBTransaction | null): void {
  if (!database.objectStoreNames.contains(STORE_DICTIONARIES)) {
    database.createObjectStore(STORE_DICTIONARIES, { keyPath: 'id' });
  }
  if (!database.objectStoreNames.contains(STORE_ENTRIES)) {
    const entriesStore = database.createObjectStore(STORE_ENTRIES, { keyPath: 'key' });
    entriesStore.createIndex(INDEX_BY_EXPRESSION, 'expressionNfc', { unique: false });
    entriesStore.createIndex(INDEX_BY_READING, 'readingNfc', { unique: false });
  } else if (oldVersion < 2 && transaction !== null) {
    // Index `by_version` tidak pernah di-query; hapus agar setiap penulisan entry lebih murah.
    const entriesStore = transaction.objectStore(STORE_ENTRIES);
    if (entriesStore.indexNames.contains(LEGACY_INDEX_BY_VERSION)) {
      entriesStore.deleteIndex(LEGACY_INDEX_BY_VERSION);
    }
  }
  if (!database.objectStoreNames.contains(STORE_IMPORTS)) {
    database.createObjectStore(STORE_IMPORTS, { keyPath: 'id' });
  }
  // v3: data turunan kamus (kanji, media). Kuncinya berawalan `${version}:` seperti entry,
  // jadi impor gagal/replace tetap bersih dengan range delete.
  if (!database.objectStoreNames.contains(STORE_KANJI)) {
    const kanjiStore = database.createObjectStore(STORE_KANJI, { keyPath: 'key' });
    kanjiStore.createIndex(INDEX_BY_CHARACTER, 'character', { unique: false });
  }
  if (!database.objectStoreNames.contains(STORE_MEDIA)) {
    const mediaStore = database.createObjectStore(STORE_MEDIA, { keyPath: 'key' });
    mediaStore.createIndex(INDEX_BY_DICTIONARY_PATH, ['dictionaryId', 'path'], { unique: false });
  }
  // v4: meta sebagai record pack. Store `meta` v3 dihapus (bukan dibiarkan sebagai jalur
  // kedua) supaya tidak ada dua bentuk penyimpanan yang harus dirawat; kamus yang kehilangan
  // data meta ditandai `metaStale` agar daftar kamus meminta impor ulang.
  if (!database.objectStoreNames.contains(STORE_META_PACKS)) {
    database.createObjectStore(STORE_META_PACKS, { keyPath: 'key' });
  }
  if (transaction !== null && database.objectStoreNames.contains(LEGACY_STORE_META)) {
    database.deleteObjectStore(LEGACY_STORE_META);
    const dictionaries = transaction.objectStore(STORE_DICTIONARIES);
    const cursorRequest = dictionaries.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor === null) {
        return;
      }
      const record = cursor.value as DictionaryRecord;
      if ((record.metaCount ?? 0) > 0) {
        cursor.update({ ...record, metaCount: 0, metaStale: true } satisfies DictionaryRecord);
      }
      cursor.continue();
    };
  }
}

/** Buka (atau buka ulang) koneksi database. */
export function openDatabase(): Promise<IDBDatabase> {
  if (connection !== null) {
    return Promise.resolve(connection);
  }
  if (opening !== null) {
    return opening;
  }
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  opening = promise;
  let request: IDBOpenDBRequest;
  try {
    request = indexedDB.open(DB_NAME, DB_VERSION);
  } catch (error) {
    opening = null;
    reject(new StorageError('STORAGE_ERROR', 'IndexedDB tidak dapat dibuka.', { cause: error }));
    return promise;
  }
  request.onupgradeneeded = (event) => {
    upgrade(request.result, event.oldVersion, request.transaction);
  };
  request.onsuccess = () => {
    const database = request.result;
    connection = database;
    opening = null;
    database.onclose = () => {
      connection = null;
    };
    database.onversionchange = () => {
      database.close();
      connection = null;
    };
    resolve(database);
  };
  request.onerror = () => {
    opening = null;
    reject(
      new StorageError('STORAGE_ERROR', 'IndexedDB tidak dapat dibuka.', {
        cause: request.error ?? undefined,
      }),
    );
  };
  request.onblocked = () => {
    opening = null;
    reject(
      new StorageError(
        'STORAGE_ERROR',
        'Database sedang dipakai versi lain. Tutup tab Shirabe lain lalu coba lagi.',
      ),
    );
  };
  return promise;
}

/** Tutup koneksi (dipakai pengujian). */
export function closeDatabase(): void {
  connection?.close();
  connection = null;
  opening = null;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  request.onsuccess = () => {
    resolve(request.result);
  };
  request.onerror = () => {
    reject(translateError(request.error));
  };
  return promise;
}

function translateError(error: DOMException | null): StorageError {
  if (error?.name === 'QuotaExceededError') {
    return new StorageError(
      'STORAGE_QUOTA',
      'Kuota penyimpanan extension habis. Hapus kamus yang tidak dipakai lalu coba lagi.',
      { cause: error },
    );
  }
  return new StorageError('STORAGE_ERROR', error?.message ?? 'Operasi storage gagal.', {
    cause: error ?? undefined,
  });
}

/** Tunggu transaksi selesai (commit) atau gagal. */
export function transactionDone(transaction: IDBTransaction): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  transaction.oncomplete = () => {
    resolve();
  };
  transaction.onabort = () => {
    reject(translateError(transaction.error));
  };
  transaction.onerror = () => {
    reject(translateError(transaction.error));
  };
  return promise;
}

/**
 * Jalankan fungsi di dalam satu transaksi IndexedDB.
 * `body` hanya boleh menunggu request IndexedDB (bukan promise lain), karena
 * transaksi akan commit otomatis begitu tidak ada request tertunda.
 */
export async function withTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  body: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  const transaction = database.transaction(stores, mode);
  const done = transactionDone(transaction);
  try {
    const result = await body(transaction);
    await done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Transaksi mungkin sudah selesai; abaikan.
    }
    await done.catch(() => undefined);
    throw error;
  }
}

export async function getRecord<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(store, 'readonly');
  const request = transaction.objectStore(store).get(key);
  return requestToPromise(request) as Promise<T | undefined>;
}

export async function getAllRecords<T>(store: string): Promise<T[]> {
  const database = await openDatabase();
  const transaction = database.transaction(store, 'readonly');
  const request = transaction.objectStore(store).getAll();
  return requestToPromise(request) as Promise<T[]>;
}

export async function putRecord(store: string, value: unknown): Promise<void> {
  await withTransaction([store], 'readwrite', async (transaction) => {
    transaction.objectStore(store).put(value);
  });
}

export const STORES = {
  dictionaries: STORE_DICTIONARIES,
  entries: STORE_ENTRIES,
  imports: STORE_IMPORTS,
  metaPacks: STORE_META_PACKS,
  kanji: STORE_KANJI,
  media: STORE_MEDIA,
} as const;
