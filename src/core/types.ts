/** Tipe bersama untuk search core. Modul ini tidak boleh bergantung pada DOM atau API Chrome. */

import type { DefinitionItem } from './structured.js';

/** Kelas kecocokan hasil lookup, diurutkan dari yang paling diutamakan. */
export type MatchType = 'exact' | 'reading' | 'deinflected';

/**
 * Satu langkah transformasi deinflection.
 *
 * `transformId` adalah nama transformasi (mis. `-た`, `-て`, `-くる`) yang berasal dari
 * tabel rule, bukan tebakan UI (PRD 4.4). Deskripsi langkah ada di lapisan UI dengan
 * kunci dari tabel transformasi.
 */
export interface DeinflectionStep {
  transformId: string;
  /** Akhiran bentuk permukaan yang diganti. */
  from: string;
  /** Pengganti yang mengubah bentuk menjadi bentuk sebelumnya. */
  to: string;
}

/** Hasil satu analisis deinflection: kandidat lema + jalur transformasi. */
export interface DeinflectionAnalysis {
  lemma: string;
  /** Tag kelas kata lema yang diharapkan oleh rule (mis. `v5k`). */
  partOfSpeech: string[];
  steps: DeinflectionStep[];
}

/** Entry kamus seperti yang dipakai search core (sudah digabung dengan metadata kamus). */
export interface DictionaryEntry {
  /** Kunci unik internal pada storage. */
  entryId: string;
  dictionaryId: string;
  dictionaryName: string;
  /** Urutan kamus aktif (0 = tertinggi). */
  dictionaryOrder: number;
  expression: string;
  /** String kosong bila dataset tidak menyediakan bacaan. */
  reading: string;
  /** Definisi: teks biasa atau simpul structured content yang sudah divalidasi. */
  definitions: DefinitionItem[];
  partOfSpeech: string[];
  tags: string[];
  /** Tag aturan yang dipakai untuk mencocokkan deinflection. */
  rules: string[];
  /** Prioritas/frekuensi entry bila dataset menyediakannya (mis. `score` Yomitan). */
  priority?: number;
}

/** Nilai pitch accent satu bacaan: posisi downstep dalam mora (0 = tanpa downstep). */
export interface PitchValue {
  position: number;
  /** Posisi mora tanpa suara (mis. ガ行 tanpa getaran), berbasis 1 seperti di kamus. */
  devoice: number[];
  /** Posisi mora dengan nasal (mis. ン / グ), berbasis 1. */
  nasal: number[];
}

/** Nilai frekuensi satu istilah; `displayValue` adalah bentuk tampil dari kamus. */
export interface FrequencyValue {
  value: number;
  displayValue?: string;
}

/** Satu nilai meta istilah dari `term_meta_bank_*.json` Yomitan. */
export type MetaValue =
  | { type: 'pitch'; reading: string; pitches: PitchValue[] }
  | { type: 'freq'; reading: string; frequency: FrequencyValue };

/** Nilai meta satu bentuk istilah, digabung dengan metadata kamusnya. */
export interface MetaMatch {
  dictionaryId: string;
  dictionaryName: string;
  dictionaryOrder: number;
  /** Ekspresi seperti tertulis di dataset. */
  expression: string;
  /** Bacaan yang dimiliki nilai ini (boleh kosong bila kamus tidak menyebutkannya). */
  reading: string;
  values: MetaValue[];
}

/** Satu kanji dari bank kanji, digabung dengan metadata kamusnya. */
export interface KanjiMatch {
  dictionaryId: string;
  dictionaryName: string;
  dictionaryOrder: number;
  character: string;
  onyomi: string[];
  kunyomi: string[];
  tags: string[];
  meanings: string[];
  stats: Record<string, string>;
}

/** Satu kanji hasil konversi bank kanji Yomitan, siap ditulis ke store `kanji`. */
export interface ParsedKanji {
  character: string;
  onyomi: string[];
  kunyomi: string[];
  tags: string[];
  meanings: string[];
  stats: Record<string, string>;
}

/** Satu nilai meta hasil konversi `term_meta_bank`. */
export interface ParsedMeta {
  expression: string;
  reading: string;
  values: MetaValue[];
}

/** Satu hasil lookup beserta metadata kecocokannya. */
export interface LookupMatch {
  entry: DictionaryEntry;
  matchType: MatchType;
  /** Bentuk permukaan pada kueri yang dicocokkan (bukan selalu sama dengan expression). */
  matchedText: string;
  /** Panjang kecocokan dalam code point. */
  matchLength: number;
  /** Rule yang cocok, hanya untuk `deinflected`. */
  steps: DeinflectionStep[];
  /**
   * Benar bila kelas kata entry divalidasi terhadap rule deinflection.
   * Entry tanpa tag POS/rules menghasilkan `false` (ambigu, bukan salah tegas).
   */
  partOfSpeechVerified: boolean;
}

export interface MatchSpan {
  /** Indeks awal dalam code point pada kueri yang sudah dinormalisasi. */
  start: number;
  /** Indeks akhir (eksklusif) dalam code point. */
  end: number;
}

export type LookupStatus = 'ok' | 'empty' | 'empty-query';

export interface LookupResult {
  /** Kueri setelah normalisasi NFC. */
  query: string;
  status: LookupStatus;
  /** Benar bila masih ada hasil lain di luar batas `maxResults`. */
  truncated: boolean;
  /** Benar bila kueri lebih panjang dari batas kandidat dan dipotong untuk pencarian. */
  inputTruncated: boolean;
  matches: LookupMatch[];
  /** Pitch accent/frekuensi untuk istilah yang cocok (boleh kosong). */
  meta: MetaMatch[];
  /** Data kanji untuk karakter yang diminta (hanya pada lookup kanji). */
  kanji: KanjiMatch[];
  span: MatchSpan | null;
}

/** Sumber data yang harus disediakan oleh lapisan storage untuk search core. */
export interface LookupSource {
  /** Exact match pada expression (indeks persisten). */
  findExactExpression(text: string): Promise<DictionaryEntry[]>;
  /** Exact match pada reading (hanya dipakai bila pencarian kana diaktifkan). */
  findExactReading(text: string): Promise<DictionaryEntry[]>;
  /** Nilai meta (pitch/frekuensi) untuk satu ekspresi + bacaan, semua kamus aktif. */
  findMeta(expressionNfc: string, readingNfc: string): Promise<MetaMatch[]>;
  /** Kanji untuk satu karakter, semua kamus aktif yang punya bank kanji. */
  findKanji(character: string): Promise<KanjiMatch[]>;
}

export interface LookupOptions {
  /** Batas panjang kandidat dalam code point. Default `MAX_CANDIDATE_CODE_POINTS`. */
  maxCandidateCodePoints?: number;
  /** Batas jumlah hasil yang dikembalikan. Default 30 (PRD 4.2). */
  maxResults?: number;
  /** Batas jumlah kandidat yang dicoba (anggaran pembacaan index). */
  maxCandidateLookups?: number;
  /** Aktifkan pencocokan query kana terhadap reading. Default true. */
  readingSearch?: boolean;
  /** Aktifkan deinflection. Default true. */
  deinflection?: boolean;
  /**
   * Posisi kursor di dalam kueri (code point). Bila diberikan, kandidat hanya
   * diterima bila mencakup posisi ini, sehingga kata yang di-hover tidak bergeser.
   */
  caretOffset?: number | null;
  /** Ambil data kanji untuk setiap karakter kueri (lookup dari klik kanji). */
  kanji?: boolean;
}
