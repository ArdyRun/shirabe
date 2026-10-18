/**
 * Subset *structured content* (format Yomitan) yang didukung Shirabe — PRD 8.1, 8.4, 13.
 *
 * Yang diterima di sini bukan HTML mentah, melainkan
 * pohon simpul JSON (`{tag, content, style, …}`) yang **divalidasi terhadap daftar
 * putih** sebelum disimpan maupun dirender. Tanpa dukungan ini, tabel bentuk kata
 * (mis. glosarium `forms` JMdict) dan daftar catatan/rujukan kehilangan struktur saat
 * impor: sel-sel tabel akan menempel menjadi sederet teks.
 *
 * Aturan:
 * - Tag di luar daftar putih ditolak dengan pesan yang menyebut tag tersebut.
 * - Atribut di luar daftar putih ditolak; nilai `style` divalidasi per properti.
 * - `a`, gambar, dan media tidak didukung (rujukan tampil sebagai teks) sesuai batas
 *   MVP PRD 8.4; konverter Yomitan meratakan/membuangnya dan melaporkannya.
 * - Batas jumlah simpul, kedalaman, dan panjang teks mencegah dataset berbahaya
 *   membuat UI tidak responsif.
 */

import { IMPORT_LIMITS } from './limits.js';
import { codePointLength } from './text.js';

/** Potongan teks di dalam structured content. */
export type StructuredContent = string | StructuredNode | readonly StructuredContent[];

/** Simpul structured content yang sudah lolos validasi. */
export interface StructuredNode {
  tag: string;
  content?: StructuredContent;
  style?: Record<string, string>;
  lang?: string;
  /** `data` Yomitan: hanya `content` (peran konten) yang didukung. */
  data?: { content?: string };
  /** Teks tooltip (≤ 200 code point). */
  title?: string;
  /** Rentang sel tabel (1–32). */
  colSpan?: number;
  rowSpan?: number;
  /**
   * Jalur media relatif di dalam kamus (hanya pada `img`). Tidak pernah URL: renderer
   * meminta byte-nya ke store `media` kamus yang sama, sehingga dataset tidak bisa
   * memicu permintaan jaringan.
   */
  path?: string;
  /** Lebar/tinggi tampil; `'auto'` mengikuti berkas aslinya. */
  width?: number | 'auto';
  height?: number | 'auto';
  sizeUnits?: 'px' | 'em' | 'rem' | '%' | 'pt';
  /** `monochrome` = gambar mengikuti warna teks (diinversi pada tema gelap). */
  appearance?: 'auto' | 'monochrome';
  pixelated?: boolean;
  /** Teks alternatif untuk pembaca layar (≤ 200 code point). */
  alt?: string;
  verticalAlign?: string;
}

/** Satu definisi: teks biasa, atau satu simpul structured content. */
export type DefinitionItem = string | StructuredNode;

export type StructuredResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Tag yang dirender oleh UI (`true` = didukung). */
export const ALLOWED_STRUCTURED_TAGS: Readonly<Record<string, true>> = {
  b: true,
  br: true,
  caption: true,
  code: true,
  details: true,
  dfn: true,
  div: true,
  em: true,
  i: true,
  img: true,
  li: true,
  mark: true,
  ol: true,
  p: true,
  rp: true,
  rt: true,
  ruby: true,
  s: true,
  small: true,
  span: true,
  strong: true,
  sub: true,
  summary: true,
  sup: true,
  table: true,
  tbody: true,
  td: true,
  tfoot: true,
  th: true,
  thead: true,
  tr: true,
  u: true,
  ul: true,
};

/**
 * Tag yang dibuang bersama isinya: elemen interaktif/media tidak pernah dirender dan
 * tidak boleh memicu permintaan jaringan dari popup (PRD 13, 8.4). `img` bukan lagi di
 * sini: gambar kamus didukung lewat store `media` (hanya berkas milik kamus itu sendiri).
 */
export const IGNORED_STRUCTURED_TAGS: Readonly<Record<string, true>> = {
  audio: true,
  button: true,
  canvas: true,
  iframe: true,
  input: true,
  link: true,
  meta: true,
  script: true,
  source: true,
  style: true,
  svg: true,
  video: true,
};

/** Tag tanpa isi; `content` pada tag ini diabaikan. */
const TAGS_WITHOUT_CONTENT: Readonly<Record<string, true>> = { br: true, img: true };

/** Markup HTML mentah tidak boleh muncul di dalam teks dataset. */
export const HTML_MARKUP = /<[a-zA-Z!/]/;
/** Karakter kontrol yang tidak didukung di dalam teks dataset. */
export const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const NODE_KEYS: Readonly<Record<string, true>> = {
  tag: true,
  content: true,
  style: true,
  lang: true,
  data: true,
  title: true,
  colSpan: true,
  rowSpan: true,
  path: true,
  width: true,
  height: true,
  sizeUnits: true,
  appearance: true,
  pixelated: true,
  alt: true,
  verticalAlign: true,
};

/** Atribut yang hanya bermakna pada `img`. */
const MEDIA_KEYS: Readonly<Record<string, true>> = {
  path: true,
  width: true,
  height: true,
  sizeUnits: true,
  appearance: true,
  pixelated: true,
  alt: true,
  verticalAlign: true,
};

const ROLE_PATTERN = /^[a-zA-Z][A-Za-z0-9-]{0,31}$/;
const LANG_PATTERN = /^[A-Za-z0-9-]{1,35}$/;
const MAX_TITLE_CODE_POINTS = 200;
const MAX_SPAN = 32;
/**
 * Jalur media yang diterima: relatif terhadap akar kamus, tanpa skema, tanpa `..`,
 * tanpa garis miring di awal, tanpa garis miring terbalik. Dengan begitu jalur tidak
 * bisa keluar dari store kamus atau menjadi URL. Dipakai juga oleh service worker saat
 * memvalidasi permintaan gambar dari halaman (batas kepercayaan).
 */
export const MEDIA_PATH_PATTERN = /^(?!\/)(?!.*\.\.)[^\\:?#\u0000-\u001f]{1,512}$/u;
const SIZE_UNITS_PATTERN = /^(?:px|em|rem|%|pt)$/;
const VERTICAL_ALIGN_PATTERN = /^(?:baseline|sub|super|middle|top|bottom|text-top|text-bottom)$/;
const MEDIA_SIZE_LIMIT = 64;
const APPEARANCE_PATTERN = /^(?:auto|monochrome)$/;

/** Properti `style` yang didukung, dipetakan ke nama CSS dan pola nilai yang sah. */
const STYLE_PROPERTIES: ReadonlyMap<string, { css: string; pattern: RegExp }> = new Map([
  ['textAlign', { css: 'text-align', pattern: /^(?:left|right|center|justify|start|end)$/ }],
  ['verticalAlign', {
    css: 'vertical-align',
    pattern: /^(?:baseline|sub|super|middle|top|bottom|text-top|text-bottom)$/,
  }],
  ['fontWeight', { css: 'font-weight', pattern: /^(?:normal|bold|bolder|lighter|[1-9]00)$/ }],
  ['fontStyle', { css: 'font-style', pattern: /^(?:normal|italic|oblique)$/ }],
]);

/**
 * `list-style-type`: kata kunci CSS, atau penanda pendek dalam tanda kutip tunggal
 * (mis. `'📝 '` pada kamus JMdict). Nilai yang memuat `url(`/tanda kurung/garis miring
 * ditolak supaya dataset tidak bisa memicu permintaan jaringan.
 */
const LIST_STYLE_KEYWORDS = /^(?:none|disc|circle|square|decimal|decimal-leading-zero|lower-alpha|upper-alpha|lower-roman|upper-roman)$/;
const LIST_STYLE_MARKER = /^'[^'";<>\\()]{1,6}'[ ]?$/;

export function isStructuredNode(value: unknown): value is StructuredNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkText(value: unknown, field: string, max: number, allowEmpty = false): StructuredResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, reason: `field \`${field}\` harus berupa string` };
  }
  if (!allowEmpty && value.trim().length === 0) {
    return { ok: false, reason: `field \`${field}\` tidak boleh kosong` };
  }
  if (codePointLength(value) > max) {
    return { ok: false, reason: `field \`${field}\` melebihi batas ${max} code point` };
  }
  if (CONTROL_CHARS.test(value)) {
    return { ok: false, reason: `field \`${field}\` mengandung karakter kontrol yang tidak didukung` };
  }
  if (HTML_MARKUP.test(value)) {
    return { ok: false, reason: `field \`${field}\` mengandung markup HTML; dataset harus data, bukan HTML` };
  }
  return { ok: true, value };
}

/**
 * Validasi satu pasangan properti/nilai `style`.
 *
 * Dipakai validator schema **dan** konverter Yomitan: konverter menyaring properti
 * yang tidak didukung (dan melaporkannya) sehingga berkas yang dihasilkan selalu sah.
 */
export function checkStyleValue(key: string, raw: unknown): StructuredResult<string> {
  if (key === 'listStyleType') {
    if (typeof raw !== 'string') {
      return { ok: false, reason: '`style.listStyleType` harus berupa string' };
    }
    if (!LIST_STYLE_KEYWORDS.test(raw) && !LIST_STYLE_MARKER.test(raw)) {
      return { ok: false, reason: `\`style.listStyleType\` bernilai tidak didukung: ${JSON.stringify(raw)}` };
    }
    return { ok: true, value: raw };
  }
  const property = STYLE_PROPERTIES.get(key);
  if (property === undefined) {
    return { ok: false, reason: `properti style \`${key}\` tidak didukung` };
  }
  if (typeof raw !== 'string' || !property.pattern.test(raw)) {
    return { ok: false, reason: `nilai \`style.${key}\` tidak didukung: ${JSON.stringify(raw)}` };
  }
  return { ok: true, value: raw };
}

interface Budget {
  nodes: number;
}

function validateStyle(value: unknown, path: string): StructuredResult<Record<string, string>> {
  if (!isPlainObject(value)) {
    return { ok: false, reason: `\`style\` pada ${path} harus berupa objek` };
  }
  const style: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const checked = checkStyleValue(key, raw);
    if (!checked.ok) {
      return { ok: false, reason: `${checked.reason} pada ${path}` };
    }
    style[key] = checked.value;
  }
  return { ok: true, value: style };
}

/** Properti CSS yang benar-benar dipakai renderer (hanya yang lolos validasi). */
export function structuredStyleEntries(style: Readonly<Record<string, string>>): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(style)) {
    if (key === 'listStyleType') {
      if (LIST_STYLE_KEYWORDS.test(value) || LIST_STYLE_MARKER.test(value)) {
        entries.push(['list-style-type', value]);
      }
      continue;
    }
    const property = STYLE_PROPERTIES.get(key);
    if (property !== undefined && property.pattern.test(value)) {
      entries.push([property.css, value]);
    }
  }
  return entries;
}

function validateContent(value: unknown, depth: number, budget: Budget, path: string): StructuredResult<StructuredContent> {
  if (typeof value === 'string') {
    if (codePointLength(value) > IMPORT_LIMITS.maxStructuredTextCodePoints) {
      return {
        ok: false,
        reason: `teks pada ${path} melebihi batas ${IMPORT_LIMITS.maxStructuredTextCodePoints} code point`,
      };
    }
    if (CONTROL_CHARS.test(value)) {
      return { ok: false, reason: `teks pada ${path} mengandung karakter kontrol yang tidak didukung` };
    }
    if (HTML_MARKUP.test(value)) {
      return { ok: false, reason: `teks pada ${path} mengandung markup HTML; dataset harus data, bukan HTML` };
    }
    return { ok: true, value };
  }
  if (Array.isArray(value)) {
    const items: StructuredContent[] = [];
    for (const [index, item] of value.entries()) {
      const checked = validateContent(item, depth, budget, `${path}[${index}]`);
      if (!checked.ok) {
        return checked;
      }
      items.push(checked.value);
    }
    return { ok: true, value: items };
  }
  return validateNode(value, depth, budget, path);
}

function validateNode(value: unknown, depth: number, budget: Budget, path: string): StructuredResult<StructuredNode> {
  if (!isPlainObject(value)) {
    return { ok: false, reason: `${path} harus berupa teks atau simpul \`{tag: …}\`` };
  }
  if (depth > IMPORT_LIMITS.maxStructuredDepth) {
    return { ok: false, reason: `sarang structured content melebihi batas ${IMPORT_LIMITS.maxStructuredDepth} tingkat` };
  }
  budget.nodes += 1;
  if (budget.nodes > IMPORT_LIMITS.maxStructuredNodesPerDefinition) {
    return {
      ok: false,
      reason: `jumlah simpul melebihi batas ${IMPORT_LIMITS.maxStructuredNodesPerDefinition} per definisi`,
    };
  }
  const tagRaw = value['tag'];
  if (typeof tagRaw !== 'string' || tagRaw.trim().length === 0) {
    return { ok: false, reason: `simput pada ${path} tidak memiliki \`tag\`` };
  }
  const tag = tagRaw.trim().toLowerCase();
  if (Object.hasOwn(IGNORED_STRUCTURED_TAGS, tag)) {
    return { ok: false, reason: `tag \`${tag}\` (${path}) tidak didukung dan tidak boleh disimpan di dataset` };
  }
  if (!Object.hasOwn(ALLOWED_STRUCTURED_TAGS, tag)) {
    return { ok: false, reason: `tag \`${tag}\` pada ${path} tidak didukung` };
  }
  const isMedia = tag === 'img';
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(NODE_KEYS, key)) {
      return { ok: false, reason: `atribut \`${key}\` pada ${path} tidak didukung` };
    }
    if (!isMedia && Object.hasOwn(MEDIA_KEYS, key)) {
      return { ok: false, reason: `atribut \`${key}\` hanya didukung pada tag \`img\` (${path})` };
    }
  }

  const node: StructuredNode = { tag };
  if (value['style'] !== undefined) {
    const style = validateStyle(value['style'], path);
    if (!style.ok) {
      return style;
    }
    if (Object.keys(style.value).length > 0) {
      node.style = style.value;
    }
  }
  if (value['lang'] !== undefined) {
    const lang = value['lang'];
    if (typeof lang !== 'string' || !LANG_PATTERN.test(lang)) {
      return { ok: false, reason: `\`lang\` pada ${path} tidak valid` };
    }
    node.lang = lang;
  }
  if (value['data'] !== undefined) {
    const data = value['data'];
    if (!isPlainObject(data)) {
      return { ok: false, reason: `\`data\` pada ${path} harus berupa objek` };
    }
    for (const key of Object.keys(data)) {
      if (key !== 'content') {
        return { ok: false, reason: `\`data.${key}\` pada ${path} tidak didukung` };
      }
    }
    const role = data['content'];
    if (role !== undefined) {
      if (typeof role !== 'string' || !ROLE_PATTERN.test(role)) {
        return { ok: false, reason: `\`data.content\` pada ${path} tidak valid` };
      }
      node.data = { content: role };
    }
  }
  if (value['title'] !== undefined) {
    const title = checkText(value['title'], `title (${path})`, MAX_TITLE_CODE_POINTS);
    if (!title.ok) {
      return title;
    }
    node.title = title.value;
  }
  for (const [key, attribute] of [['colSpan', 'colSpan'], ['rowSpan', 'rowSpan']] as const) {
    if (value[key] === undefined) {
      continue;
    }
    const span = value[key];
    if (typeof span !== 'number' || !Number.isInteger(span) || span < 1 || span > MAX_SPAN) {
      return { ok: false, reason: `\`${attribute}\` pada ${path} harus bilangan bulat 1–${MAX_SPAN}` };
    }
    node[key] = span;
  }
  if (isMedia) {
    const media = validateMediaAttributes(value, path);
    if (!media.ok) {
      return media;
    }
    Object.assign(node, media.value);
  }
  if (!Object.hasOwn(TAGS_WITHOUT_CONTENT, tag) && value['content'] !== undefined) {
    const content = validateContent(value['content'], depth + 1, budget, path);
    if (!content.ok) {
      return content;
    }
    node.content = content.value;
  }
  return { ok: true, value: node };
}

/** Atribut `img` yang tersimpan setelah validasi. */
export interface MediaAttributes {
  /** Jalur relatif di dalam kamus. */
  path: string;
  width?: number | 'auto';
  height?: number | 'auto';
  sizeUnits?: StructuredNode['sizeUnits'];
  appearance?: StructuredNode['appearance'];
  pixelated?: boolean;
  alt?: string;
  verticalAlign?: string;
}

/**
 * Validasi atribut khusus gambar (`img`).
 *
 * `path` wajib dan harus jalur relatif di dalam kamus: renderer tidak pernah menerima
 * URL dari dataset, jadi gambar hanya bisa berasal dari berkas kamus itu sendiri.
 */
function validateMediaAttributes(
  value: Record<string, unknown>,
  path: string,
): StructuredResult<MediaAttributes> {
  const result: Partial<MediaAttributes> = {};
  const rawPath = value['path'];
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return { ok: false, reason: `\`path\` pada ${path} wajib diisi untuk tag \`img\`` };
  }
  const checkedPath = checkText(rawPath, `path (${path})`, IMPORT_LIMITS.maxMediaPathCodePoints);
  if (!checkedPath.ok) {
    return checkedPath;
  }
  if (!MEDIA_PATH_PATTERN.test(checkedPath.value)) {
    return { ok: false, reason: `\`path\` pada ${path} harus jalur relatif di dalam kamus` };
  }
  result.path = checkedPath.value;

  for (const field of ['width', 'height'] as const) {
    const raw = value[field];
    if (raw === undefined) {
      continue;
    }
    if (raw === 'auto') {
      result[field] = 'auto';
      continue;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MEDIA_SIZE_LIMIT) {
      return {
        ok: false,
        reason: `\`${field}\` pada ${path} harus bilangan 0–${MEDIA_SIZE_LIMIT} atau \`auto\``,
      };
    }
    result[field] = raw;
  }
  if (value['sizeUnits'] !== undefined) {
    const units = value['sizeUnits'];
    if (typeof units !== 'string' || !SIZE_UNITS_PATTERN.test(units)) {
      return { ok: false, reason: `\`sizeUnits\` pada ${path} tidak didukung` };
    }
    result.sizeUnits = units as StructuredNode['sizeUnits'];
  }
  if (value['appearance'] !== undefined) {
    const appearance = value['appearance'];
    if (typeof appearance !== 'string' || !APPEARANCE_PATTERN.test(appearance)) {
      return { ok: false, reason: `\`appearance\` pada ${path} tidak didukung` };
    }
    result.appearance = appearance as StructuredNode['appearance'];
  }
  if (value['pixelated'] !== undefined) {
    if (typeof value['pixelated'] !== 'boolean') {
      return { ok: false, reason: `\`pixelated\` pada ${path} harus boolean` };
    }
    result.pixelated = value['pixelated'];
  }
  if (value['verticalAlign'] !== undefined) {
    const align = value['verticalAlign'];
    if (typeof align !== 'string' || !VERTICAL_ALIGN_PATTERN.test(align)) {
      return { ok: false, reason: `\`verticalAlign\` pada ${path} tidak didukung` };
    }
    result.verticalAlign = align;
  }
  if (value['alt'] !== undefined) {
    const alt = checkText(value['alt'], `alt (${path})`, MAX_TITLE_CODE_POINTS);
    if (!alt.ok) {
      return alt;
    }
    result.alt = alt.value;
  }
  return { ok: true, value: result as MediaAttributes };
}

/**
 * Validasi satu item `definitions`.
 *
 * `allowNodes` diambil dari `schemaVersion` header: v1 hanya menerima string, v2
 * menerima string atau simpul structured content.
 */
export function validateDefinitionItem(value: unknown, allowNodes: boolean): StructuredResult<DefinitionItem> {
  if (typeof value === 'string') {
    const text = checkText(value, 'definitions', IMPORT_LIMITS.maxStringCodePoints);
    if (!text.ok) {
      return text;
    }
    return { ok: true, value: text.value };
  }
  if (!allowNodes) {
    return {
      ok: false,
      reason: 'field `definitions` harus berupa array string pada schemaVersion 1; gunakan `schemaVersion: 2` untuk structured content',
    };
  }
  return validateNode(value, 1, { nodes: 0 }, 'definitions');
}

/** True bila item definisi memuat simpul structured content. */
export function isStructuredDefinition(item: DefinitionItem): item is StructuredNode {
  return typeof item !== 'string';
}

/**
 * Teks datar dari satu definisi (tanpa markup). Dipakai untuk estimasi ukuran,
 * pengukuran dataset, dan pengujian; renderer tetap memakai struktur aslinya.
 */
export function structuredText(item: DefinitionItem): string {
  const parts: string[] = [];
  const walk = (value: StructuredContent | undefined): void => {
    if (value === undefined) {
      return;
    }
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        walk(child);
      }
      return;
    }
    const node = value as StructuredNode;
    // `rt`/`rp` adalah bacaan furigana, bukan bagian teks definisi.
    if (node.tag === 'rt' || node.tag === 'rp') {
      return;
    }
    walk(node.content);
  };
  walk(item);
  return parts.join('').replace(/\s+/gu, ' ').trim();
}

/** Jumlah potongan teks hasil perataan (tanpa pembersihan spasi). */
export function structuredTextLength(item: DefinitionItem): number {
  const text = structuredText(item);
  return text.length;
}
