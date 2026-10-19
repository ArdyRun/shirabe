/**
 * Penentuan kandidat kata dari posisi pointer (PRD 4.1, 6.3 langkah 1–4).
 *
 * Aturan awal kandidat: **mulai dari karakter di bawah kursor, lalu maju**. Tidak ada
 * karakter sebelum kursor yang ikut dipindai, sehingga menyapu `んだ` di dalam `呼んだ`
 * memindai `んだ` — bukan `呼んだ`. Ini perilaku yang sama dengan Hachidori
 * (`content.js`: `alignToCharacter` menggeser caret ke karakter di bawah pointer, lalu
 * `collectScanEntries` berjalan maju saja) dan Yomitan (untuk bahasa tanpa spasi offset
 * awal tidak digeser ke awal kata). Konsekuensinya, pemindaian dimulai dari karakter
 * pertama kata: kursor di tengah kata majemuk (`日本語`) hanya memindai sisanya.
 *
 * Content script hanya mengirim kueri (kandidat kata) ke service worker; teks halaman di
 * sekitar kursor tidak pernah dikirim atau disimpan.
 *
 * Batas kata bahasa Jepang tidak dapat ditentukan tanpa parser (PRD 13), jadi kandidat
 * dibatasi dengan dua cara: mulai dari karakter di bawah kursor, lalu maju selama masih
 * karakter kata sampai batas 32 code point. Search core mencoba prefix terpanjang dari
 * titik awal itu, sehingga bentuk yang lebih pendek tetap mendapat kesempatan dicocokkan.
 */

import {
  MAX_CANDIDATE_CODE_POINTS,
  characterClass,
  isWordCodePoint,
  toCodePoints,
} from '../core/text.js';

export interface ScanCandidate {
  /** Kandidat kueri: rentetan karakter kata, maksimum 32 code point. */
  query: string;
  /**
   * Segmen kelas karakter di sekitar kursor (kanji/kana/katakana), maksimum
   * {@link MAX_SEGMENT_CODE_POINTS} code point.
   *
   * Dipakai UI sebagai teks kueri yang ditampilkan: kandidat lookup dibiarkan maju sampai
   * 32 code point (kata majemuk panjang), tetapi menampilkan seluruh rangkaian tanpa spasi
   * sebagai "kata yang dicari" menyesatkan — pesan "tidak ada hasil" lalu memuat satu
   * kalimat penuh. Hachidori menampilkan teks pindai (`scanLength` code point); segmen
   * kelas ini adalah bentuk setaranya untuk tampilan.
   */
  segment: string;
  /** Indeks awal kandidat dalam text node, satuan code point. */
  start: number;
  /** Indeks akhir (eksklusif) kandidat dalam text node. */
  end: number;
  /** Posisi kursor relatif terhadap awal kandidat, satuan code point. */
  caretOffset: number;
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

  // Kandidat dimulai dari karakter di bawah kursor lalu maju; tidak ada karakter sebelum
  // kursor yang ikut dipindai (lihat catatan modul).
  const start = anchor;

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
    segment: segmentAround(codePoints, anchor, end),
    start,
    end,
    caretOffset: Math.min(Math.max(anchor - start, 0), end - start - 1),
  };
}

/** Panjang maksimum teks kueri yang ditampilkan (code point). */
const MAX_SEGMENT_CODE_POINTS = 12;

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
  candidateEnd: number,
): string {
  const anchorClass = characterClass(codePoints[anchor] ?? '');
  const sameClass = (codePoint: string | undefined): boolean =>
    codePoint !== undefined && characterClass(codePoint) === anchorClass;

  let start = anchor;
  let end = anchor + 1;
  while (end < candidateEnd && sameClass(codePoints[end])) {
    end += 1;
  }
  if (end - start > MAX_SEGMENT_CODE_POINTS) {
    // Terlalu panjang: mulai dari kursor agar teks yang ditampilkan tetap terbaca.
    end = start + MAX_SEGMENT_CODE_POINTS;
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
