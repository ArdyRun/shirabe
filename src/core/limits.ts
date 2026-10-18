/**
 * Batas data impor dan lookup (PRD 8.1: batas dilaporkan sebelum impor).
 *
 * Angka di sini adalah batas awal untuk MVP pada perangkat pengembangan, bukan
 * janji kapasitas. UI menampilkan batas ini pada dialog impor.
 */

export const IMPORT_LIMITS = {
  /** Ukuran file maksimum yang diterima. */
  maxFileBytes: 128 * 1024 * 1024,
  /** Jumlah entry maksimum per kamus. */
  maxEntries: 1_000_000,
  /** Panjang baris maksimum dalam code point (baris lebih panjang ditolak dengan nomor baris). */
  maxLineCodePoints: 64 * 1024,
  /** Panjang maksimum satu string (definisi/ekspresi/bacaan). */
  maxStringCodePoints: 8 * 1024,
  /** Jumlah maksimum definisi per entry. */
  maxDefinitionsPerEntry: 64,
  /** Jumlah maksimum tag per entry (POS/tags/rules dihitung terpisah). */
  maxTagsPerEntry: 64,
  /** Jumlah maksimum simpul structured content dalam satu definisi. */
  maxStructuredNodesPerDefinition: 256,
  /** Kedalaman maksimum sarang structured content. */
  maxStructuredDepth: 12,
  /** Panjang maksimum satu potongan teks di dalam structured content. */
  maxStructuredTextCodePoints: 2_000,
  /**
   * Jumlah maksimum entry per batch transaksi IndexedDB.
   *
   * Batch berukuran besar (dibatasi target byte pada UI impor) mengurangi jumlah pesan
   * antar-context, yang merupakan biaya utama impor kamus besar.
   */
  writeBatchSize: 30_000,
  /** Jumlah baris yang diproses per potongan pada UI impor. */
  parseChunkSize: 500,
  /** Target ukuran satu batch entry yang dikirim ke service worker (byte, perkiraan). */
  importBatchTargetBytes: 6 * 1024 * 1024,
  /** Jumlah maksimum kanji per kamus (bank kanji Yomitan). */
  maxKanjiPerDictionary: 100_000,
  /** Jumlah maksimum entri meta (pitch/frekuensi) per kamus. */
  maxMetaPerDictionary: 2_000_000,
  /** Panjang maksimum jalur media relatif di dalam kamus. */
  maxMediaPathCodePoints: 512,
  /**
   * Ukuran maksimum satu berkas media (gambar) yang disimpan saat impor. Berkas
   * dikirim ke popup sebagai data URL (base64, ±1,37x), jadi batas ini menjaga
   * balasan pesan tetap di bawah `MAX_MESSAGE_BYTES`.
   */
  maxMediaFileBytes: 2 * 1024 * 1024,
  /**
   * Kuota total media per kamus. Kuota habis tidak menggagalkan impor: berkas
   * berikutnya dilewati dan dilaporkan, supaya kamus teks besar tidak pernah batal
   * hanya karena lampiran gambarnya.
   */
  maxMediaBytesPerDictionary: 64 * 1024 * 1024,
  /** Jumlah maksimum kanji yang dikembalikan satu lookup. */
  maxKanjiPerLookup: 4,
  /** Jumlah maksimum nilai meta (pitch/frekuensi) yang dikembalikan satu lookup. */
  maxMetaPerLookup: 24,
} as const;
