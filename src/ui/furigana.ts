/**
 * Penyusunan furigana dari `expression` + `reading` sebuah entri (tampilan saja).
 *
 * Data kamus Shirabe hanya menyediakan satu bacaan untuk seluruh kata, bukan bacaan per
 * aksara. Untuk menampilkan furigana di atas kanji, fungsi ini menyelaraskan bacaan kana
 * dengan aksara kanji pada kata:
 *
 *   alignFurigana('食べる', 'たべる')
 *     → [{ text: '食', ruby: 'た' }, { text: 'べる' }]
 *
 * Aturan: kana pada expression harus muncul berurutan pada reading (menjadi jangkar).
 * Bila bacaan tidak dapat diselaraskan (mis. bacaan memuat kanji, atau okurigana tidak
 * cocok seperti 食べる/たべます), hasilnya `null` dan pemanggil menampilkan bacaan sebagai
 * baris terpisah — bukan furigana yang salah.
 */

export interface FuriganaSegment {
  /** Teks yang ditampilkan (kanji atau kana). */
  text: string;
  /** Bacaan untuk segmen ini; hanya ada pada segmen kanji. */
  ruby?: string;
}

/** Rentetan aksara yang dianggap kanji untuk keperluan penyelarasan. */
const KANJI_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3005]/u;

/** Hiragana/katakana/okurigana yang menjadi jangkar penyelarasan. */
const KANA_PATTERN = /[\u3041-\u309F\u30A0-\u30FFー]/u;

export function hasKanji(text: string): boolean {
  return KANJI_PATTERN.test(text);
}

/** Pecah teks menjadi rentetan kanji dan rentetan kana. */
function runs(text: string): { kanji: boolean; text: string }[] {
  const result: { kanji: boolean; text: string }[] = [];
  for (const character of text) {
    const kanji = KANJI_PATTERN.test(character);
    const last = result.at(-1);
    if (last !== undefined && last.kanji === kanji) {
      last.text += character;
    } else {
      result.push({ kanji, text: character });
    }
  }
  return result;
}

/**
 * Selaraskan bacaan dengan ekspresi; `null` bila furigana tidak dapat ditentukan dengan
 * aman.
 */
export function alignFurigana(expression: string, reading: string): FuriganaSegment[] | null {
  if (expression.length === 0 || reading.length === 0) {
    return null;
  }
  // Tanpa kanji pada expression tidak ada yang perlu diberi furigana; bacaan yang memuat
  // kanji juga tidak bisa dipakai sebagai furigana.
  if (expression === reading || !hasKanji(expression) || hasKanji(reading)) {
    return null;
  }
  if (!KANA_PATTERN.test(reading)) {
    return null;
  }

  const expressionRuns = runs(expression);
  const segments: FuriganaSegment[] = [];
  let readingIndex = 0;

  for (let index = 0; index < expressionRuns.length; index += 1) {
    const run = expressionRuns[index];
    if (run === undefined) {
      return null;
    }
    if (!run.kanji) {
      // Kana pada expression harus sama dengan bacaan pada posisi yang sama.
      if (reading.slice(readingIndex, readingIndex + run.text.length) !== run.text) {
        return null;
      }
      segments.push({ text: run.text });
      readingIndex += run.text.length;
      continue;
    }

    const next = expressionRuns[index + 1];
    if (next === undefined || next.kanji) {
      // Kanji terakhir (atau kanji berurutan): sisanya menjadi bacaan segmen ini.
      const rest = reading.slice(readingIndex);
      if (rest.length === 0) {
        return null;
      }
      segments.push({ text: run.text, ruby: rest });
      readingIndex = reading.length;
      continue;
    }

    // Kanji diikuti kana: cari kana tersebut pada bacaan sebagai batas bacaan kanji.
    const boundary = reading.indexOf(next.text, readingIndex + 1);
    if (boundary <= readingIndex) {
      return null;
    }
    segments.push({ text: run.text, ruby: reading.slice(readingIndex, boundary) });
    readingIndex = boundary;
  }

  if (readingIndex !== reading.length) {
    return null;
  }
  return segments;
}
