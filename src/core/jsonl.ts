/**
 * Format dataset Shirabe JSONL (PRD 8.1).
 *
 * Baris pertama adalah header metadata, baris berikutnya satu objek entry per baris.
 * Modul ini murni: parsing + validasi saja, tanpa I/O, supaya dapat dipakai oleh
 * UI impor, service worker, dan pengujian tanpa browser.
 *
 * Versi schema:
 * - **v1** — `definitions` hanya array string (plain text).
 * - **v2** — `definitions` boleh berisi string atau simpul structured content yang
 *   sudah divalidasi (tabel bentuk kata, daftar catatan/rujukan). Lihat `structured.ts`.
 */

import { IMPORT_LIMITS } from './limits.js';
import {
  CONTROL_CHARS,
  HTML_MARKUP,
  validateDefinitionItem,
  type DefinitionItem,
} from './structured.js';
import { codePointLength } from './text.js';

/** Versi schema terbaru (ditulis konverter/ekspor Shirabe). */
export const SCHEMA_VERSION = 2;
/** Versi schema yang masih dapat dibaca. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2];
/** Label daftar versi untuk teks UI (mis. `1–2`). */
export const SCHEMA_VERSION_LABEL = SUPPORTED_SCHEMA_VERSIONS.join('–');
export const HEADER_TYPE = 'shirabe-dictionary';
export const DICTIONARY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface DictionaryHeader {
  type: typeof HEADER_TYPE;
  schemaVersion: number;
  id: string;
  name: string;
  language: string;
  definitionLanguage: string;
  license: string;
  attribution: string;
}

/** Entry yang sudah tervalidasi dan dinormalisasi untuk indeks. */
export interface ParsedEntry {
  expression: string;
  reading: string;
  definitions: DefinitionItem[];
  partOfSpeech: string[];
  tags: string[];
  rules: string[];
  /**
   * Prioritas/frekuensi entry (nilai lebih besar = lebih umum). Tidak ada pada schema
   * JSONL v1; diisi oleh importer Yomitan dari field `score` sumber dan hanya dipakai
   * sebagai tie-break ranking.
   */
  priority?: number;
}

export interface ParseOk<T> {
  ok: true;
  value: T;
  warnings: string[];
}

export interface ParseFailure {
  ok: false;
  reason: string;
}

export type ParseResult<T> = ParseOk<T> | ParseFailure;

function invalid(reason: string): ParseFailure {
  return { ok: false, reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validasi satu string teks dari dataset.
 * Dataset MVP hanya berisi plain text: markup HTML ditolak (PRD 8.1, 13).
 */
function checkText(value: unknown, field: string, allowEmpty = false): string | ParseFailure {
  if (typeof value !== 'string') {
    return invalid(`field \`${field}\` harus berupa string`);
  }
  const text = value.trim();
  if (!allowEmpty && text.length === 0) {
    return invalid(`field \`${field}\` tidak boleh kosong`);
  }
  if (codePointLength(text) > IMPORT_LIMITS.maxStringCodePoints) {
    return invalid(
      `field \`${field}\` melebihi batas ${IMPORT_LIMITS.maxStringCodePoints} code point`,
    );
  }
  if (CONTROL_CHARS.test(text)) {
    return invalid(`field \`${field}\` mengandung karakter kontrol yang tidak didukung`);
  }
  if (HTML_MARKUP.test(text)) {
    return invalid(`field \`${field}\` mengandung markup HTML; dataset harus plain text`);
  }
  return text;
}

/** Validasi array string opsional (partOfSpeech/tags/rules). */
function checkStringArray(
  value: unknown,
  field: string,
  maxItems: number,
): string[] | ParseFailure {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return invalid(`field \`${field}\` harus berupa array string`);
  }
  if (value.length > maxItems) {
    return invalid(`field \`${field}\` melebihi batas ${maxItems} item`);
  }
  const items: string[] = [];
  for (const item of value) {
    const text = checkText(item, field);
    if (typeof text !== 'string') {
      return text;
    }
    if (!items.includes(text)) {
      items.push(text);
    }
  }
  return items;
}

/** Parsing + validasi baris header (baris pertama file). */
export function parseHeader(line: string): ParseResult<DictionaryHeader> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    return invalid(`header bukan JSON valid: ${(error as Error).message}`);
  }
  if (!isPlainObject(value)) {
    return invalid('header harus berupa objek JSON');
  }
  if (value['type'] !== HEADER_TYPE) {
    return invalid(`header harus memiliki \`type: "${HEADER_TYPE}"\``);
  }
  const schemaVersion = value['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    return invalid('field `schemaVersion` harus berupa bilangan bulat');
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    return invalid(
      `versi schema ${schemaVersion} tidak didukung; versi yang didukung: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
    );
  }

  const id = checkText(value['id'], 'id');
  if (typeof id !== 'string') {
    return id;
  }
  if (!DICTIONARY_ID_PATTERN.test(id)) {
    return invalid('field `id` hanya boleh berisi huruf, angka, titik, garis bawah, dan tanda hubung');
  }
  const name = checkText(value['name'], 'name');
  if (typeof name !== 'string') {
    return name;
  }

  const warnings: string[] = [];
  const language = checkText(value['language'] ?? 'ja', 'language');
  if (typeof language !== 'string') {
    return language;
  }
  const definitionLanguage = checkText(value['definitionLanguage'] ?? 'id', 'definitionLanguage');
  if (typeof definitionLanguage !== 'string') {
    return definitionLanguage;
  }
  const license = checkText(value['license'] ?? '', 'license', true);
  if (typeof license !== 'string') {
    return license;
  }
  const attribution = checkText(value['attribution'] ?? '', 'attribution', true);
  if (typeof attribution !== 'string') {
    return attribution;
  }
  if (license.length === 0) {
    warnings.push('Header tidak mencantumkan lisensi dataset.');
  }
  if (attribution.length === 0) {
    warnings.push('Header tidak mencantumkan atribusi/sumber dataset.');
  }

  return {
    ok: true,
    warnings,
    value: {
      type: HEADER_TYPE,
      schemaVersion,
      id,
      name,
      language,
      definitionLanguage,
      license,
      attribution,
    },
  };
}

/**
 * Parsing + validasi satu baris entry.
 *
 * `schemaVersion` diambil dari header file sehingga aturan `definitions` mengikuti
 * versi yang dideklarasikan (v1 menolak structured content).
 */
export function parseEntry(line: string, options: EntryValidationOptions = {}): ParseResult<ParsedEntry> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    return invalid(`bukan JSON valid: ${(error as Error).message}`);
  }
  return validateEntryObject(value, options);
}

export interface EntryValidationOptions {
  /** Versi schema dari header; default versi terbaru. */
  schemaVersion?: number;
}

/**
 * Validasi objek entry (hasil JSON parse) terhadap schema Shirabe v1.
 * Dipakai oleh importer JSONL maupun adapter Yomitan, sehingga aturan validasinya
 * hanya ada di satu tempat.
 */
export function validateEntryObject(
  value: unknown,
  options: EntryValidationOptions = {},
): ParseResult<ParsedEntry> {
  if (!isPlainObject(value)) {
    return invalid('entry harus berupa objek JSON');
  }
  const schemaVersion = options.schemaVersion ?? SCHEMA_VERSION;
  const allowStructured = schemaVersion >= 2;

  const expression = checkText(value['expression'], 'expression');
  if (typeof expression !== 'string') {
    return expression;
  }

  const readingRaw = value['reading'];
  const reading = readingRaw === undefined || readingRaw === null
    ? ''
    : checkText(readingRaw, 'reading', true);
  if (typeof reading !== 'string') {
    return reading;
  }

  const definitionsRaw = value['definitions'];
  if (!Array.isArray(definitionsRaw)) {
    return invalid('field `definitions` harus berupa array definisi (string atau simpul structured content)');
  }
  if (definitionsRaw.length === 0) {
    return invalid('field `definitions` tidak boleh kosong');
  }
  if (definitionsRaw.length > IMPORT_LIMITS.maxDefinitionsPerEntry) {
    return invalid(
      `field \`definitions\` melebihi batas ${IMPORT_LIMITS.maxDefinitionsPerEntry} definisi`,
    );
  }
  const definitions: DefinitionItem[] = [];
  for (const item of definitionsRaw) {
    const checked = validateDefinitionItem(item, allowStructured);
    if (!checked.ok) {
      return invalid(checked.reason);
    }
    definitions.push(checked.value);
  }

  const partOfSpeech = checkStringArray(
    value['partOfSpeech'],
    'partOfSpeech',
    IMPORT_LIMITS.maxTagsPerEntry,
  );
  if (!Array.isArray(partOfSpeech)) {
    return partOfSpeech;
  }
  const tags = checkStringArray(value['tags'], 'tags', IMPORT_LIMITS.maxTagsPerEntry);
  if (!Array.isArray(tags)) {
    return tags;
  }
  const rules = checkStringArray(value['rules'], 'rules', IMPORT_LIMITS.maxTagsPerEntry);
  if (!Array.isArray(rules)) {
    return rules;
  }

  return {
    ok: true,
    warnings: [],
    value: {
      expression,
      reading,
      definitions,
      partOfSpeech,
      tags,
      rules,
    },
  };
}

/** Pisahkan satu potongan teks menjadi baris-baris utuh, mengembalikan sisa buffer. */
export function splitLines(chunk: string): { lines: string[]; rest: string } {
  const parts = chunk.split(/\r\n|\n|\r/);
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}
