/**
 * Tabel transformasi deinflection Shirabe (PRD 4.4, cakupan terbatas).
 *
 * Model tabel mengikuti deinflector hoshidicts (dipakai Hachidori) dan Yomitan:
 * setiap rule menyatakan `conditionsIn` (kondisi bentuk saat ini) dan `conditionsOut`
 * (kondisi bentuk hasil), sehingga transformasi dapat **dirantai**. Rantai inilah yang
 * ditampilkan di popup, mis. `聞こえてきた` → `聞こえてくる` (-た) → `聞こえて` (-くる)
 * → `聞こえる` (-て).
 *
 * Prinsip:
 * - Kondisi awal adalah seluruh kondisi (`ALL_CONDITIONS`), jadi rule mana pun boleh
 *   menjadi langkah pertama; langkah berikutnya hanya boleh bila kondisi hasil langkah
 *   sebelumnya memenuhi `conditionsIn` rule itu.
 * - Kondisi kelas kata (`v1`, `v5k`, …) berasal dari tag kamus dan dipakai untuk
 *   memvalidasi hasil (PRD 4.4 acceptance 3). Kondisi bentuk (`te`, `ta`, `masu`, …)
 *   hanya menghubungkan antar transformasi dan tidak mewakili kelas kata.
 * - `descriptionKey` adalah kunci teks deskripsi di lapisan UI (`inflect.desc.<key>`);
 *   core tetap bebas teks antarmuka.
 * - Tabel ini data biasa (bukan kode), sehingga dapat diperluas/diuji terpisah.
 *
 * Nama transformasi (`-た`, `-て`, `-くる`, …) mengikuti penamaan deinflector umum
 * (hoshidicts/Yomitan) supaya label yang tampil mengenali gramatika Jepang yang sama.
 */

/** Kondisi kelas kata (tag kamus). */
export const POS_CONDITIONS: readonly string[] = [
  'v1',
  // Tag grup yang dipakai sebagian dataset (mis. JMdict menandai godan sebagai `v5`,
  // dan いい/よい sebagai `adj-ix`).
  'v5',
  'adj-ix',
  'v5u',
  'v5k',
  'v5g',
  'v5s',
  'v5t',
  'v5n',
  'v5b',
  'v5m',
  'v5r',
  'vk',
  'vs',
  'vz',
  'adj-i',
  'adj-na',
];

/** Kondisi bentuk: dipakai untuk menyambung transformasi, bukan kelas kata kamus. */
const FORM_CONDITIONS: readonly string[] = [
  'ta',
  'te',
  'masu',
  'masen',
  'ba',
  'ya',
  'nn',
  'imp',
  'copula',
];

/** Seluruh kondisi yang diizinkan pada langkah pertama. */
export const ALL_CONDITIONS: readonly string[] = [...POS_CONDITIONS, ...FORM_CONDITIONS];

/** Kelas kata default bila entry kamus tidak memakai tag kelas kata rinci. */
const POS_GROUPS: Record<string, readonly string[]> = {
  v1: ['v1'],
  v5u: ['v5u', 'v5'],
  v5k: ['v5k', 'v5'],
  v5g: ['v5g', 'v5'],
  v5s: ['v5s', 'v5'],
  v5t: ['v5t', 'v5'],
  v5n: ['v5n', 'v5'],
  v5b: ['v5b', 'v5'],
  v5m: ['v5m', 'v5'],
  v5r: ['v5r', 'v5'],
  vk: ['vk'],
  vs: ['vs'],
  vz: ['vz'],
  'adj-i': ['adj-i', 'adj-ix'],
  'adj-na': ['adj-na'],
};

/** Nama transformasi + kunci deskripsi UI-nya. */
export interface DeinflectionTransform {
  /** Nama transformasi, sekaligus label langkah di popup (mis. `-た`). */
  id: string;
  /** Kunci deskripsi di lapisan UI: `inflect.desc.<descriptionKey>`. */
  descriptionKey: string;
}

/** Satu aturan transformasi. */
export interface DeinflectionRule {
  /** ID stabil, dipakai pada hasil dan pengujian. */
  id: string;
  /** Akhiran bentuk permukaan yang diganti. */
  from: string;
  /** Pengganti yang mengubah bentuk menjadi bentuk sebelum transformasi. */
  to: string;
  /** Transformasi (grup) yang memiliki rule ini; nama ini yang tampil di UI. */
  transform: string;
  /** Kondisi yang harus dipenuhi bentuk saat ini. */
  conditionsIn: readonly string[];
  /** Kondisi bentuk hasil; menggantikan kondisi sebelumnya. */
  conditionsOut: readonly string[];
}

interface GodanRow {
  /** Tag POS utama row. */
  pos: string;
  /** Vokal u (bentuk kamus). */
  u: string;
  /** Vokal i (dasar bentuk sopan). */
  i: string;
  /** Vokal a (dasar bentuk negatif). */
  a: string;
  /** Vokal e (dasar kondisional). */
  e: string;
  /** Vokal o (dasar volisional). */
  o: string;
  /** Akhiran bentuk te. */
  te: string;
  /** Akhiran bentuk lampau. */
  ta: string;
}

const GODAN_ROWS: readonly GodanRow[] = [
  { pos: 'v5u', u: 'う', i: 'い', a: 'わ', e: 'え', o: 'お', te: 'って', ta: 'った' },
  { pos: 'v5k', u: 'く', i: 'き', a: 'か', e: 'け', o: 'こ', te: 'いて', ta: 'いた' },
  { pos: 'v5g', u: 'ぐ', i: 'ぎ', a: 'が', e: 'げ', o: 'ご', te: 'いで', ta: 'いだ' },
  { pos: 'v5s', u: 'す', i: 'し', a: 'さ', e: 'せ', o: 'そ', te: 'して', ta: 'した' },
  { pos: 'v5t', u: 'つ', i: 'ち', a: 'た', e: 'て', o: 'と', te: 'って', ta: 'った' },
  { pos: 'v5n', u: 'ぬ', i: 'に', a: 'な', e: 'ね', o: 'の', te: 'んで', ta: 'んだ' },
  { pos: 'v5b', u: 'ぶ', i: 'び', a: 'ば', e: 'べ', o: 'ぼ', te: 'んで', ta: 'んだ' },
  { pos: 'v5m', u: 'む', i: 'み', a: 'ま', e: 'め', o: 'も', te: 'んで', ta: 'んだ' },
  { pos: 'v5r', u: 'る', i: 'り', a: 'ら', e: 'れ', o: 'ろ', te: 'って', ta: 'った' },
];

/** Spesifikasi ringkas: [transformasi, from, to, kondisi bentuk]. */
type TerminalSpec = readonly [string, string, string, string];

/** Akhiran v1 (ichidan): semua melekat pada akar, lema = akar + る. */
const V1_TAILS: readonly TerminalSpec[] = [
  ['-ませんでした', 'ませんでした', 'る', 'masen'],
  ['-ません', 'ません', 'る', 'masen'],
  ['-ました', 'ました', 'る', 'masu'],
  ['-ます', 'ます', 'る', 'masu'],
  ['-なかった', 'なかった', 'る', 'nn'],
  ['-なくて', 'なくて', 'る', 'nn'],
  ['-ない', 'ない', 'る', 'nn'],
  ['-ず', 'ず', 'る', 'nn'],
  ['-れば', 'れば', 'る', 'ba'],
  ['-よう', 'よう', 'る', 'ya'],
  ['-た', 'た', 'る', 'ta'],
  ['-て', 'て', 'る', 'te'],
  ['-ろ', 'ろ', 'る', 'imp'],
];

/**
 * Akhiran vk (kuru): batangnya tidak beraturan (き/こ), jadi tidak bisa diturunkan
 * dari akar `る` seperti v1. Bentuk lampau `きた` → `くる` penting untuk rantai
 * `聞こえてきた` → `聞こえてくる`.
 */
const VK_TAILS: readonly TerminalSpec[] = [
  ['-ませんでした', 'きませんでした', 'くる', 'masen'],
  ['-ません', 'きません', 'くる', 'masen'],
  ['-ました', 'きました', 'くる', 'masu'],
  ['-ます', 'きます', 'くる', 'masu'],
  ['-なかった', 'こなかった', 'くる', 'nn'],
  ['-なくて', 'こなくて', 'くる', 'nn'],
  ['-ない', 'こない', 'くる', 'nn'],
  ['-ず', 'こず', 'くる', 'nn'],
  ['-れば', 'くれば', 'くる', 'ba'],
  ['-よう', 'こよう', 'くる', 'ya'],
  ['-た', 'きた', 'くる', 'ta'],
  ['-て', 'きて', 'くる', 'te'],
  ['-ろ', 'こい', 'くる', 'imp'],
];

/**
 * Akhiran vk (kuru) dalam aksara kanji.
 *
 * `来る` menulis batang `き`/`こ` sebagai `来`, sehingga akhiran kana di atas tidak
 * pernah cocok (`来ます` tidak berakhir dengan `きます`). Tanpa aturan ini hanya
 * `来た`/`来て` yang terurai, dan bentuk umum seperti `来ます`/`来ない` tidak menemukan
 * lema `来る`. Aturan v1 (`ます` → `る`) menghasilkan `来る` dengan kelas kata `v1`
 * yang kemudian ditolak validasi POS terhadap entry `vk`.
 */
const VK_KANJI_TAILS: readonly TerminalSpec[] = [
  ['-ませんでした', '来ませんでした', '来る', 'masen'],
  ['-ません', '来ません', '来る', 'masen'],
  ['-ました', '来ました', '来る', 'masu'],
  ['-ます', '来ます', '来る', 'masu'],
  ['-なかった', '来なかった', '来る', 'nn'],
  ['-なくて', '来なくて', '来る', 'nn'],
  ['-ない', '来ない', '来る', 'nn'],
  ['-ず', '来ず', '来る', 'nn'],
  ['-れば', '来れば', '来る', 'ba'],
  ['-よう', '来よう', '来る', 'ya'],
  ['-た', '来た', '来る', 'ta'],
  ['-て', '来て', '来る', 'te'],
  ['-ろ', '来い', '来る', 'imp'],
];

/** Bentuk suru: し + akhiran, jadi `from` harus menyertakan し. */
const VS_TAILS: readonly TerminalSpec[] = [
  ['-ませんでした', 'しませんでした', 'する', 'masen'],
  ['-ません', 'しません', 'する', 'masen'],
  ['-ました', 'しました', 'する', 'masu'],
  ['-ます', 'します', 'する', 'masu'],
  ['-なかった', 'しなかった', 'する', 'nn'],
  ['-なくて', 'しなくて', 'する', 'nn'],
  ['-ない', 'しない', 'する', 'nn'],
  ['-ず', 'せず', 'する', 'nn'],
  ['-れば', 'すれば', 'する', 'ba'],
  ['-よう', 'しよう', 'する', 'ya'],
  ['-た', 'した', 'する', 'ta'],
  ['-て', 'して', 'する', 'te'],
  ['-ろ', 'しろ', 'する', 'imp'],
];

/** Bentuk vz (ずる): じ + akhiran. */
const VZ_TAILS: readonly TerminalSpec[] = [
  ['-た', 'じた', 'ずる', 'ta'],
  ['-て', 'じて', 'ずる', 'te'],
];

/** Adjektiva-i: akhiran langsung kembali ke `い`. */
const ADJ_I_TAILS: readonly TerminalSpec[] = [
  ['-くありませんでした', 'くありませんでした', 'い', 'masen'],
  ['-くありません', 'くありません', 'い', 'masen'],
  ['-くないです', 'くないです', 'い', 'masen'],
  ['-くなかった', 'くなかった', 'い', 'nn'],
  ['-くなくて', 'くなくて', 'い', 'nn'],
  ['-くない', 'くない', 'い', 'nn'],
  ['-ければ', 'ければ', 'い', 'ba'],
  ['-かった', 'かった', 'い', 'ta'],
  ['-くて', 'くて', 'い', 'te'],
];

/** Adjektiva-na: bentuk kamus tidak memakai kopula, jadi akhiran dipetakan ke string kosong. */
const ADJ_NA_TAILS: readonly TerminalSpec[] = [
  ['-ではありませんでした', 'ではありませんでした', '', 'copula'],
  ['-じゃありませんでした', 'じゃありませんでした', '', 'copula'],
  ['-ではありません', 'ではありません', '', 'copula'],
  ['-じゃありません', 'じゃありません', '', 'copula'],
  ['-ではなかった', 'ではなかった', '', 'copula'],
  ['-じゃなかった', 'じゃなかった', '', 'copula'],
  ['-ではない', 'ではない', '', 'copula'],
  ['-じゃない', 'じゃない', '', 'copula'],
  ['-でした', 'でした', '', 'copula'],
  ['-だった', 'だった', '', 'copula'],
  ['-です', 'です', '', 'copula'],
  ['-だ', 'だ', '', 'copula'],
];

/**
 * Transformasi majemuk (verba bantu setelah bentuk te).
 *
 * `conditionsIn` adalah kelas kata verba bantu yang sedang dilepas (`-た` dulu
 * mengubah `しまった` → `しまう` yang bertag v5u), `conditionsOut` adalah bentuk te
 * hasil pelepasan, sehingga rantai berlanjut ke `-て`.
 */
const LINKERS: readonly (readonly [string, string, string, string])[] = [
  ['-いる', 'ている', 'て', 'v1'],
  ['-いる', 'でいる', 'で', 'v1'],
  ['-くる', 'てくる', 'て', 'vk'],
  ['-くる', 'でくる', 'で', 'vk'],
  ['-いく', 'ていく', 'て', 'v5k'],
  ['-いく', 'でいく', 'で', 'v5k'],
  ['-しまう', 'てしまう', 'て', 'v5u'],
  ['-しまう', 'でしまう', 'で', 'v5u'],
  ['-おく', 'ておく', 'て', 'v5k'],
  ['-おく', 'でおく', 'で', 'v5k'],
  ['-みる', 'てみる', 'て', 'v1'],
  ['-みる', 'でみる', 'で', 'v1'],
  ['-ある', 'てある', 'て', 'v5r'],
  ['-ある', 'である', 'で', 'v5r'],
];

/** Kunci deskripsi per transformasi; divalidasi saat modul dimuat. */
const DESCRIPTION_KEYS: Record<string, string> = {
  '-た': 'past',
  '-て': 'te',
  '-ます': 'polite',
  '-ました': 'polite',
  '-ません': 'polite-negative',
  '-ませんでした': 'polite-negative',
  '-ない': 'negative',
  '-なかった': 'negative',
  '-なくて': 'negative',
  '-ず': 'negative',
  '-くて': 'te',
  '-くない': 'negative',
  '-くないです': 'polite-negative',
  '-くなかった': 'negative',
  '-くなくて': 'negative',
  '-くありません': 'polite-negative',
  '-くありませんでした': 'polite-negative',
  '-ば': 'conditional',
  '-れば': 'conditional',
  '-ければ': 'conditional',
  '-かった': 'past',
  '-う': 'volitional',
  '-よう': 'volitional',
  '-ろ': 'imperative',
  '-だ': 'copula',
  '-です': 'copula',
  '-だった': 'copula-past',
  '-でした': 'copula-past',
  '-ではない': 'copula-negative',
  '-じゃない': 'copula-negative',
  '-ではなかった': 'copula-negative',
  '-じゃなかった': 'copula-negative',
  '-ではありません': 'copula-negative',
  '-じゃありません': 'copula-negative',
  '-ではありませんでした': 'copula-negative',
  '-じゃありませんでした': 'copula-negative',
  '-いる': 'compound-iru',
  '-くる': 'compound-kuru',
  '-いく': 'compound-iku',
  '-しまう': 'compound-shimau',
  '-おく': 'compound-oku',
  '-みる': 'compound-miru',
  '-ある': 'compound-aru',
};

function terminalRules(
  target: DeinflectionRule[],
  pos: string,
  specs: readonly TerminalSpec[],
): void {
  for (const [transform, from, to, condition] of specs) {
    target.push({
      id: `${pos}.${transform}.${from}`,
      from,
      to,
      transform,
      conditionsIn: [condition],
      conditionsOut: POS_GROUPS[pos] ?? [pos],
    });
  }
}

function buildRules(): DeinflectionRule[] {
  const rules: DeinflectionRule[] = [];

  terminalRules(rules, 'v1', V1_TAILS);
  terminalRules(rules, 'vk', VK_TAILS);
  terminalRules(rules, 'vk', VK_KANJI_TAILS);
  terminalRules(rules, 'vs', VS_TAILS);
  terminalRules(rules, 'vz', VZ_TAILS);
  terminalRules(rules, 'adj-i', ADJ_I_TAILS);
  terminalRules(rules, 'adj-na', ADJ_NA_TAILS);

  for (const row of GODAN_ROWS) {
    terminalRules(rules, row.pos, [
      ['-ませんでした', `${row.i}ませんでした`, row.u, 'masen'],
      ['-ません', `${row.i}ません`, row.u, 'masen'],
      ['-ました', `${row.i}ました`, row.u, 'masu'],
      ['-ます', `${row.i}ます`, row.u, 'masu'],
      ['-なかった', `${row.a}なかった`, row.u, 'nn'],
      ['-なくて', `${row.a}なくて`, row.u, 'nn'],
      ['-ない', `${row.a}ない`, row.u, 'nn'],
      ['-ず', `${row.a}ず`, row.u, 'nn'],
      ['-ば', `${row.e}ば`, row.u, 'ba'],
      ['-う', `${row.o}う`, row.u, 'ya'],
      ['-て', row.te, row.u, 'te'],
      ['-た', row.ta, row.u, 'ta'],
    ]);
  }

  // 行く adalah v5k dengan bentuk te/lampau tidak teratur (いって/いった), jadi
  // akhiran v5t juga dapat mengembalikan lema v5k.
  const v5kConditions: readonly string[] = ['v5k', 'v5'];
  rules.push(
    {
      id: 'v5k.-て.って',
      from: 'って',
      to: 'く',
      transform: '-て',
      conditionsIn: ['te'],
      conditionsOut: v5kConditions,
    },
    {
      id: 'v5k.-た.った',
      from: 'った',
      to: 'く',
      transform: '-た',
      conditionsIn: ['ta'],
      conditionsOut: v5kConditions,
    },
  );

  for (const [transform, from, to, auxPos] of LINKERS) {
    const conditionsIn = POS_GROUPS[auxPos];
    if (conditionsIn === undefined) {
      throw new Error(`Kelas kata ${auxPos} tidak punya grup kondisi`);
    }
    rules.push({
      id: `${auxPos}.${transform}.${from}`,
      from,
      to,
      transform,
      conditionsIn,
      // Hasil pelepasan selalu bentuk te (termasuk varian bersuara で).
      conditionsOut: ['te'],
    });
  }

  // Akhiran yang lebih panjang diperiksa lebih dahulu supaya bentuk spesifik
  // (mis. くありませんでした) tidak kalah oleh akhiran pendek (くない).
  rules.sort((a, b) => b.from.length - a.from.length || a.id.localeCompare(b.id));
  return rules;
}

export const DEINFLECTION_RULES: readonly DeinflectionRule[] = buildRules();

/**
 * Daftar transformasi yang benar-benar dipakai tabel rule, lengkap dengan kunci
 * deskripsinya. UI memakai daftar ini untuk memberi keterangan tiap langkah.
 */
export const DEINFLECTION_TRANSFORMS: readonly DeinflectionTransform[] = [
  ...new Set(DEINFLECTION_RULES.map((rule) => rule.transform)),
]
  .sort((a, b) => a.localeCompare(b, 'ja'))
  .map((id) => {
    const descriptionKey = DESCRIPTION_KEYS[id];
    if (descriptionKey === undefined) {
      throw new Error(`Transformasi ${id} tidak punya kunci deskripsi`);
    }
    return { id, descriptionKey };
  });

const TRANSFORM_INDEX: ReadonlyMap<string, DeinflectionTransform> = new Map(
  DEINFLECTION_TRANSFORMS.map((transform) => [transform.id, transform]),
);

/** Kunci deskripsi sebuah transformasi; `null` bila nama tidak dikenal. */
export function transformDescriptionKey(transformId: string): string | null {
  return TRANSFORM_INDEX.get(transformId)?.descriptionKey ?? null;
}

/** Batas jumlah analisis yang dibangkitkan per kandidat (PRD 4.4: batas transformasi). */
export const MAX_DEINFLECTION_ANALYSES = 128;

/** Kedalaman rantai maksimum (mis. 食べていました → -ました, -いる, -て = 3 langkah). */
export const MAX_DEINFLECTION_DEPTH = 4;
