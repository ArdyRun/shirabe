/**
 * Store `media`: penyimpanan berkas media (gambar) kamus dan pembacaan satu berkas.
 *
 * Batas per berkas ditegakkan di sini: berkas yang terlalu besar dilewati dan
 * dilaporkan, tidak pernah menggagalkan impor kamus teks. Kuota total per kamus
 * (`maxMediaBytesPerDictionary`) ditegakkan pemanggil yang mengakumulasi lintas batch.
 */

import { IMPORT_LIMITS } from '../core/limits.js';
import { STORES, openDatabase, requestToPromise, withTransaction } from './db.js';
import { INDEX_BY_DICTIONARY_PATH, type MediaRecord, auxKey } from './schema.js';

/** Ekstensi → MIME; bentuk statis ber-key string. */
const MEDIA_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

/** MIME dari ekstensi jalur; tipe biner umum bila ekstensi tidak dikenal. */
export function parseMediaMime(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) {
    return 'application/octet-stream';
  }
  return MEDIA_MIME[path.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** Tulis satu batch berkas media milik sebuah versi dataset ke store `media`. */
export async function writeMediaBatch(
  version: string,
  dictionaryId: string,
  items: readonly { path: string; bytes: Uint8Array }[],
): Promise<{ stored: number; bytes: number; skipped: number }> {
  return withTransaction([STORES.media], 'readwrite', async (transaction) => {
    const store = transaction.objectStore(STORES.media);
    let stored = 0;
    let bytes = 0;
    let skipped = 0;
    for (const item of items) {
      const size = item.bytes.byteLength;
      if (size > IMPORT_LIMITS.maxMediaFileBytes) {
        skipped += 1;
        continue;
      }
      const mime = parseMediaMime(item.path);
      store.put({
        key: auxKey(version, dictionaryId, item.path),
        version,
        dictionaryId,
        path: item.path,
        mime,
        size,
        blob: new Blob([new Uint8Array(item.bytes)], { type: mime }),
      } satisfies MediaRecord);
      stored += 1;
      bytes += size;
    }
    return { stored, bytes, skipped };
  });
}

/**
 * Satu berkas media untuk kamus + jalur, hanya bila `version`-nya versi aktif.
 *
 * Index `[dictionaryId, path]` tidak unik antar versi dataset, jadi seluruh kandidat
 * diambil lalu dipilih yang cocok dengan versi aktif.
 */
export async function getMediaRecord(
  dictionaryId: string,
  path: string,
  activeVersion: string,
): Promise<MediaRecord | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(STORES.media, 'readonly');
  const request = transaction
    .objectStore(STORES.media)
    .index(INDEX_BY_DICTIONARY_PATH)
    .getAll([dictionaryId, path]);
  const records = await requestToPromise<MediaRecord[]>(request);
  return records.find((record) => record.version === activeVersion);
}
