/**
 * Skema penyimpanan IndexedDB (PRD 9.1) dan tipe ringkasan yang dipakai UI.
 *
 * Object store:
 * - `dictionaries`: metadata kamus, status, urutan, dan versi dataset aktif.
 * - `entries`: entry kamus, key unik internal, index expression/reading/versi.
 * - `imports`: job impor (staging) untuk progres, rollback, dan pembersihan startup.
 *
 * Versi dataset (`version`) memisahkan data mentah dari identitas kamus: impor
 * baru menulis ke versi baru, dan commit hanya memindahkan pointer `activeVersion`
 * pada metadata. Dengan begitu impor yang gagal tidak pernah menyentuh dataset aktif.
 */

import type { DefinitionItem } from '../core/structured.js';
import type { MetaValue } from '../core/types.js';

export const DB_NAME = 'shirabe';
/**
 * Versi skema IndexedDB.
 *
 * Riwayat: v1 → v2 menghapus index `by_version` pada `entries`. Index itu hanya dipakai
 * saat menulis (tidak pernah di-query) dan menambah biaya setiap `put` entry pada impor
 * kamus besar; penghapusan versi dataset dilakukan dengan range delete pada kunci entry.
 * v2 → v3 menambah store `meta` (pitch/frekuensi), `kanji`, dan `media` (gambar kamus).
 * v3 → v4 mengganti store `meta` (satu record per baris) dengan `meta_packs` (satu record
 * memuat banyak item). Penyebabnya terukur: biaya satu `put` IndexedDB ±100 µs per record di
 * mesin uji, tidak bergantung ukuran record, index, ukuran transaksi, atau mode durability,
 * sehingga impor kamus frekuensi 478.000 baris memakan ±66 s. Kamus yang sudah terpasang
 * kehilangan data meta/pitch-nya dan ditandai perlu impor ulang (lihat `upgrade()`).
 */
export const DB_VERSION = 4;
export const STORE_DICTIONARIES = 'dictionaries';
export const STORE_ENTRIES = 'entries';
export const STORE_IMPORTS = 'imports';
/**
 * Meta istilah (pitch/frekuensi) sebagai record pack: satu record memuat banyak item
 * (lihat {@link MetaPackRecord}). Menggantikan store `meta` satu-record-per-baris di v3.
 */
export const STORE_META_PACKS = 'meta_packs';
/** Nama store meta lama (v3), dihapus saat upgrade ke v4. */
export const LEGACY_STORE_META = 'meta';
/** Bank kanji: `kanji_bank_*.json` Yomitan. */
export const STORE_KANJI = 'kanji';
/** Berkas media kamus (gambar) yang direferensikan definisi. */
export const STORE_MEDIA = 'media';

export const INDEX_BY_EXPRESSION = 'by_expression';
export const INDEX_BY_READING = 'by_reading';
export const INDEX_BY_CHARACTER = 'by_character';
export const INDEX_BY_DICTIONARY_PATH = 'by_dictionary_path';
/** Nama index lama (skema v1) yang dihapus saat upgrade ke v2. */
export const LEGACY_INDEX_BY_VERSION = 'by_version';

export type DictionaryStatus = 'active' | 'disabled';

export interface DictionaryRecord {
  /** ID publik dari header dataset. */
  id: string;
  name: string;
  language: string;
  definitionLanguage: string;
  schemaVersion: number;
  license: string;
  attribution: string;
  entryCount: number;
  status: DictionaryStatus;
  /** Urutan pencarian kamus; 0 = prioritas tertinggi. */
  order: number;
  importedAt: number;
  /** Versi dataset yang sedang dipakai. */
  activeVersion: string;
  /** Semua versi dataset yang masih menempati storage (aktif + sisa pembersihan). */
  versions: string[];
  /** Perkiraan ukuran data dalam byte (dihitung saat impor). */
  approxSize: number;
  sourceFileName: string;
  /** Jumlah kanji dari bank kanji Yomitan (kamus istilah saja = 0). */
  kanjiCount?: number;
  /** Jumlah nilai meta pitch/frekuensi pada kamus ini. */
  metaCount?: number;
  /**
   * Benar bila data meta/pitch kamus ini hilang karena upgrade skema (v3 → v4) dan kamus
   * perlu diimpor ulang. Daftar kamus menampilkannya sebagai catatan tindakan.
   */
  metaStale?: boolean;
  /** Jumlah berkas media (gambar) yang disimpan. */
  mediaCount?: number;
  /** Total byte media yang disimpan. */
  mediaBytes?: number;
  /**
   * Ditandai saat penghapusan dimulai: metadata sudah dinonaktifkan dan entry
   * sedang dihapus. Sweep startup menyelesaikan penghapusan bila proses terputus.
   */
  pendingDelete?: boolean;
}

export interface EntryRecord {
  /** `${version}:${seq}` */
  key: string;
  version: string;
  dictionaryId: string;
  seq: number;
  /** Teks asli dataset (untuk ditampilkan, tidak dinormalisasi). */
  expression: string;
  /** Bentuk NFC untuk indeks. */
  expressionNfc: string;
  reading: string;
  readingNfc: string;
  definitions: DefinitionItem[];
  partOfSpeech: string[];
  tags: string[];
  rules: string[];
  /**
   * Prioritas/frekuensi (nilai lebih besar = lebih umum). Diisi importer Yomitan dari
   * field `score` sumber; tidak ada pada schema JSONL v1 dan tidak wajib ada.
   */
  priority?: number;
}

export type ImportPhase = 'reading' | 'validating' | 'writing' | 'committing' | 'failed';

/* --------------------------------------------------------------- meta & kanji */

/**
 * Satu nilai meta (pitch/frekuensi) untuk sebuah (ekspresi NFC, bacaan NFC).
 *
 * Kamus meta tidak punya term bank, jadi nilai disimpan per bentuk istilah; lookup
 * menggabungkannya ke kartu entri yang ekspresi/bacaannya sama.
 */
export interface MetaItem {
  expression: string;
  expressionNfc: string;
  reading: string;
  readingNfc: string;
  values: MetaValue[];
}

/**
 * Sekumpulan item meta dalam satu record ("pack").
 *
 * Kamus frekuensi/pitch bisa berisi ratusan ribu baris, dan biaya satu `put` IndexedDB
 * sekitar 100 µs **per record** di mesin uji (tidak bergantung ukuran record, index,
 * ukuran transaksi, atau mode durability — lihat `docs/mvp-audit.md` §4.26). Menulis satu
 * record per baris membuat impor 478.000 baris memakan ~66 s; menggabungkan baris ke dalam
 * record pack membuat jumlah `put` turun ke ribuan dan fase tulis menjadi ~3 s.
 *
 * Kunci record `packKey()` memakai awalan versi agar penghapusan satu versi dataset tetap
 * satu range delete, dan menambahkan bucket + nomor urut agar penulisan bersifat
 * *append* (tanpa baca-ubah-tulis).
 */
export interface MetaPackRecord {
  /** `${version}:${bucket}:${seq}` */
  key: string;
  version: string;
  dictionaryId: string;
  /** Bucket hash dari `expressionNfc`; lookup menghitungnya dari kueri. */
  bucket: string;
  seq: number;
  items: MetaItem[];
}

/**
 * Jumlah bucket pack. Dipilih dari pengukuran prototipe pada mesin uji (478.044 baris):
 * 1024 bucket → tulis 2,5 s/langkah baca 2–4 ms; 2048 → 3,0 s/1–2 ms; 512 → 3,5 s/3–6 ms.
 * 2048 dipakai karena pembacaan lookup lebih murah tanpa biaya tulis yang berarti.
 */
export const PACK_BUCKETS = 2048;

/**
 * Bucket pack dari sebuah kunci pencarian (ekspresi NFC).
 *
 * Hash FNV-1a 32-bit: deterministik lintas sesi (wajib, karena kueri harus dapat
 * menghitung bucket tanpa membaca metadata) dan tersebar rata untuk teks Jepang.
 */
export function packBucket(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % PACK_BUCKETS).toString(36);
}

/** Awalan kunci semua pack satu (versi, bucket); dipakai lookup sebagai range read. */
export function packKeyPrefix(version: string, bucket: string): string {
  return `${version}:${bucket}:`;
}

/** Kunci satu record pack. */
export function packKey(version: string, bucket: string, seq: number): string {
  return `${packKeyPrefix(version, bucket)}${String(seq).padStart(6, '0')}`;
}

/** Satu kanji dari `kanji_bank_*.json` Yomitan. */
export interface KanjiRecord {
  /** `${version}:${character}` */
  key: string;
  version: string;
  dictionaryId: string;
  character: string;
  onyomi: string[];
  kunyomi: string[];
  tags: string[];
  meanings: string[];
  /** Statistik bebas dari bank (mis. `strokes`, `grade`, `freq`, `jlpt`). */
  stats: Record<string, string>;
}

/** Satu berkas media (gambar) kamus yang direferensikan definisi. */
export interface MediaRecord {
  /** `${version}:${dictionaryId}\u0000${path}` */
  key: string;
  version: string;
  dictionaryId: string;
  /** Jalur relatif di dalam kamus, mis. `sankoku8/graphics/000irori.png`. */
  path: string;
  mime: string;
  size: number;
  blob: Blob;
}

/**
 * Kunci record turunan (`meta`, `kanji`, `media`).
 *
 * Sama seperti entry: awalan `${version}:` membuat penghapusan seluruh data satu versi
 * dataset cukup satu range delete, sehingga impor ulang dan impor gagal tetap bersih.
 */
export function auxKey(version: string, ...parts: string[]): string {
  return `${version}:${parts.join('\u0000')}`;
}

export interface ImportJobRecord {
  id: string;
  version: string;
  dictionaryId: string;
  dictionaryName: string;
  fileName: string;
  fileSize: number;
  header: {
    /** Versi schema dataset yang sedang diimpor (1 atau 2). */
    schemaVersion: number;
    language: string;
    definitionLanguage: string;
    license: string;
    attribution: string;
  };
  phase: ImportPhase;
  linesRead: number;
  entriesWritten: number;
  /** Perkiraan ukuran data entry yang sudah ditulis (byte). */
  approxSize: number;
  startedAt: number;
  /** Diperbarui setiap batch; job yang heartbeat-nya kedaluwarsa dianggap ditinggalkan. */
  heartbeatAt: number;
  /** Menandai apakah commit harus menggantikan kamus dengan ID yang sama. */
  replace: boolean;
}

export interface DictionarySummary {
  id: string;
  name: string;
  language: string;
  definitionLanguage: string;
  license: string;
  attribution: string;
  entryCount: number;
  status: DictionaryStatus;
  order: number;
  importedAt: number;
  approxSize: number;
  sourceFileName: string;
  /** Ringkasan isi kamus selain istilah (0 bila tidak ada). */
  kanjiCount: number;
  metaCount: number;
  mediaCount: number;
  mediaBytes: number;
  /** Benar bila data meta/pitch hilang karena upgrade skema dan kamus perlu diimpor ulang. */
  metaStale: boolean;
}

export interface StorageInfo {
  /** Byte terpakai menurut StorageManager (bila tersedia). */
  usage: number;
  quota: number;
  entryCount: number;
  dictionaryCount: number;
  /** Objek storage IndexedDB sudah ada dan dapat dibuka. */
  available: boolean;
}

export function toDictionarySummary(record: DictionaryRecord): DictionarySummary {
  return {
    id: record.id,
    name: record.name,
    language: record.language,
    definitionLanguage: record.definitionLanguage,
    license: record.license,
    attribution: record.attribution,
    entryCount: record.entryCount,
    status: record.status,
    order: record.order,
    importedAt: record.importedAt,
    approxSize: record.approxSize,
    sourceFileName: record.sourceFileName,
    kanjiCount: record.kanjiCount ?? 0,
    metaCount: record.metaCount ?? 0,
    mediaCount: record.mediaCount ?? 0,
    mediaBytes: record.mediaBytes ?? 0,
    metaStale: record.metaStale ?? false,
  };
}

/** Versi dataset baru (dipakai untuk staging maupun dataset yang sudah commit). */
export function newDatasetVersion(): string {
  return crypto.randomUUID();
}

/**
 * Kunci entry untuk sebuah versi dataset.
 *
 * Nomor urut diberi padding lebar tetap supaya urutan leksikografis kunci sama dengan
 * urutan penulisan dataset: ranking hasil lookup memakai `entryId` sebagai tie-break,
 * sehingga kamus yang diurutkan berdasarkan frekuensi (mis. hasil konversi Yomitan)
 * tetap menampilkan entri paling umum lebih dahulu.
 */
export function entryKey(version: string, seq: number): string {
  return `${version}:${String(seq).padStart(9, '0')}`;
}

/** Rentang kunci seluruh entry satu versi dataset, dipakai untuk penghapusan massal. */
export function versionKeyRange(version: string): IDBKeyRange {
  return IDBKeyRange.bound(`${version}:`, `${version}:\uffff`);
}
