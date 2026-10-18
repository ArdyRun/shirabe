/**
 * Utilitas teks yang sadar code point.
 *
 * Semua indeks/offset di Shirabe dihitung dalam satuan *code point* (bukan unit
 * UTF-16), supaya karakter di luar BMP (mis. kanji ekstensi B) tidak terpotong di
 * tengah surrogate pair. Modul ini murni (tanpa DOM/Chrome) sehingga dapat diuji
 * langsung tanpa browser.
 */

/** Jarak maksimum kandidat lookup dari titik awal, dalam code point (PRD 4.4/6.3). */
export const MAX_CANDIDATE_CODE_POINTS = 32;

/** Panjang string dalam code point. */
export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) {
    count += 1;
  }
  return count;
}

/** Pecah string menjadi array code point (aman untuk surrogate pair). */
export function toCodePoints(text: string): string[] {
  return Array.from(text);
}

/** Indeks UTF-16 dari indeks code point (untuk API DOM seperti Range). */
export function codePointToUtf16Index(text: string, codePointIndex: number): number {
  let utf16 = 0;
  let cp = 0;
  while (cp < codePointIndex && utf16 < text.length) {
    const code = text.codePointAt(utf16) ?? 0;
    utf16 += code > 0xffff ? 2 : 1;
    cp += 1;
  }
  return utf16;
}

/** Potong string berdasarkan indeks code point (start inklusif, end eksklusif). */
export function sliceCodePoints(text: string, start: number, end?: number): string {
  return toCodePoints(text)
    .slice(start, end ?? undefined)
    .join('');
}

const HIRAGANA = [0x3040, 0x309f] as const;
const KATAKANA = [0x30a0, 0x30ff] as const;
const KATAKANA_PHONETIC_EXT = [0x31f0, 0x31ff] as const;
const HALFWIDTH_KATAKANA = [0xff66, 0xff9f] as const;
const CJK_UNIFIED = [0x4e00, 0x9fff] as const;
const CJK_EXT_A = [0x3400, 0x4dbf] as const;
const CJK_COMPAT = [0xf900, 0xfaff] as const;
const CJK_EXT_B = [0x20000, 0x2ffff] as const;
const KANA_REPEAT = 0x3005; // 々
const WAVE_DASH = 0x301c;
const FULLWIDTH_TILDE = 0xff5e;

function inRange(value: number, range: readonly [number, number]): boolean {
  return value >= range[0] && value <= range[1];
}

/** Hiragana, katakana, atau tanda baca kana (ー). */
export function isKanaCodePoint(codePoint: string): boolean {
  const cp = codePoint.codePointAt(0);
  if (cp === undefined) {
    return false;
  }
  return (
    inRange(cp, HIRAGANA) ||
    inRange(cp, KATAKANA) ||
    inRange(cp, KATAKANA_PHONETIC_EXT) ||
    inRange(cp, HALFWIDTH_KATAKANA) ||
    cp === WAVE_DASH
  );
}

/**
 * Kelas karakter untuk batas kandidat kata.
 *
 * Dipakai `candidateWindows()` (search core): pergantian kelas — kanji → kana,
 * hiragana → katakana, dan seterusnya — adalah petunjuk awal kata terkuat yang tersedia
 * tanpa parser morfologi (PRD 13). Tanpa batas ini, teks Jepang tanpa spasi seperti
 * `陸上部だったので髪型はベリィショート` dianggap satu kata raksasa dan kata di tengahnya
 * tidak pernah dicari.
 */
export type CharacterClass = 'kanji' | 'hiragana' | 'katakana' | 'latin' | 'other';

/** Kelas satu code point; pemisah/tanda baca masuk `other`. */
export function characterClass(codePoint: string): CharacterClass {
  const cp = codePoint.codePointAt(0);
  if (cp === undefined) {
    return 'other';
  }
  if (inRange(cp, CJK_UNIFIED) || inRange(cp, CJK_EXT_A) || inRange(cp, CJK_COMPAT) || inRange(cp, CJK_EXT_B)) {
    return 'kanji';
  }
  if (cp === KANA_REPEAT) {
    return 'kanji';
  }
  if (inRange(cp, KATAKANA) || inRange(cp, KATAKANA_PHONETIC_EXT) || inRange(cp, HALFWIDTH_KATAKANA)) {
    return 'katakana';
  }
  if (inRange(cp, HIRAGANA)) {
    return 'hiragana';
  }
  if (cp === WAVE_DASH || cp === FULLWIDTH_TILDE) {
    return 'katakana';
  }
  return /[0-9A-Za-z_\u00c0-\u024f]/u.test(codePoint) ? 'latin' : 'other';
}

/** Kanji, hiragana, katakana, atau penanda pengulangan. */
export function isJapaneseCodePoint(codePoint: string): boolean {
  const cp = codePoint.codePointAt(0);
  if (cp === undefined) {
    return false;
  }
  return (
    isKanaCodePoint(codePoint) ||
    inRange(cp, CJK_UNIFIED) ||
    inRange(cp, CJK_EXT_A) ||
    inRange(cp, CJK_COMPAT) ||
    inRange(cp, CJK_EXT_B) ||
    cp === KANA_REPEAT
  );
}

/**
 * Karakter yang dianggap bagian dari sebuah kata saat content script menentukan
 * batas kandidat scan: Jepang, latin, dan digit. Tanda baca/pemisah bukan bagian kata.
 */
export function isWordCodePoint(codePoint: string): boolean {
  if (isJapaneseCodePoint(codePoint)) {
    return true;
  }
  const cp = codePoint.codePointAt(0);
  if (cp === undefined) {
    return false;
  }
  if (cp === WAVE_DASH || cp === FULLWIDTH_TILDE) {
    return true;
  }
  return /[0-9A-Za-z_\u00c0-\u024f]/u.test(codePoint);
}

/** Benar bila seluruh karakter adalah kana (dipakai untuk pencarian kana pada reading). */
export function isKanaOnly(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (const cp of text) {
    if (!isKanaCodePoint(cp)) {
      return false;
    }
  }
  return true;
}

/**
 * Normalisasi pencarian: NFC (PRD 4.2/6.3). Teks sumber yang ditampilkan ke
 * pengguna tidak pernah diganti — normalisasi hanya dipakai untuk indeks/kueri.
 */
export function normalizeQuery(text: string): string {
  return text.normalize('NFC');
}
