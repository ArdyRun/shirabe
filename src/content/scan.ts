/**
 * Penentuan kandidat kata dari posisi pointer (PRD 4.1, 6.3 langkah 1–4).
 *
 * Content script hanya mengirim kueri (kandidat kata) ke service worker; teks halaman di
 * sekitar kursor tidak pernah dikirim atau disimpan.
 *
 * Batas kata bahasa Jepang tidak dapat ditentukan tanpa parser (PRD 13). Karena itu
 * awal kandidat didekati dengan heuristik kelas karakter:
 * - jika kursor berada di kanji, mundur selama masih kanji (mis. 学生 dari 私は学生です);
 * - jika kursor berada di kana, mundur selama masih kana, lalu ikut menyertakan
 *   rangkaian kanji tepat sebelumnya (mis. 食べたい, 書きます).
 * Search core kemudian mencoba prefix terpanjang dari titik awal yang dikirim, jadi
 * kandidat yang lebih pendek/panjang tetap mendapat kesempatan dicocokkan.
 */

import {
  MAX_CANDIDATE_CODE_POINTS,
  characterClass,
  isJapaneseCodePoint,
  isWordCodePoint,
  toCodePoints,
} from '../core/text.js';

/** Seberapa jauh awal kandidat boleh mundur dari posisi kursor. */
export const MAX_LOOKBACK_CODE_POINTS = 16;

export interface ScanCandidate {
  /** Kandidat kueri: rentetan karakter kata, maksimum 32 code point. */
  query: string;
  /**
   * Segmen kelas karakter di sekitar kursor (kanji/kana/katakana), maksimum
   * {@link MAX_SEGMENT_CODE_POINTS} code point.
   *
   * Dipakai UI sebagai teks kueri yang ditampilkan: kandidat lookup sendiri dibiarkan
   * lebar (termasuk kanji sebelum kana, untuk dasar kata kerja seperti `食べる`), tetapi
   * menampilkan seluruh rangkaian tanpa spasi sebagai "kata yang dicari" menyesatkan —
   * pesan "tidak ada hasil" lalu memuat satu kalimat penuh. Hachidori menampilkan teks
   * pindai (dari kursor, `scanLength` code point); segmen kelas ini adalah bentuk
   * setaranya untuk tampilan.
   */
  segment: string;
  /** Indeks awal kandidat dalam text node, satuan code point. */
  start: number;
  /** Indeks akhir (eksklusif) kandidat dalam text node. */
  end: number;
  /** Posisi kursor relatif terhadap awal kandidat, satuan code point. */
  caretOffset: number;
}

function isKanjiCodePoint(codePoint: string): boolean {
  return isJapaneseCodePoint(codePoint) && !isKana(codePoint);
}

function isKana(codePoint: string): boolean {
  const cp = codePoint.codePointAt(0);
  if (cp === undefined) {
    return false;
  }
  return (
    (cp >= 0x3040 && cp <= 0x309f) ||
    (cp >= 0x30a0 && cp <= 0x30ff) ||
    (cp >= 0x31f0 && cp <= 0x31ff) ||
    (cp >= 0xff66 && cp <= 0xff9f) ||
    cp === 0x301c
  );
}

/**
 * Tentukan awal kandidat dengan mundur dari `anchor`, maksimum
 * `MAX_LOOKBACK_CODE_POINTS` code point.
 */
function startForAnchor(codePoints: readonly string[], anchor: number): number {
  const atAnchor = codePoints[anchor] ?? '';
  let limit = Math.max(0, anchor - MAX_LOOKBACK_CODE_POINTS);

  if (isKanjiCodePoint(atAnchor)) {
    while (limit < anchor && isKanjiCodePoint(codePoints[anchor - 1] ?? '')) {
      anchor -= 1;
    }
    return Math.max(anchor, limit);
  }

  // Kana (atau karakter non-Jepang): mundur selama kana/latin serupa.
  let start = anchor;
  while (start > limit && isSameScript(codePoints[start - 1] ?? '', atAnchor)) {
    start -= 1;
  }
  // Ikut sertakan rangkaian kanji tepat sebelum kana (dasar kata kerja/adjektiva).
  if (isKana(atAnchor) && start > 0 && isKanjiCodePoint(codePoints[start - 1] ?? '')) {
    while (start > limit && isKanjiCodePoint(codePoints[start - 1] ?? '')) {
      start -= 1;
    }
  }
  return start;
}

function isSameScript(candidate: string, reference: string): boolean {
  if (!isWordCodePoint(candidate)) {
    return false;
  }
  if (isKana(reference)) {
    return isKana(candidate);
  }
  if (isKanjiCodePoint(reference)) {
    return isKanjiCodePoint(candidate);
  }
  // Latin/digit: perlakukan sebagai satu kelas.
  return !isJapaneseCodePoint(reference) && !isJapaneseCodePoint(candidate);
}

/**
 * Kandidat kata untuk posisi kursor pada sebuah text node.
 * Kursor tepat setelah karakter terakhir masih dianggap berada di dalam kata itu.
 */
export function candidateFromText(
  text: string,
  caretCodePointOffset: number,
  maxCandidateCodePoints = MAX_CANDIDATE_CODE_POINTS,
): ScanCandidate | null {
  const codePoints = toCodePoints(text);
  if (codePoints.length === 0) {
    return null;
  }
  const caret = Math.min(Math.max(caretCodePointOffset, 0), codePoints.length);

  let anchor = -1;
  if (caret < codePoints.length && isWordCodePoint(codePoints[caret] ?? '')) {
    anchor = caret;
  } else if (caret > 0 && isWordCodePoint(codePoints[caret - 1] ?? '')) {
    anchor = caret - 1;
  }
  if (anchor === -1) {
    return null;
  }

  const start = startForAnchor(codePoints, anchor);

  let end = start;
  while (end < codePoints.length && end - start < maxCandidateCodePoints) {
    if (!isWordCodePoint(codePoints[end] ?? '')) {
      break;
    }
    end += 1;
  }
  if (end === start) {
    return null;
  }

  return {
    query: codePoints.slice(start, end).join(''),
    segment: segmentAround(codePoints, anchor, start, end),
    start,
    end,
    caretOffset: Math.min(Math.max(anchor - start, 0), end - start - 1),
  };
}

/** Panjang maksimum teks kueri yang ditampilkan (code point). */
const MAX_SEGMENT_CODE_POINTS = 12;

/** Panjang maksimum rentetan kana yang masih dianggap okurigana dasar kata. */
const MAX_OKURIGANA_CODE_POINTS = 4;

/**
 * Segmen kelas karakter di sekitar kursor untuk **ditampilkan** sebagai kata yang dicari.
 *
 * Kandidat lookup sengaja dibiarkan lebar (termasuk kanji sebelum kana, untuk dasar kata
 * kerja seperti `食べる`), tetapi menampilkan seluruh rangkaian tanpa spasi sebagai "kata
 * yang dicari" menyesatkan — pesan "tidak ada hasil" lalu memuat satu kalimat penuh.
 * Hachidori menampilkan teks pindai dari kursor (`scanLength` code point); segmen kelas
 * ini setara untuk tampilan: `陸上部だったので髪型は…` dengan kursor di `だった`
 * menghasilkan `だったので`, bukan satu kalimat.
 */
function segmentAround(
  codePoints: readonly string[],
  anchor: number,
  candidateStart: number,
  candidateEnd: number,
): string {
  const anchorClass = characterClass(codePoints[anchor] ?? '');
  const sameClass = (codePoint: string | undefined): boolean =>
    codePoint !== undefined && characterClass(codePoint) === anchorClass;

  let start = anchor;
  while (start > candidateStart && sameClass(codePoints[start - 1])) {
    start -= 1;
  }
  let end = anchor + 1;
  while (end < candidateEnd && sameClass(codePoints[end])) {
    end += 1;
  }
  // Dasar kata: sertakan kanji tepat sebelum kana bila rentetan kananya masih sepanjang
  // okurigana (`食べる`), bukan seluruh kata sebelumnya (`陸上部` + `だったので`).
  if (anchorClass === 'hiragana' && end - start <= MAX_OKURIGANA_CODE_POINTS) {
    while (start > candidateStart && characterClass(codePoints[start - 1] ?? '') === 'kanji') {
      start -= 1;
    }
  }
  if (end - start > MAX_SEGMENT_CODE_POINTS) {
    // Terlalu panjang: pusatkan pada kursor agar tetap terbaca.
    const half = Math.floor(MAX_SEGMENT_CODE_POINTS / 2);
    start = Math.max(start, anchor - half);
    end = Math.min(end, start + MAX_SEGMENT_CODE_POINTS);
  }
  return codePoints.slice(start, end).join('');
}

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"]';
const IGNORED_SELECTOR = 'script, style, noscript, svg, canvas, video, audio, iframe';

/** Benar bila node/elemen di posisi pointer boleh dipindai (PRD 4.1 kondisi khusus). */
export function isEligibleElement(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  if (element.closest(EDITABLE_SELECTOR) !== null) {
    return false;
  }
  if (element.closest(IGNORED_SELECTOR) !== null) {
    return false;
  }
  const view = element.ownerDocument.defaultView;
  if (view !== null) {
    const style = view.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') {
      return false;
    }
  }
  return true;
}

/**
 * Benar bila sebuah node berada di dalam elemen hasil hit-test, menembus batas shadow DOM.
 *
 * Dipakai untuk menolak teks internal kontrol formulir: `caretPositionFromPoint` dapat
 * mengembalikan text node di dalam shadow DOM bawaan `<input>`/`<textarea>`, sementara
 * `elementFromPoint` mengembalikan elemen `<input>`-nya. Tanpa pemeriksaan ini, nilai
 * input dapat ikut dipindai (dilarang oleh PRD 4.1).
 */
export function isNodeWithinElement(node: Node, element: Element): boolean {
  let current: Node | null = node;
  while (current !== null) {
    if (current === element) {
      return true;
    }
    if (current.parentNode !== null) {
      current = current.parentNode;
      continue;
    }
    const root: Node = typeof current.getRootNode === 'function' ? current.getRootNode() : current;
    current = 'host' in root ? (root as ShadowRoot).host : null;
  }
  return false;
}

/** Elemen induk dari node (elemen atau parent-nya bila node adalah text node). */
export function elementFromNode(node: Node | null): Element | null {
  if (node === null) {
    return null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return node as Element;
  }
  return node.parentElement;
}
