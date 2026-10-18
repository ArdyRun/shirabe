/**
 * Store `meta_packs`: penulisan item meta (pitch/frekuensi) sebagai record pack dan
 * pembacaan untuk lookup.
 *
 * Meta disimpan terpisah dari entry karena kamus pitch/frekuensi tidak punya term bank;
 * nilainya digabungkan ke kartu entri yang ekspresi + bacaannya sama saat lookup.
 *
 * Satu record memuat banyak item (lihat `MetaPackRecord`) karena biaya satu `put`
 * IndexedDB di mesin uji ±100 µs **per record** dan tidak berubah oleh ukuran record,
 * index, ukuran transaksi, maupun mode durability (`docs/mvp-audit.md` §4.26): impor
 * frekuensi 478.044 baris memakan ±66 s sebagai satu record per baris, dan ±3 s sebagai
 * record pack (beberapa ribu `put`).
 */

import { IMPORT_LIMITS } from '../core/limits.js';
import { normalizeQuery } from '../core/text.js';
import type { MetaMatch, ParsedMeta } from '../core/types.js';
import { STORES, openDatabase, requestToPromise, withTransaction } from './db.js';
import {
  packBucket,
  packKey,
  packKeyPrefix,
  type DictionaryRecord,
  type MetaItem,
  type MetaPackRecord,
} from './schema.js';

/** Jumlah item maksimum dalam satu record pack (jaring pengaman untuk sebaran bucket miring). */
const PACK_ITEMS = 1_000;
/**
 * Anggaran item di memori sebelum seluruh bucket yang terisi ditulis.
 *
 * Menjaga puncak memori impor (±250.000 item ≈ 120 MB) sekaligus mempertahankan jumlah
 * `put` yang kecil: kamus 478.000 baris → 2 flush × 2.048 bucket = 4.096 `put`.
 */
const PACK_BUDGET_ITEMS = 250_000;

interface PackBuffer {
  version: string;
  dictionaryId: string;
  buckets: Map<string, MetaItem[]>;
  items: number;
  /** Urutan record berikutnya; naik terus dalam satu versi agar kunci tidak bertabrakan. */
  seq: number;
}

let buffer: PackBuffer | null = null;

function toItem(meta: ParsedMeta): MetaItem {
  return {
    expression: meta.expression,
    expressionNfc: normalizeQuery(meta.expression),
    reading: meta.reading,
    readingNfc: normalizeQuery(meta.reading),
    values: meta.values,
  };
}

/**
 * Tambahkan item meta impor ke buffer pack.
 *
 * Record pack ditulis saat anggaran item tercapai atau satu bucket penuh; pemanggil
 * **wajib** memanggil {@link flushMetaPacks} sebelum commit agar sisa buffer tersimpan.
 */
export async function appendMetaItems(
  version: string,
  dictionaryId: string,
  meta: readonly ParsedMeta[],
): Promise<{ written: number; items: number }> {
  if (meta.length === 0) {
    return { written: 0, items: 0 };
  }
  if (buffer !== null && (buffer.version !== version || buffer.dictionaryId !== dictionaryId)) {
    // Versi/kamus berbeda berarti impor sebelumnya tidak selesai sampai commit; buffernya
    // dibuang karena barisnya hanya akan berada di bawah versi yang tidak pernah dipakai.
    buffer = null;
  }
  buffer ??= { version, dictionaryId, buckets: new Map(), items: 0, seq: 0 };
  const current = buffer;
  let written = 0;
  let itemsWritten = 0;
  for (const item of meta) {
    const value = toItem(item);
    const bucket = packBucket(value.expressionNfc);
    const list = current.buckets.get(bucket);
    if (list === undefined) {
      current.buckets.set(bucket, [value]);
    } else {
      list.push(value);
      if (list.length >= PACK_ITEMS) {
        // Sebaran bucket yang miring (mis. satu ekspresi berulang) tidak boleh membuat satu
        // record raksasa: tulis sekarang juga, lanjutkan dengan buffer kosong.
        const flushed = await flushMetaPacks();
        written += flushed.written;
        itemsWritten += flushed.items;
        continue;
      }
    }
    current.items += 1;
  }
  if (current.items >= PACK_BUDGET_ITEMS) {
    const flushed = await flushMetaPacks();
    written += flushed.written;
    itemsWritten += flushed.items;
  }
  return { written, items: itemsWritten };
}

/** Tulis seluruh bucket yang terisi sebagai record pack; dipanggil juga sebelum commit. */
export async function flushMetaPacks(): Promise<{ written: number; items: number }> {
  const current = buffer;
  if (current === null || current.buckets.size === 0) {
    return { written: 0, items: 0 };
  }
  const entries = [...current.buckets.entries()];
  current.buckets.clear();
  const firstSeq = current.seq;
  current.seq += entries.length;
  current.items = 0;
  return await withTransaction([STORES.metaPacks], 'readwrite', async (transaction) => {
    const store = transaction.objectStore(STORES.metaPacks);
    let items = 0;
    entries.forEach(([bucket, list], index) => {
      items += list.length;
      store.put({
        key: packKey(current.version, bucket, firstSeq + index),
        version: current.version,
        dictionaryId: current.dictionaryId,
        bucket,
        seq: firstSeq + index,
        items: list,
      } satisfies MetaPackRecord);
    });
    return { written: entries.length, items };
  });
}

/** Benar bila ada item yang masih menunggu ditulis (dipakai pengujian). */
export function hasBufferedMeta(): boolean {
  return buffer !== null && buffer.buckets.size > 0;
}

/** Buang buffer tanpa menulis (impor gagal atau dibatalkan). */
export function discardBufferedMeta(): void {
  buffer = null;
}

/**
 * Nilai meta untuk satu ekspresi + bacaan (keduanya NFC) dari semua kamus aktif.
 *
 * Bucket dihitung dari ekspresi kueri; setiap versi dataset aktif dibaca dengan range read
 * pada awalan `${version}:${bucket}:`. Item dengan `readingNfc` kosong dianggap berlaku
 * untuk bacaan apa pun, karena kamus Yomitan boleh tidak menyebutkan bacaan. Urutan
 * mengikuti `dictionaryOrder`, dibatasi `maxMetaPerLookup`.
 */
export async function findMetaMatches(
  expressionNfc: string,
  readingNfc: string,
): Promise<MetaMatch[]> {
  const database = await openDatabase();
  const transaction = database.transaction([STORES.metaPacks, STORES.dictionaries], 'readonly');
  const dictionaryRecords = await requestToPromise<DictionaryRecord[]>(
    transaction.objectStore(STORES.dictionaries).getAll(),
  );
  const active = dictionaryRecords.filter(
    (record) => record.status === 'active' && record.activeVersion.length > 0,
  );
  if (active.length === 0) {
    return [];
  }
  // Bucket ditentukan kueri, jadi satu range read per versi aktif mengambil seluruh item
  // yang mungkin cocok (tanpa index per baris).
  const bucket = packBucket(expressionNfc);
  const store = transaction.objectStore(STORES.metaPacks);
  const packs = (
    await Promise.all(
      active.map((record) => {
        const prefix = packKeyPrefix(record.activeVersion, bucket);
        return requestToPromise<MetaPackRecord[]>(
          store.getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`)),
        );
      }),
    )
  ).flat();

  const byId = new Map(dictionaryRecords.map((record) => [record.id, record]));
  const result: MetaMatch[] = [];
  for (const pack of packs) {
    const dictionary = byId.get(pack.dictionaryId);
    // Hanya kamus aktif dan versi dataset yang sedang aktif.
    if (dictionary === undefined || dictionary.status !== 'active') {
      continue;
    }
    if (dictionary.activeVersion !== pack.version) {
      continue;
    }
    for (const item of pack.items) {
      if (item.expressionNfc !== expressionNfc) {
        continue;
      }
      if (item.readingNfc.length > 0 && item.readingNfc !== readingNfc) {
        continue;
      }
      result.push({
        dictionaryId: dictionary.id,
        dictionaryName: dictionary.name,
        dictionaryOrder: dictionary.order,
        expression: item.expression,
        reading: item.reading,
        values: item.values,
      });
    }
  }
  result.sort(
    (a, b) =>
      a.dictionaryOrder - b.dictionaryOrder ||
      a.expression.localeCompare(b.expression) ||
      a.reading.localeCompare(b.reading),
  );
  return result.slice(0, IMPORT_LIMITS.maxMetaPerLookup);
}
