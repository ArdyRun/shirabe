/**
 * Pitch accent sebagai graf kontur (pola Yomitan/Hachidori).
 *
 * Data kamus hanya menyediakan *posisi downstep* per mora (`pitches[].position`), jadi
 * tinggi/rendah tiap mora dihitung di sini. Dua fungsi intinya disalin dari perilaku
 * Yomitan (`ext/js/language/ja/japanese.js` dan `ext/js/display/pronunciation-generator.js`,
 * implementasi yang sama juga dipakai Hachidori di `render/glossary.js`):
 *
 * - `isMoraPitchHigh(index, positions)`: posisi 0 (heiban) tinggi kecuali mora pertama,
 *   posisi 1 (atamadaka) hanya mora pertama, dan posisi n tinggi di mora 1..n-1.
 * - Graf SVG: satu titik per mora pada dua tingkat (tinggi/rendah), titik bercincin di
 *   mora downstep, garis penghubung, lalu segitiga dan garis putus-putus untuk partikel
 *   yang mengikuti (indeks mora ke-`n`).
 *
 * `viewBox` 0 0 50·(n+1) 100 dan koordinat 25/75 dipertahankan supaya bentuk grafnya sama
 * dengan acuan, sedangkan warna digambar dengan `currentColor` agar ikut tema Shirabe.
 */

/** Kana kecil yang menempel pada mora sebelumnya (daftar Yomitan). */
const SMALL_KANA = 'ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ';

/** Kategori aksen menurut posisi downstep (pola Yomitan `getPitchCategory`). */
export type PitchCategory = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka';

/**
 * Pecah bacaan menjadi mora: kana kecil bergabung dengan mora sebelumnya, sedangkan
 * `っ`, `ん`, dan `ー` berdiri sendiri.
 */
export function pitchMorae(reading: string): string[] {
  const morae: string[] = [];
  for (const character of reading) {
    if (SMALL_KANA.includes(character) && morae.length > 0) {
      morae[morae.length - 1] += character;
      continue;
    }
    morae.push(character);
  }
  return morae;
}

/**
 * Benar bila mora ke-`moraIndex` bertekanan tinggi.
 *
 * `moraIndex` boleh sebesar jumlah mora: itu posisi partikel yang mengikuti kata, yang
 * menentukan segitiga dan garis putus-putus di ujung graf.
 */
export function isMoraPitchHigh(moraIndex: number, positions: number): boolean {
  if (positions === 0) {
    return moraIndex > 0;
  }
  if (positions === 1) {
    return moraIndex < 1;
  }
  return moraIndex > 0 && moraIndex < positions;
}

/** Kategori aksen dari posisi downstep dan jumlah mora. */
export function pitchCategory(reading: string, positions: number): PitchCategory {
  if (positions === 0) {
    return 'heiban';
  }
  if (positions === 1) {
    return 'atamadaka';
  }
  return positions >= pitchMorae(reading).length ? 'odaka' : 'nakadaka';
}

/**
 * Bacaan dengan garis kontur nada (gaya teks Yomitan/Hachidori).
 *
 * Tiap mora menjadi satu elemen: mora bernada tinggi memakai garis di atas, mora rendah
 * garis di bawah, dan mora tempat nada berubah diberi penanda `data-pitch-transition`
 * supaya CSS dapat menggambar sambungan naik/turun (tangga). Bila kata berakhir pada
 * nada tinggi (odaka), satu penanda ujung ditambahkan supaya turunnya nada setelah kata
 * tetap terlihat walau partikelnya tidak ikut ditampilkan.
 *
 * Penanda mora tanpa suara (`data-devoice`) dan nasal (`data-nasal`) dititipkan ke mora
 * yang bersangkutan; penampakannya diatur CSS.
 */
export function pitchReading(
  morae: readonly string[],
  positions: number,
  devoice: readonly number[] = [],
  nasal: readonly number[] = [],
): HTMLSpanElement {
  const container = document.createElement('span');
  container.className = 'pitch-reading';
  container.dataset['pitchPosition'] = String(positions);
  if (morae.length === 0) {
    return container;
  }
  const marks = pitchMarks(morae.length, devoice, nasal);

  let previous = isMoraPitchHigh(0, positions);
  for (const [index, mora] of morae.entries()) {
    const high = isMoraPitchHigh(index, positions);
    const element = document.createElement('span');
    element.className = 'pitch-reading__mora';
    element.dataset['pitchLevel'] = high ? 'high' : 'low';
    if (index > 0 && high !== previous) {
      element.dataset['pitchTransition'] = high ? 'up' : 'down';
    }
    element.textContent = mora;
    if (marks.devoice.includes(index + 1)) {
      const indicator = document.createElement('span');
      indicator.className = 'pitch-reading__devoice';
      element.append(indicator);
    }
    if (marks.nasal.includes(index + 1)) {
      const indicator = document.createElement('span');
      indicator.className = 'pitch-reading__nasal';
      element.append(indicator);
    }
    container.append(element);
    previous = high;
  }

  if (isMoraPitchHigh(morae.length, positions) !== previous) {
    const tail = document.createElement('span');
    tail.className = 'pitch-reading__tail';
    tail.dataset['pitchTail'] = isMoraPitchHigh(morae.length, positions) ? 'up' : 'down';
    container.append(tail);
  }
  return container;
}

/** Tanda mora tanpa suara dan nasal, dipakai sebagai keterangan (graf tidak menampilkannya). */
export function pitchMarks(moraCount: number, devoice: readonly number[], nasal: readonly number[]): {
  devoice: number[];
  nasal: number[];
} {
  const withinRange = (positions: readonly number[]): number[] =>
    positions.filter((position) => Number.isInteger(position) && position >= 1 && position <= moraCount);
  return { devoice: withinRange(devoice), nasal: withinRange(nasal) };
}
