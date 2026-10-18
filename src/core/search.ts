/**
 * Search core: normalisasi, exact lookup, pencarian reading, deinflection, dan ranking.
 *
 * Modul ini tidak mengetahui DOM, `chrome.*`, maupun IndexedDB: sumber data
 * disuntikkan lewat `LookupSource` (PRD 6.1 "Core murni agar dapat diuji tanpa browser").
 */

import { deinflect } from './deinflect.js';
import { IMPORT_LIMITS } from './limits.js';
import {
  MAX_CANDIDATE_CODE_POINTS,
  characterClass,
  isKanaOnly,
  normalizeQuery,
  toCodePoints,
} from './text.js';
import type {
  DictionaryEntry,
  KanjiMatch,
  LookupMatch,
  LookupOptions,
  LookupResult,
  LookupSource,
  MatchType,
  MetaMatch,
} from './types.js';

/** Batas hasil default per kueri (PRD 4.2). */
export const DEFAULT_MAX_RESULTS = 30;

/**
 * Jumlah titik awal kandidat maksimum saat posisi kursor diketahui.
 *
 * Teks Jepang tidak memakai spasi, sehingga batas kata tidak dapat ditentukan tanpa
 * parser (PRD 13). Content script mengirim posisi kursor, dan search core mencoba
 * kandidat dari beberapa titik awal di sekitar kursor, lalu memilih kandidat
 * terpanjang yang benar-benar mencakup posisi kursor.
 */
export const MAX_CANDIDATE_STARTS = 8;
/** Jumlah maksimum kueri jendela yang dideinfleksi per lookup (batas biaya CPU). */
const MAX_DEINFLECTION_WINDOWS = 8;
/** Jumlah maksimum jendela kandidat per titik awal (mencegah kandidat pendek kalah). */
const MAX_WINDOWS_PER_START = 8;
/** Jumlah panjang terpendek yang selalu diuji per titik awal (kata pendek). */
const MAX_SHORT_WINDOWS = 4;
/** Jumlah maksimum jendela yang berakhir di batas kelas per titik awal. */
const MAX_BOUNDARY_ENDS = 2;

/**
 * Batas jumlah kandidat yang dicoba per lookup.
 *
 * Hachidori membangun lattice kandidat di engine C++ lalu mengurutkannya longest-first;
 * di sini anggaran eksplisit dipakai supaya jumlah pembacaan index tetap terbatas pada
 * teks Jepang panjang tanpa spasi (setiap kandidat = satu pembacaan index).
 */
export const MAX_CANDIDATE_LOOKUPS = 48;

/** Prioritas dataset (mis. `score` Yomitan); entry tanpa prioritas dianggap 0. */
function priorityOf(entry: DictionaryEntry): number {
  return typeof entry.priority === 'number' && Number.isFinite(entry.priority) ? entry.priority : 0;
}

/** Urutan prioritas jenis kecocokan: exact didahulukan (PRD 4.4). */
const MATCH_TYPE_RANK: Record<MatchType, number> = {
  exact: 0,
  reading: 1,
  deinflected: 2,
};

/**
 * Tag POS yang dipakai untuk memvalidasi hasil deinflection.
 * `rules` (tag aturan format dataset) diutamakan, lalu `partOfSpeech`.
 */
function posTags(entry: DictionaryEntry): string[] {
  return entry.rules.length > 0 ? entry.rules : entry.partOfSpeech;
}

/**
 * Benar bila tag kelas kata entry cocok dengan tag yang diharapkan rule.
 *
 * Selain kecocokan persis, tag grup juga diterima bila salah satunya adalah prefix
 * yang lain: dataset seperti JMdict menandai aturan godan sebagai `v5`, sedangkan
 * rule Shirabe bekerja per baris (`v5k`, `v5u`, …); sebaliknya `v5k-s` (行く) adalah
 * subtipe dari `v5k`. Prefix pendek (< 2 karakter) tidak dianggap cocok.
 */
export function posTagMatches(tag: string, expected: string): boolean {
  if (tag === expected) {
    return true;
  }
  const shorter = tag.length <= expected.length ? tag : expected;
  const longer = tag.length <= expected.length ? expected : tag;
  return shorter.length >= 2 && longer.startsWith(shorter);
}

function posVerified(entry: DictionaryEntry, expected: string[]): boolean {
  if (expected.length === 0) {
    return false;
  }
  const tags = posTags(entry);
  return tags.some((tag) => expected.some((expectedTag) => posTagMatches(tag, expectedTag)));
}

function posCompatible(entry: DictionaryEntry, expected: string[]): boolean {
  // Entry tanpa tag kelas kata tidak dapat diverifikasi terhadap rule: diterima,
  // tetapi ditandai dan diurutkan di bawah hasil yang terverifikasi.
  return posVerified(entry, expected) || posTags(entry).length === 0;
}

/** Urutkan + deduplikasi hasil sesuai prioritas kamus dan panjang kecocokan. */
export function rankMatches(matches: LookupMatch[], maxResults: number): {
  matches: LookupMatch[];
  truncated: boolean;
} {
  const deduped = new Map<string, LookupMatch>();
  for (const match of matches) {
    const key = `${match.entry.dictionaryId}\u0000${match.entry.entryId}`;
    const existing = deduped.get(key);
    if (existing === undefined || existing.matchLength < match.matchLength) {
      deduped.set(key, match);
    }
  }
  // Urutan (PRD 4.2): prioritas kamus aktif → panjang kecocokan → jenis kecocokan →
  // POS terverifikasi → prioritas entry → id. Panjang didahulukan atas jenis kecocokan
  // karena seluruh jendela kandidat kini dikumpulkan: bentuk infleksi yang lebih panjang
  // (`食べました` → `食べる`) harus tetap mengalahkan kecocokan exact satu karakter (`食`).
  const sorted = [...deduped.values()].sort(
    (a, b) =>
      a.entry.dictionaryOrder - b.entry.dictionaryOrder ||
      b.matchLength - a.matchLength ||
      MATCH_TYPE_RANK[a.matchType] - MATCH_TYPE_RANK[b.matchType] ||
      Number(b.partOfSpeechVerified) - Number(a.partOfSpeechVerified) ||
      priorityOf(b.entry) - priorityOf(a.entry) ||
      a.entry.entryId.localeCompare(b.entry.entryId),
  );
  return {
    matches: sorted.slice(0, maxResults),
    truncated: sorted.length > maxResults,
  };
}

/** Enumerasi kandidat prefix (terpanjang dahulu) dari awal kueri. */
export function candidatePrefixes(query: string, maxCodePoints: number): string[] {
  return candidateWindows(query, maxCodePoints, null).map((window) => window.text);
}

export interface CandidateWindow {
  text: string;
  /** Indeks awal jendela pada kueri (code point). */
  start: number;
  /** Indeks akhir eksklusif jendela pada kueri (code point). */
  end: number;
}

/**
 * Titik awal kandidat: setiap posisi mulai dari kursor mundur sampai awal kueri,
 * dibatasi {@link MAX_CANDIDATE_STARTS} posisi terdekat kursor.
 */
function candidateStarts(codePoints: readonly string[], caretOffset: number): number[] {
  const starts: number[] = [];
  const maxStart = Math.min(caretOffset, codePoints.length - 1);
  for (let index = maxStart; index >= 0 && starts.length < MAX_CANDIDATE_STARTS; index -= 1) {
    starts.push(index);
  }
  return starts;
}

/**
 * Enumerasi kandidat lookup.
 *
 * Tanpa `caretOffset` (pencarian manual), hanya prefix dari awal kueri yang dihasilkan,
 * terpanjang dahulu — perilaku yang sama seperti sebelumnya.
 *
 * Dengan `caretOffset` (hover), kandidat dihasilkan dari beberapa titik awal di sekitar
 * kursor (paling dekat kursor lebih dahulu). Untuk setiap titik awal:
 *
 * 1. **jendela pendek** di sekitar panjang minimum ({@link MAX_SHORT_WINDOWS} panjang) —
 *    kata pendek di dalam rentetan panjang: `がな` di dalam `がなんでそんなことを`,
 *    `だった` di dalam `だったので`;
 * 2. **jendela yang berakhir di batas kelas karakter** terdekat (`characterClass`) —
 *    kata majemuk lintas segmen: `食べました`, `髪型は`;
 * 3. **jendela terpanjang** — entri panjang yang membentang sampai akhir jendela teks.
 *
 * Jendela diambil bergilir antar titik awal, jadi setiap hipotesis awal kata tetap
 * terwakili dan kandidat pendek tidak kalah oleh kandidat panjang (masalah yang membuat
 * `がな`/`だった` tidak pernah diuji).
 */
export function candidateWindows(
  query: string,
  maxCodePoints: number,
  caretOffset: number | null,
): CandidateWindow[] {
  const codePoints = toCodePoints(query);
  if (codePoints.length === 0) {
    return [];
  }
  if (caretOffset === null) {
    const available = Math.min(codePoints.length, maxCodePoints);
    const prefixes: CandidateWindow[] = [];
    for (let length = available; length >= 1; length -= 1) {
      prefixes.push({ text: codePoints.slice(0, length).join(''), start: 0, end: length });
    }
    return prefixes.slice(0, MAX_CANDIDATE_LOOKUPS);
  }

  const perStart: CandidateWindow[][] = [];
  for (const start of candidateStarts(codePoints, caretOffset)) {
    const available = Math.min(codePoints.length - start, maxCodePoints);
    const minLength = Math.max(1, caretOffset - start + 1);
    const limit = start + available;
    const ends: number[] = [];
    // (1) Kata pendek: panjang minimum dan beberapa panjang setelahnya.
    for (let index = 0; index < MAX_SHORT_WINDOWS; index += 1) {
      ends.push(start + minLength + index);
    }
    // (2) Batas kelas karakter terdekat setelah kursor.
    let boundaries = 0;
    for (let index = start + minLength; index < limit && boundaries < MAX_BOUNDARY_ENDS; index += 1) {
      const previous = characterClass(codePoints[index - 1] ?? '');
      const current = characterClass(codePoints[index] ?? '');
      if (previous !== current) {
        ends.push(index + 1);
        boundaries += 1;
      }
    }
    // (3) Jendela terpanjang.
    ends.push(limit);

    perStart.push(
      [...new Set(ends)]
        .filter((end) => end - start >= minLength && end <= limit)
        .sort((a, b) => a - b)
        .slice(0, MAX_WINDOWS_PER_START)
        .map((end) => ({ text: codePoints.slice(start, end).join(''), start, end })),
    );
  }

  // Bergilir antar titik awal: hipotesis pertama setiap titik awal (jendela terpendek)
  // selalu ikut, sisanya sampai kuota total.
  const selected: CandidateWindow[] = [];
  for (let round = 0; selected.length < MAX_CANDIDATE_LOOKUPS; round += 1) {
    let added = false;
    for (const windows of perStart) {
      const window = windows[round];
      if (window === undefined) {
        continue;
      }
      selected.push(window);
      added = true;
      if (selected.length >= MAX_CANDIDATE_LOOKUPS) {
        break;
      }
    }
    if (!added) {
      break;
    }
  }

  // Kandidat terpanjang lebih dahulu, lalu yang paling dekat kursor (seperti sebelumnya).
  selected.sort((a, b) => b.end - b.start - (a.end - a.start) || b.start - a.start);
  return selected;
}


function toMatch(
  entry: DictionaryEntry,
  matchType: MatchType,
  matchedText: string,
  matchLength: number,
  steps: LookupMatch['steps'],
  verified: boolean,
): LookupMatch {
  return {
    entry,
    matchType,
    matchedText,
    matchLength,
    steps,
    partOfSpeechVerified: verified,
  };
}

function emptyResult(query: string, status: LookupResult['status'], inputTruncated: boolean): LookupResult {
  return {
    query,
    status,
    truncated: false,
    inputTruncated,
    matches: [],
    meta: [],
    kanji: [],
    span: null,
  };
}

/**
 * Nilai meta (pitch/frekuensi) untuk istilah yang cocok.
 *
 * Kamus pitch/frekuensi tidak punya term bank: nilainya tersimpan terpisah dan
 * digabungkan ke kartu entri yang ekspresi + bacaannya sama. Satu kueri per pasangan
 * unik supaya kamus 600 ribu istilah tidak dibaca berkali-kali.
 */
async function collectMeta(
  matches: readonly LookupMatch[],
  source: LookupSource,
): Promise<MetaMatch[]> {
  const seen = new Set<string>();
  const result: MetaMatch[] = [];
  for (const match of matches) {
    const expressionNfc = normalizeQuery(match.entry.expression);
    const readingNfc = normalizeQuery(match.entry.reading);
    const key = `${expressionNfc}\u0000${readingNfc}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    for (const meta of await source.findMeta(expressionNfc, readingNfc)) {
      if (result.length >= IMPORT_LIMITS.maxMetaPerLookup) {
        return result;
      }
      result.push(meta);
    }
  }
  return result;
}

/**
 * Data kanji untuk karakter pada kueri (dipakai lookup dari klik kanji).
 *
 * Kueri dipecah per code point, jadi kanji di luar BMP (mis. 𠮟) tetap terbaca.
 */
async function collectKanji(query: string, source: LookupSource): Promise<KanjiMatch[]> {
  const characters: string[] = [];
  for (const character of query) {
    if (characterClass(character) !== 'kanji' || characters.includes(character)) {
      continue;
    }
    characters.push(character);
    if (characters.length >= IMPORT_LIMITS.maxKanjiPerLookup) {
      break;
    }
  }
  const result: KanjiMatch[] = [];
  for (const character of characters) {
    result.push(...(await source.findKanji(character)));
  }
  return result;
}

/**
 * Lookup utama.
 *
 * Semua jendela kandidat diuji dan seluruh kecocokannya dikumpulkan (bukan berhenti pada
 * jendela pertama yang cocok), lalu dipadatkan serta diperingkat oleh `rankMatches`.
 * Untuk setiap jendela: exact match (expression, lalu reading bila kueri kana) dan —
 * dibatasi {@link MAX_DEINFLECTION_WINDOWS} kueri per lookup — deinflection supaya
 * bentuk infleksi seperti `食べました` tetap menemukan `食べる`.
 */
export async function lookup(
  query: string,
  source: LookupSource,
  options: LookupOptions = {},
): Promise<LookupResult> {
  const maxCandidate = options.maxCandidateCodePoints ?? MAX_CANDIDATE_CODE_POINTS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const readingSearch = options.readingSearch ?? true;
  const deinflectionEnabled = options.deinflection ?? true;

  const normalized = normalizeQuery(query);
  const codePoints = toCodePoints(normalized);
  if (codePoints.length === 0 || normalized.trim().length === 0) {
    return emptyResult(normalized, 'empty-query', false);
  }
  const inputTruncated = codePoints.length > maxCandidate;
  const caretOffset = options.caretOffset ?? null;
  const windows = candidateWindows(normalized, maxCandidate, caretOffset);
  const kanaQuery = readingSearch && isKanaOnly(normalized);

  /** Cache hasil lookup lema per pemanggilan, agar satu lema hanya dibaca sekali. */
  const lemmaCache = new Map<string, DictionaryEntry[]>();
  const cachedExpression = async (text: string): Promise<DictionaryEntry[]> => {
    const cached = lemmaCache.get(`e:${text}`);
    if (cached !== undefined) {
      return cached;
    }
    const entries = await source.findExactExpression(text);
    lemmaCache.set(`e:${text}`, entries);
    return entries;
  };
  const cachedReading = async (text: string): Promise<DictionaryEntry[]> => {
    const cached = lemmaCache.get(`r:${text}`);
    if (cached !== undefined) {
      return cached;
    }
    const entries = await source.findExactReading(text);
    lemmaCache.set(`r:${text}`, entries);
    return entries;
  };

  const deinflectionMatches = async (
    text: string,
    matchLength: number,
  ): Promise<LookupMatch[]> => {
    const matches: LookupMatch[] = [];
    for (const analysis of deinflect(text)) {
      const byExpression = await cachedExpression(analysis.lemma);
      for (const entry of byExpression) {
        if (posCompatible(entry, analysis.partOfSpeech)) {
          matches.push(
            toMatch(
              entry,
              'deinflected',
              text,
              matchLength,
              analysis.steps,
              posVerified(entry, analysis.partOfSpeech),
            ),
          );
        }
      }
      if (!readingSearch) {
        continue;
      }
      const byReading = await cachedReading(analysis.lemma);
      for (const entry of byReading) {
        if (posCompatible(entry, analysis.partOfSpeech)) {
          matches.push(
            toMatch(
              entry,
              'deinflected',
              text,
              matchLength,
              analysis.steps,
              posVerified(entry, analysis.partOfSpeech),
            ),
          );
        }
      }
    }
    return matches;
  };

  // Semua jendela diuji dan **seluruh** kecocokan dikumpulkan, bukan berhenti pada
  // jendela pertama yang cocok: pada `がなんでそんなことを` kursor di `がな`, jendela
  // `なんで` cocok lebih dahulu sehingga `がな` (kata yang ditunjuk pengguna) hilang.
  // Hachidori/Yomitan juga mengembalikan semua kandidat dari teks pindainya lalu
  // memeringkatkannya.
  const collected: LookupMatch[] = [];
  const windowOf = new Map<LookupMatch, CandidateWindow>();
  const remember = (match: LookupMatch, window: CandidateWindow): void => {
    collected.push(match);
    windowOf.set(match, window);
  };
  let deinflected = 0;
  for (const window of windows) {
    const matchLength = window.end - window.start;
    const exact = (await cachedExpression(window.text)).map((entry) =>
      toMatch(entry, 'exact', window.text, matchLength, [], true),
    );
    const reading = kanaQuery
      ? (await cachedReading(window.text)).map((entry) =>
          toMatch(entry, 'reading', window.text, matchLength, [], true),
        )
      : [];
    if (exact.length > 0 || reading.length > 0) {
      for (const match of [...exact, ...reading]) {
        remember(match, window);
      }
      // Deinflection melengkapi bentuk infleksi dari kueri yang sama (mis. 食べました).
      if (deinflectionEnabled && deinflected < MAX_DEINFLECTION_WINDOWS) {
        deinflected += 1;
        for (const match of await deinflectionMatches(window.text, matchLength)) {
          remember(match, window);
        }
      }
      continue;
    }
    if (deinflectionEnabled && deinflected < MAX_DEINFLECTION_WINDOWS) {
      deinflected += 1;
      for (const match of await deinflectionMatches(window.text, matchLength)) {
        remember(match, window);
      }
    }
  }

  if (collected.length > 0) {
    const ranked = rankMatches(collected, maxResults);
    const best = windowOf.get(ranked.matches[0] as LookupMatch) ?? windows[0];
    return {
      query: normalized,
      status: 'ok',
      truncated: ranked.truncated,
      inputTruncated,
      matches: ranked.matches,
      meta: await collectMeta(ranked.matches, source),
      kanji: options.kanji === true ? await collectKanji(normalized, source) : [],
      span: best === undefined ? { start: 0, end: 0 } : { start: best.start, end: best.end },
    };
  }

  // Tidak ada istilah yang cocok: klik kanji tetap boleh menampilkan data kanjinya.
  const kanji = options.kanji === true ? await collectKanji(normalized, source) : [];
  if (kanji.length > 0) {
    return { ...emptyResult(normalized, 'ok', inputTruncated), kanji };
  }

  return emptyResult(normalized, 'empty', inputTruncated);
}
