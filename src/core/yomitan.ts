/**
 * Adapter Yomitan → Shirabe (PRD 8.4: impor subset term bank v3, fitur P1).
 *
 * Modul murni tanpa DOM/Chrome, sehingga dapat diuji langsung. Pemetaan yang
 * didukung hanyalah subset:
 *
 * - `index.json` → metadata kamus (judul, revisi, atribusi/lisensi dari sumber).
 * - `term_bank_*.json` (format 3) → entry Shirabe:
 *   `[expression, reading, definitionTags, rules, score, glossary, sequence, termTags]`
 *   - `glossary` structured-content dipetakan ke item definisi schema v2: glosarium
 *     teks menjadi string, struktur (tabel bentuk kata, daftar catatan/rujukan, ruby)
 *     menjadi simpul yang divalidasi (`structured.ts`),
 *   - `definitionTags` dipisah menjadi kelas kata (tag POS yang dikenal) dan tag lain,
 *   - `rules` → tag aturan deinflection,
 *   - `score` → `priority` pada record storage (dipakai sebagai tie-break ranking,
 *     seperti `score` pada record biner Hoshidicts), tidak masuk schema JSONL v1.
 *
 * Bank kanji (`kanji_bank_*.json`), term meta (`term_meta_bank_*.json`: pitch/frekuensi),
 * dan media/gambar kamus (simpul `img`) juga dikonversi. Tag bank dan custom CSS
 * diabaikan dan dilaporkan oleh pemanggil, bukan diklaim berhasil diimpor.
 */

import { validateEntryObject, type ParsedEntry } from './jsonl.js';
import { DICTIONARY_ID_PATTERN } from './jsonl.js';
import { IMPORT_LIMITS } from './limits.js';
import {
  ALLOWED_STRUCTURED_TAGS,
  CONTROL_CHARS,
  IGNORED_STRUCTURED_TAGS,
  checkStyleValue,
  structuredText,
  validateDefinitionItem,
  type DefinitionItem,
  type StructuredContent,
  type StructuredNode,
} from './structured.js';
import { codePointLength } from './text.js';
import type { FrequencyValue, MetaValue, ParsedKanji, ParsedMeta, PitchValue } from './types.js';

export const YOMITAN_SUPPORTED_FORMAT = 3;

/** Tag kelas kata yang dikenali; sisanya diperlakukan sebagai tag biasa. */
export const POS_TAGS: ReadonlySet<string> = new Set([
  'adj-f', 'adj-i', 'adj-ix', 'adj-kari', 'adj-ku', 'adj-na', 'adj-nari', 'adj-no', 'adj-pn',
  'adj-shiku', 'adj-t', 'adv', 'adv-to', 'aux', 'aux-adj', 'aux-v', 'conj', 'cop', 'ctr',
  'exp', 'int', 'n', 'n-adv', 'n-pref', 'n-suf', 'n-t', 'num', 'pn', 'pref', 'prt', 'suf',
  'unc', 'v1', 'v1-s', 'v2a-s', 'v2b-k', 'v2b-s', 'v2d-k', 'v2d-s', 'v2g-k', 'v2g-s',
  'v2h-k', 'v2h-s', 'v2k-k', 'v2k-s', 'v2m-k', 'v2m-s', 'v2n-s', 'v2r-k', 'v2r-s', 'v2s-s',
  'v2t-k', 'v2t-s', 'v2w-s', 'v2y-k', 'v2y-s', 'v2z-s', 'v4b', 'v4g', 'v4h', 'v4k', 'v4m',
  'v4n', 'v4r', 'v4s', 'v4t', 'v5aru', 'v5b', 'v5g', 'v5k', 'v5k-s', 'v5m', 'v5n', 'v5r',
  'v5r-i', 'v5s', 'v5t', 'v5u', 'v5u-s', 'v5uru', 'vi', 'vk', 'vn', 'vr', 'vs', 'vs-c',
  'vs-i', 'vs-s', 'vt', 'vz', 'yoji',
]);

export interface YomitanIndexMetadata {
  title: string;
  format: number;
  revision: string;
  author: string;
  url: string;
  attribution: string;
  description: string;
}

export interface YomitanIndexFailure {
  ok: false;
  reason: string;
}

export type YomitanIndexResult = { ok: true; value: YomitanIndexMetadata } | YomitanIndexFailure;

/** Parsing + validasi `index.json`; format selain {@link YOMITAN_SUPPORTED_FORMAT} ditolak. */
export function parseYomitanIndex(text: string): YomitanIndexResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `index.json bukan JSON valid: ${(error as Error).message}` };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'index.json harus berupa objek JSON.' };
  }
  const record = value as Record<string, unknown>;
  const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
  if (title.length === 0) {
    return { ok: false, reason: 'index.json tidak memuat `title`.' };
  }
  const formatValue = typeof record['format'] === 'number' ? record['format'] : record['version'];
  if (typeof formatValue !== 'number' || !Number.isInteger(formatValue)) {
    return { ok: false, reason: 'index.json tidak memuat nomor `format` yang valid.' };
  }
  if (formatValue !== YOMITAN_SUPPORTED_FORMAT) {
    return {
      ok: false,
      reason: `format kamus ${formatValue} belum didukung; konverter ini menerima format ${YOMITAN_SUPPORTED_FORMAT}.`,
    };
  }
  const text1 = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string).trim() : '');
  return {
    ok: true,
    value: {
      title,
      format: formatValue,
      revision: text1('revision'),
      author: text1('author'),
      url: text1('url'),
      attribution: text1('attribution'),
      description: text1('description'),
    },
  };
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return DICTIONARY_ID_PATTERN.test(slug) ? slug : 'yomitan-dictionary';
}

/** ID kamus untuk metadata JSONL Shirabe (aman untuk kunci storage). */
export function dictionaryIdFromIndex(metadata: YomitanIndexMetadata): string {
  return slugify(metadata.title);
}

/** Metadata JSONL Shirabe dari `index.json` Yomitan. */
export function dictionaryHeaderFromIndex(
  metadata: YomitanIndexMetadata,
  overrides: { id?: string; name?: string } = {},
): {
  type: 'shirabe-dictionary';
  schemaVersion: 2;
  id: string;
  name: string;
  language: string;
  definitionLanguage: string;
  license: string;
  attribution: string;
} {
  const attribution = [
    metadata.attribution,
    metadata.author.length > 0 ? `Penulis/penerbit: ${metadata.author}` : '',
    metadata.url.length > 0 ? `Sumber: ${metadata.url}` : '',
    metadata.revision.length > 0 ? `Revisi: ${metadata.revision}` : '',
  ]
    .filter((part) => part.length > 0)
    .join(' — ');
  return {
    type: 'shirabe-dictionary',
    schemaVersion: 2,
    id: overrides.id ?? dictionaryIdFromIndex(metadata),
    name: overrides.name ?? metadata.title,
    language: 'ja',
    definitionLanguage: 'en',
    license: 'Lisensi mengikuti dataset sumber (lihat atribusi)',
    attribution: attribution.length > 0 ? attribution : metadata.title,
  };
}

/** Ratakan structured-content Yomitan menjadi teks biasa, tanpa markup. */
export function plainTextOf(node: unknown, options: { skipLists?: boolean } = {}): string {
  const skipLists = options.skipLists === true;
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (value !== null && typeof value === 'object') {
      const tag = typeof (value as { tag?: unknown }).tag === 'string' ? String((value as { tag: string }).tag) : '';
      if (skipLists && (tag === 'ul' || tag === 'ol')) {
        return;
      }
      walk((value as { content?: unknown }).content);
    }
  };
  walk(node);
  return parts.join('').replace(/\s+/gu, ' ').trim();
}

/**
 * Konversi `glossary` Yomitan menjadi item definisi Shirabe.
 *
 * Aturan pemetaan (PRD 8.4):
 * - `ul`/`ol` glosarium yang isinya hanya teks → satu string per `li` (tampilan ringkas,
 *   seperti sebelumnya).
 * - Konten berstruktur (tabel bentuk kata, daftar catatan/rujukan dengan penanda, ruby)
 *   → simpul structured content yang divalidasi, sehingga struktur aslinya tidak hilang.
 * - Tautan (`a`) diratakan menjadi teks dan dilaporkan; gambar (`img`, termasuk bentuk
 *   lama `{ type: 'image', path }`) dipertahankan sebagai simpul `img` dan jalurnya
 *   dikumpulkan di `media` supaya importer hanya mengambil berkas yang benar-benar dipakai.
 */
export interface GlossaryConversion {
  definitions: DefinitionItem[];
  /** Jalur media unik (urutan kemunculan pertama) yang direferensikan simpul `img`. */
  media: string[];
  /** Bagian yang tidak didukung: label alasan → jumlah (untuk laporan impor). */
  unsupported: Map<string, number>;
  /** Definisi yang gagal divalidasi dan akhirnya diratakan menjadi teks. */
  flattened: number;
}

/** Tag yang membuat sebuah item menjadi simpul (struktur tidak boleh hilang). */
const STRUCTURAL_TAGS: Readonly<Record<string, true>> = {
  caption: true,
  details: true,
  div: true,
  img: true,
  li: true,
  ol: true,
  p: true,
  rp: true,
  rt: true,
  ruby: true,
  summary: true,
  table: true,
  tbody: true,
  td: true,
  tfoot: true,
  th: true,
  thead: true,
  tr: true,
  ul: true,
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True bila subtree memuat struktur/gaya/peran yang tidak dapat dinyatakan sebagai teks. */
function isStructural(value: unknown): boolean {
  if (typeof value === 'string' || value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(isStructural);
  }
  if (!isPlainRecord(value)) {
    return false;
  }
  const tag = typeof value['tag'] === 'string' ? value['tag'] : '';
  if (Object.hasOwn(STRUCTURAL_TAGS, tag)) {
    return true;
  }
  if (value['data'] !== undefined || value['style'] !== undefined) {
    return true;
  }
  return isStructural(value['content']);
}

/** Atribut `img` Yomitan yang diteruskan ke schema v2; sisanya dihitung sebagai tak didukung. */
const IMG_ATTRIBUTES: Readonly<Record<string, true>> = {
  path: true,
  width: true,
  height: true,
  sizeUnits: true,
  appearance: true,
  pixelated: true,
  title: true,
  alt: true,
  verticalAlign: true,
};

/**
 * Normalisasi nilai atribut media.
 *
 * Sebagian kamus (mis. sankoku8) menulis nilai atribut sebagai string, termasuk tanda
 * kutip literal: `sizeUnits: "'em'"`, `appearance: "'auto'"`, `height: "1"`. Nilai
 * dinormalkan di sini supaya gambarnya tetap dirender; angka dan boolean yang tetap tidak
 * sah akan dibuang validasi (dan dilaporkan), bukan menggugurkan gambarnya.
 */
function coerceMediaValue(key: string, raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }
  const text = raw.replace(/^['"]|['"]$/gu, '').trim();
  if (key === 'width' || key === 'height') {
    const number = Number(text);
    return text === 'auto' || !Number.isFinite(number) ? text : number;
  }
  if (key === 'pixelated') {
    const lowered = text.toLowerCase();
    return lowered === 'true' ? true : lowered === 'false' ? false : raw;
  }
  return text;
}

/**
 * Normalisasi simpul gambar Yomitan (`img`, atau bentuk lama `{ type: 'image', path }`)
 * menjadi simpul `img` schema v2. Atribut di luar {@link IMG_ATTRIBUTES} dihitung sebagai
 * tidak didukung; gambar tanpa `path` yang sah dilewati dan dihitung, dan jalur yang
 * tersimpan dicatat di `stats.media`.
 *
 * Atribut yang nilainya tidak sah dibuang satu per satu (dan dilaporkan) selama `path`-nya
 * sah: satu atribut tampilan yang aneh tidak boleh menghilangkan gambarnya.
 */
function normalizeImageNode(
  value: Record<string, unknown>,
  stats: GlossaryConversion,
): StructuredNode | null {
  const candidate: Record<string, unknown> = { tag: 'img' };
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'tag' || key === 'type') {
      continue;
    }
    if (Object.hasOwn(IMG_ATTRIBUTES, key)) {
      candidate[key] = coerceMediaValue(key, raw);
    } else {
      countUnsupported(stats.unsupported, `atribut media \`${key}\``);
    }
  }
  const path = candidate['path'];
  if (typeof path !== 'string' || path.trim().length === 0) {
    countUnsupported(stats.unsupported, 'gambar tanpa `path`');
    return null;
  }
  let checked = validateDefinitionItem(candidate, true);
  if (!checked.ok) {
    // Cari atribut yang membuat validasi gagal, buang satu per satu, lalu coba lagi.
    for (const key of Object.keys(candidate)) {
      if (key === 'tag' || key === 'path' || checked.ok) {
        continue;
      }
      const probe: Record<string, unknown> = { tag: 'img', path: candidate['path'] };
      for (const [other, otherValue] of Object.entries(candidate)) {
        if (other !== 'tag' && other !== key) {
          probe[other] = otherValue;
        }
      }
      const withoutIt = validateDefinitionItem(probe, true);
      if (withoutIt.ok) {
        countUnsupported(stats.unsupported, `atribut media \`${key}\` tidak sah`);
        delete candidate[key];
        checked = withoutIt;
      }
    }
  }
  if (!checked.ok || typeof checked.value === 'string') {
    countUnsupported(stats.unsupported, 'gambar dengan atribut tidak sah');
    return null;
  }
  const node = checked.value;
  if (node.path !== undefined && !stats.media.includes(node.path)) {
    stats.media.push(node.path);
  }
  return node;
}

/**
 * Normalisasi satu simpul Yomitan menjadi simpul schema v2: nama atribut dipertahankan,
 * properti `style` yang tidak didukung dibuang (dan dicatat), `a` diratakan menjadi teks,
 * gambar (`img`) dipetakan lewat {@link normalizeImageNode}.
 */
function normalizeNode(
  value: Record<string, unknown>,
  stats: GlossaryConversion,
): StructuredNode | string | null {
  const tag = typeof value['tag'] === 'string' ? value['tag'].toLowerCase() : '';
  if (tag.length === 0) {
    return null;
  }
  if (tag === 'img') {
    return normalizeImageNode(value, stats);
  }
  if (Object.hasOwn(IGNORED_STRUCTURED_TAGS, tag)) {
    countUnsupported(stats.unsupported, `media atau elemen \`${tag}\``);
    return null;
  }
  if (tag === 'a') {
    // Rujukan silang belum didukung MVP: tautan diratakan menjadi teksnya.
    countUnsupported(stats.unsupported, 'tautan `a` diratakan menjadi teks');
    const text = plainTextOf(value['content']);
    return text.length > 0 ? text : null;
  }
  if (!Object.hasOwn(ALLOWED_STRUCTURED_TAGS, tag)) {
    // Tag tak dikenal: anak-anaknya tetap dibawa agar informasi tidak hilang.
    countUnsupported(stats.unsupported, `tag \`${tag}\` tidak dikenal`);
    const content = normalizeContent(value['content'], stats);
    return content === null ? null : { tag: 'span', content };
  }

  const node: StructuredNode = { tag };
  const style = value['style'];
  if (isPlainRecord(style)) {
    const kept: Record<string, string> = {};
    for (const [key, raw] of Object.entries(style)) {
      const checked = checkStyleValue(key, raw);
      if (checked.ok) {
        kept[key] = checked.value;
      } else {
        countUnsupported(stats.unsupported, `gaya \`${key}\``);
      }
    }
    if (Object.keys(kept).length > 0) {
      node.style = kept;
    }
  }
  const lang = value['lang'];
  if (typeof lang === 'string' && /^[A-Za-z0-9-]{1,35}$/.test(lang)) {
    node.lang = lang;
  }
  const data = value['data'];
  if (
    isPlainRecord(data)
    && typeof data['content'] === 'string'
    && /^[a-zA-Z][A-Za-z0-9-]{0,31}$/.test(data['content'])
  ) {
    node.data = { content: data['content'] };
  }
  const content = normalizeContent(value['content'], stats);
  if (
    content !== null
    && typeof content === 'string'
    && (tag === 'span' || tag === 'div' || tag === 'p')
    && node.style === undefined
    && node.data === undefined
    && node.lang === undefined
    && node.title === undefined
  ) {
    // Wadah teks polos tidak perlu menjadi simpul: string lebih ringkas.
    return content;
  }
  if (content !== null && tag !== 'br') {
    node.content = content;
  }
  return node;
}

function normalizeContent(
  value: unknown,
  stats: GlossaryConversion,
): StructuredContent | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const items: StructuredContent[] = [];
    for (const item of value) {
      const normalized = normalizeContent(item, stats);
      if (normalized !== null) {
        items.push(normalized);
      }
    }
    return items.length === 0 ? null : items;
  }
  if (!isPlainRecord(value)) {
    return null;
  }
  if (value['type'] === 'structured-content') {
    return normalizeContent(value['content'], stats);
  }
  if (value['type'] === 'text') {
    const text = value['text'] ?? value['content'];
    return typeof text === 'string' ? text : null;
  }
  if (value['type'] === 'image') {
    return normalizeImageNode(value, stats);
  }
  return normalizeNode(value, stats);
}

/** Tambahkan satu item definisi bila belum ada; mengembalikan hasil validasi. */
function pushDefinition(
  target: DefinitionItem[],
  seen: Set<string>,
  candidate: DefinitionItem,
  stats: GlossaryConversion,
): void {
  const checked = validateDefinitionItem(candidate, true);
  let item: DefinitionItem;
  if (checked.ok) {
    item = checked.value;
  } else {
    const text = structuredText(candidate);
    if (text.length === 0) {
      return;
    }
    stats.flattened += 1;
    item = text;
  }
  const text = typeof item === 'string' ? item : structuredText(item);
  // Simpul tanpa teks (mis. `img`, `br`) tetap perlu kunci unik: pakai bentuk JSON-nya.
  const key = text.length > 0 ? text : JSON.stringify(item);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push(item);
}

function countUnsupported(counts: Map<string, number>, label: string, count = 1): void {
  counts.set(label, (counts.get(label) ?? 0) + count);
}

export function definitionsFromGlossary(glossary: readonly unknown[]): GlossaryConversion {
  const stats: GlossaryConversion = { definitions: [], media: [], unsupported: new Map(), flattened: 0 };
  const senses: DefinitionItem[] = [];
  const references: DefinitionItem[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, target: DefinitionItem[]): void => {
    if (typeof node === 'string') {
      const text = node.replace(/\s+/gu, ' ').trim();
      if (text.length > 0) {
        pushDefinition(target, seen, text, stats);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, target);
      }
      return;
    }
    if (!isPlainRecord(node)) {
      return;
    }
    if (node['type'] === 'structured-content') {
      visit(node['content'], target);
      return;
    }
    if (node['type'] === 'text') {
      visit(node['text'] ?? node['content'], target);
      return;
    }
    if (node['type'] === 'image') {
      const image = normalizeImageNode(node, stats);
      if (image !== null) {
        pushDefinition(target, seen, image, stats);
      }
      return;
    }
    const tag = typeof node['tag'] === 'string' ? node['tag'].toLowerCase() : '';
    const role = isPlainRecord(node['data']) && typeof node['data']['content'] === 'string'
      ? node['data']['content']
      : '';

    if ((tag === 'ul' || tag === 'ol') && (role === 'references' || role === 'notes' || role === '' || role === 'glossary' || role === 'forms')) {
      // Glosarium teks: satu string per `li` (tampilan ringkas). Daftar catatan/rujukan
      // tetap membawa penandanya (`listStyleType`) seperti di Hachidori.
      const keepMarker = role === 'references' || role === 'notes';
      const items = Array.isArray(node['content']) ? (node['content'] as unknown[]) : [node['content']];
      if (keepMarker) {
        const normalized = normalizeNode({ ...node, content: items }, stats);
        if (normalized !== null) {
          const destination = role === 'references' ? references : target;
          pushDefinition(
            destination,
            seen,
            typeof normalized === 'string' ? normalized : normalized,
            stats,
          );
        }
        return;
      }
      for (const item of items) {
        if (!isPlainRecord(item) || item['tag'] !== 'li') {
          visit(item, target);
          continue;
        }
        const content = item['content'];
        if (isStructural(content)) {
          const normalized = normalizeContent(content, stats);
          if (normalized !== null) {
            pushDefinition(target, seen, { tag: 'div', content: normalized }, stats);
          }
          continue;
        }
        const text = plainTextOf(content);
        if (text.length > 0) {
          pushDefinition(target, seen, text, stats);
        }
      }
      return;
    }

    const normalized = normalizeNode(node, stats);
    if (normalized === null) {
      return;
    }
    pushDefinition(target, seen, normalized, stats);
  };

  for (const item of glossary) {
    visit(item, senses);
  }
  stats.definitions = [...senses, ...references];
  return stats;
}

export interface SkippedEntries {
  count: number;
  /** Expression entry pertama yang dilewati, untuk pesan UI. */
  example: string | null;
  /** Alasan pertama entry dilewati. */
  reason: string | null;
}

export interface TermBankConversion {
  entries: ParsedEntry[];
  skipped: SkippedEntries;
  /** Jalur media unik yang direferensikan definisi bank ini (urutan kemunculan pertama). */
  media: string[];
  /** Jumlah entry yang daftar definisinya dipotong agar sesuai batas schema. */
  truncatedDefinitions: number;
  /** Bagian structured content yang tidak didukung: label → jumlah. */
  unsupported: Map<string, number>;
  /** Definisi yang akhirnya diratakan menjadi teks karena tidak lolos validasi. */
  flattenedDefinitions: number;
}

const MAX_DEFINITIONS_PER_ENTRY = 64;

/**
 * Konversi satu bank term menjadi entry Shirabe.
 *
 * Pembungkus `convertTermBankChunks` untuk pemakaian yang tidak memerlukan progres
 * (pengujian, bank kecil). Importer memakai versi per potongan agar bank besar tidak
 * dikonversi dalam satu blok sinkron.
 */
export function convertTermBank(rows: unknown): TermBankConversion {
  const conversion: TermBankConversion = {
    entries: [],
    skipped: { count: 0, example: null, reason: null },
    media: [],
    truncatedDefinitions: 0,
    unsupported: new Map(),
    flattenedDefinitions: 0,
  };
  if (!Array.isArray(rows)) {
    conversion.skipped = { count: 1, example: null, reason: 'Bank bukan array JSON.' };
    return conversion;
  }
  for (const chunk of convertTermBankChunks(rows, conversion)) {
    conversion.entries.push(...chunk);
  }
  return conversion;
}

/**
 * Konversi bank term Yomitan per potongan.
 *
 * Dipakai importer agar bank besar tidak dikonversi dalam satu blok sinkron: selama
 * konversi (bagian termahal impor kamus kaya — 65% waktu pada kamus 200 MB) pemanggil
 * dapat melaporkan progres dan memberi kesempatan browser menggambar frame. Statistik
 * (baris dilewati, bagian tak didukung, media) diakumulasi ke `conversion` yang diberikan.
 */
export function* convertTermBankChunks(
  rows: unknown,
  conversion: TermBankConversion = newTermBankConversion(),
  chunkSize = 2_000,
): Generator<ParsedEntry[], void, void> {
  const { skipped, media, unsupported } = conversion;
  if (!Array.isArray(rows)) {
    skipped.count += 1;
    skipped.reason ??= 'Bank bukan array JSON.';
    return;
  }
  let chunk: ParsedEntry[] = [];

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) {
      skipped.count += 1;
      skipped.example ??= null;
      skipped.reason ??= 'Baris bank tidak mengikuti bentuk term bank v3.';
      continue;
    }
    const [expressionRaw, readingRaw, definitionTags, rules, score, glossary] = row;
    const expression = typeof expressionRaw === 'string' ? expressionRaw.trim() : '';
    if (expression.length === 0 || !Array.isArray(glossary)) {
      skipped.count += 1;
      skipped.example ??= expression.length > 0 ? expression : null;
      skipped.reason ??= 'Entry tanpa expression atau tanpa glossary.';
      continue;
    }
    const glossaryConversion = definitionsFromGlossary(glossary);
    for (const [label, count] of glossaryConversion.unsupported) {
      unsupported.set(label, (unsupported.get(label) ?? 0) + count);
    }
    for (const mediaPath of glossaryConversion.media) {
      if (!media.includes(mediaPath)) {
        media.push(mediaPath);
      }
    }
    conversion.flattenedDefinitions += glossaryConversion.flattened;
    let definitions = glossaryConversion.definitions;
    if (definitions.length > MAX_DEFINITIONS_PER_ENTRY) {
      definitions = definitions.slice(0, MAX_DEFINITIONS_PER_ENTRY);
      conversion.truncatedDefinitions += 1;
    }

    const partOfSpeech: string[] = [];
    const tags: string[] = [];
    for (const tag of String(definitionTags ?? '').split(' ')) {
      if (tag.length === 0) {
        continue;
      }
      if (POS_TAGS.has(tag)) {
        partOfSpeech.push(tag);
      } else {
        tags.push(tag);
      }
    }
    for (const tag of String(row[7] ?? '').split(' ')) {
      if (tag.length > 0) {
        tags.push(tag);
      }
    }
    const ruleTags = String(rules ?? '')
      .split(' ')
      .filter((tag) => tag.length > 0);

    const candidate: Record<string, unknown> = {
      expression,
      reading: typeof readingRaw === 'string' ? readingRaw.trim() : '',
      definitions,
      partOfSpeech,
      tags,
      rules: ruleTags,
    };
    const validated = validateEntryObject(candidate);
    if (!validated.ok) {
      skipped.count += 1;
      skipped.example ??= expression;
      skipped.reason ??= validated.reason;
      continue;
    }
    const entry: ParsedEntry = validated.value;
    if (typeof score === 'number' && Number.isFinite(score)) {
      // Skor frekuensi Yomitan disimpan sebagai prioritas ranking (tidak masuk schema JSONL).
      entry.priority = score;
    }
    chunk.push(entry);
    if (chunk.length >= chunkSize) {
      yield chunk;
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    yield chunk;
  }
}

/** Statistik konversi bank term yang masih kosong. */
export function newTermBankConversion(): TermBankConversion {
  return {
    entries: [],
    skipped: { count: 0, example: null, reason: null },
    media: [],
    truncatedDefinitions: 0,
    unsupported: new Map(),
    flattenedDefinitions: 0,
  };
}

/**
 * Validasi satu string bank Yomitan (kanji/meta): string non-kosong, di bawah
 * `maxStringCodePoints`, tanpa karakter kontrol. Setara `checkText` di `structured.ts`.
 */
function checkBankString(value: unknown, allowEmpty = false): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  if (!allowEmpty && text.length === 0) {
    return null;
  }
  if (codePointLength(text) > IMPORT_LIMITS.maxStringCodePoints) {
    return null;
  }
  if (CONTROL_CHARS.test(text)) {
    return null;
  }
  return text;
}

/** Pisahkan string bertoken spasi menjadi daftar string valid; `null` bila tidak sesuai. */
function splitBankTokens(value: unknown): string[] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const tokens: string[] = [];
  for (const token of value.split(/\s+/u)) {
    if (token.length === 0) {
      continue;
    }
    const checked = checkBankString(token);
    if (checked === null) {
      return null;
    }
    tokens.push(checked);
  }
  return tokens;
}

/** Objek `stats` bank kanji: pasangan string→string; `null` bila tidak sesuai. */
function parseKanjiStats(value: unknown): Record<string, string> | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const stats: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const checkedKey = checkBankString(key);
    const checkedValue = checkBankString(raw, true);
    if (checkedKey === null || checkedValue === null) {
      return null;
    }
    stats[checkedKey] = checkedValue;
  }
  return stats;
}

/** Satu baris bank kanji → kanji tervalidasi; `null` bila bentuknya tidak sesuai. */
function parseKanjiRow(row: unknown): ParsedKanji | null {
  if (!Array.isArray(row) || row.length < 6) {
    return null;
  }
  const [characterRaw, onyomiRaw, kunyomiRaw, tagsRaw, meaningsRaw, statsRaw] = row;
  const character = checkBankString(characterRaw);
  const onyomi = splitBankTokens(onyomiRaw);
  const kunyomi = splitBankTokens(kunyomiRaw);
  const tags = splitBankTokens(tagsRaw);
  const stats = parseKanjiStats(statsRaw);
  if (character === null || onyomi === null || kunyomi === null || tags === null || stats === null) {
    return null;
  }
  if (!Array.isArray(meaningsRaw)) {
    return null;
  }
  const meanings: string[] = [];
  for (const raw of meaningsRaw) {
    const checked = checkBankString(raw);
    if (checked === null) {
      return null;
    }
    meanings.push(checked);
  }
  return { character, onyomi, kunyomi, tags, meanings, stats };
}

export interface KanjiBankConversion {
  entries: ParsedKanji[];
  /** Baris yang bentuknya tidak sesuai (dilewati, bukan menggagalkan impor). */
  skipped: number;
  /** Bagian yang tidak didukung: label → jumlah (mis. sisa baris melebihi batas). */
  unsupported: Map<string, number>;
}

/**
 * Konversi satu bank kanji Yomitan (`kanji_bank_*.json`) menjadi kanji Shirabe.
 *
 * Bentuk baris: `[character, onyomi, kunyomi, tags, meanings, stats]`. Berhenti di
 * {@link IMPORT_LIMITS.maxKanjiPerDictionary} dan melaporkan sisa baris sebagai
 * `unsupported`, supaya kamus besar tidak menggagalkan impor.
 */
export function convertKanjiBank(rows: unknown): KanjiBankConversion {
  const entries: ParsedKanji[] = [];
  const unsupported = new Map<string, number>();
  let skipped = 0;
  if (!Array.isArray(rows)) {
    return { entries, skipped: 1, unsupported };
  }
  for (const [index, row] of rows.entries()) {
    if (entries.length >= IMPORT_LIMITS.maxKanjiPerDictionary) {
      countUnsupported(
        unsupported,
        `bank kanji melebihi batas ${IMPORT_LIMITS.maxKanjiPerDictionary}`,
        rows.length - index,
      );
      break;
    }
    const kanji = parseKanjiRow(row);
    if (kanji === null) {
      skipped += 1;
      continue;
    }
    entries.push(kanji);
  }
  return { entries, skipped, unsupported };
}

/**
 * Daftar posisi mora (`devoice`/`nasal`) pitch, berbasis 1 seperti di kamus.
 *
 * Sebagian kamus menulis posisinya sebagai string angka, jadi nilainya dinormalkan
 * (pola `_toNumberArray` Yomitan). Penanda yang tidak bisa dibaca sebagai posisi mora
 * dibuang sendirian: penanda itu hanya hiasan graf, dan pitch-nya sendiri tetap benar.
 */
function parseMoraList(value: unknown): number[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const items: number[] = [];
  for (const raw of value) {
    const number = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (Number.isInteger(number) && number >= 1 && number <= 64) {
      items.push(number);
    }
  }
  return items;
}

/** Bacaan meta: nilai string bila diisi, `fallback` bila kosong/tidak ada; `null` bila tidak sah. */
function parseMetaReading(value: unknown, fallback: string): string | null {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return checkBankString(value);
}

/** Nilai pitch satu baris meta; `null` bila `data` tidak sesuai bentuk pitch. */
function parsePitchValue(expression: string, data: Record<string, unknown>): MetaValue | null {
  const rawPitches = data['pitches'];
  if (!Array.isArray(rawPitches)) {
    return null;
  }
  const pitches: PitchValue[] = [];
  for (const raw of rawPitches) {
    if (!isPlainRecord(raw)) {
      return null;
    }
    const position = raw['position'];
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position > 64) {
      return null;
    }
    const devoice = parseMoraList(raw['devoice']);
    const nasal = parseMoraList(raw['nasal']);
    if (devoice === null || nasal === null) {
      return null;
    }
    pitches.push({ position, devoice, nasal });
  }
  const reading = parseMetaReading(data['reading'], expression);
  if (reading === null) {
    return null;
  }
  return { type: 'pitch', reading, pitches };
}

/** Nilai frekuensi satu baris meta; `null` bila `data` tidak sesuai bentuk frekuensi. */
function parseFrequencyValue(data: Record<string, unknown>): MetaValue | null {
  const nested = data['frequency'];
  if (nested !== undefined && !isPlainRecord(nested)) {
    return null;
  }
  const source = isPlainRecord(nested) ? nested : data;
  const value = source['value'];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const frequency: FrequencyValue = { value };
  if (source['displayValue'] !== undefined) {
    const displayValue = checkBankString(source['displayValue']);
    if (displayValue === null) {
      return null;
    }
    frequency.displayValue = displayValue;
  }
  const reading = parseMetaReading(data['reading'], '');
  if (reading === null) {
    return null;
  }
  return { type: 'freq', reading, frequency };
}

export interface MetaBankConversion {
  entries: ParsedMeta[];
  /** Baris yang bentuknya tidak sesuai (dilewati, bukan menggagalkan impor). */
  skipped: number;
  /** Bagian yang tidak didukung: label → jumlah (mis. tipe meta tak dikenal). */
  unsupported: Map<string, number>;
}

/**
 * Konversi satu bank meta Yomitan (`term_meta_bank_*.json`) menjadi nilai meta Shirabe.
 *
 * Bentuk baris: `[expression, type, data]` dengan `type` `pitch` atau `freq`
 * (varian `frequency` dinormalkan ke `freq`). Baris dengan (expression, reading) sama
 * digabung menjadi satu {@link ParsedMeta} dengan semua nilainya, sesuai urutan kemunculan.
 */
export function convertTermMetaBank(rows: unknown): MetaBankConversion {
  const entries: ParsedMeta[] = [];
  const unsupported = new Map<string, number>();
  const byKey = new Map<string, ParsedMeta>();
  let skipped = 0;
  if (!Array.isArray(rows)) {
    return { entries, skipped: 1, unsupported };
  }
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) {
      skipped += 1;
      continue;
    }
    const expression = checkBankString(row[0]);
    const rawType = row[1];
    const data = row[2];
    if (expression === null || typeof rawType !== 'string' || !isPlainRecord(data)) {
      skipped += 1;
      continue;
    }
    const type = rawType.toLowerCase();
    if (type !== 'pitch' && type !== 'freq' && type !== 'frequency') {
      countUnsupported(unsupported, `tipe meta \`${rawType}\` tidak dikenal`);
      continue;
    }
    const value = type === 'pitch' ? parsePitchValue(expression, data) : parseFrequencyValue(data);
    if (value === null) {
      skipped += 1;
      continue;
    }
    const key = `${expression}\u0000${value.reading}`;
    let meta = byKey.get(key);
    if (meta === undefined) {
      meta = { expression, reading: value.reading, values: [] };
      byKey.set(key, meta);
      entries.push(meta);
    }
    meta.values.push(value);
  }
  return { entries, skipped, unsupported };
}
