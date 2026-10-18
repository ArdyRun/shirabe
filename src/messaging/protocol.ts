/**
 * Protokol pesan antar-komponen (PRD 6.2).
 *
 * Semua pesan memakai envelope berversi `{ v, id, type, payload }` dan balasan
 * `{ v, id, response }`. Content script diperlakukan sebagai sumber yang tidak
 * dipercaya: tipe pesan dibatasi, payload divalidasi, dan tidak ada nama object
 * store, HTML, atau instruksi kode yang diterima dari halaman.
 */

import type { DictionaryHeader } from '../core/jsonl.js';
import type { Preferences, SitePreference, WritablePreferenceKey } from '../core/preferences.js';
import type { LookupResult } from '../core/types.js';
import type { DictionarySummary, ImportPhase, StorageInfo } from '../data/schema.js';

export const MESSAGE_VERSION = 1;

/** Batas ukuran payload pesan (JSON) untuk mencegah pesan raksasa dari halaman. */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

export type LookupSourceKind = 'hover' | 'selection' | 'manual' | 'kanji' | 'context-menu';

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ImportBeginData {
  status: 'started' | 'needs-confirm';
  importId: string | null;
  /** Versi dataset staging; dipakai halaman impor untuk menulis data turunan kamus. */
  version: string | null;
  /** Kamus existing dengan ID sama, diisi pada status `needs-confirm`. */
  existing: DictionarySummary | null;
}

export interface DictionariesData {
  dictionaries: DictionarySummary[];
  storage: StorageInfo;
  /** Job impor yang ditinggalkan proses sebelumnya dan sudah dibersihkan. */
  cleanedImports: number;
}

export interface SettingsData {
  preferences: Preferences;
}

export interface SitesData {
  /** Pengecualian per origin (`enabled: false` = pemindaian dimatikan di sana). */
  sites: Record<string, SitePreference>;
  /** Pemindaian di semua situs http/https. */
  scanAllSites: boolean;
  /** Origin yang pemindaiannya dimatikan, terurut, untuk ditampilkan di pengaturan. */
  disabledOrigins: string[];
}

export interface SelectionData {
  text: string;
  rect: RectLike | null;
}

interface MessageMap {
  PING: {
    request: Record<string, never>;
    response: { version: string; schemaVersion: number; build: string };
  };
  LOOKUP: {
    request: {
      query: string;
      source: LookupSourceKind;
      maxResults?: number;
      /** Posisi kursor di dalam kueri (code point) untuk lookup dari halaman. */
      caretOffset?: number | null;
    };
    response: LookupResult;
  };
  /**
   * Byte berkas media kamus (gambar) untuk dirender popup.
   *
   * Sumber tidak dipercaya, jadi jalurnya bukan URL: background membacanya dari store
   * `media` kamus yang bersangkutan dan mengembalikan data URL, atau `null` bila tidak ada.
   */
  GET_MEDIA: {
    request: { dictionaryId: string; path: string };
    response: { dataUrl: string | null };
  };
  GET_SELECTION: { request: Record<string, never>; response: SelectionData };
  SHOW_LOOKUP: {
    request: { query: string; source: LookupSourceKind };
    response: { shown: boolean };
  };
  SETTINGS_GET: { request: { keys?: WritablePreferenceKey[] }; response: SettingsData };
  SETTINGS_SET: {
    request: { changes: Partial<Record<WritablePreferenceKey, unknown>> };
    response: SettingsData;
  };
  SITES_GET: { request: Record<string, never>; response: SitesData };
  SITE_SCAN_ENABLE: { request: { origin: string }; response: SitesData };
  SITE_SCAN_DISABLE: { request: { origin: string }; response: SitesData };
  DICTIONARIES_GET: {
    request: { includeStorage?: boolean };
    response: DictionariesData;
  };
  DICTIONARY_ENABLE: {
    request: { id: string; enabled: boolean };
    response: DictionariesData;
  };
  DICTIONARY_REORDER: { request: { ids: string[] }; response: DictionariesData };
  DICTIONARY_DELETE: { request: { id: string }; response: DictionariesData };
  IMPORT_BEGIN: {
    request: {
      fileName: string;
      fileSize: number;
      header: DictionaryHeader;
      replace: boolean;
    };
    response: ImportBeginData;
  };
  /**
   * Selesaikan impor. Data turunan kamus (kanji/meta/media) ditulis langsung oleh
   * halaman pengaturan (origin extension yang sama), lalu jumlahnya dilaporkan di sini
   * supaya metadata kamus memuat ringkasan isinya.
   */
  IMPORT_COMMIT: {
    request: {
      importId: string;
      aux?: { kanjiCount: number; metaCount: number; mediaCount: number; mediaBytes: number };
    };
    response: DictionariesData;
  };
  IMPORT_ABORT: { request: { importId: string }; response: { aborted: boolean } };
}

export type MessageType = keyof MessageMap;
export type RequestPayload<K extends MessageType> = MessageMap[K]['request'];
export type ResponseData<K extends MessageType> = MessageMap[K]['response'];

export type ExtensionMessage = {
  [K in MessageType]: {
    v: typeof MESSAGE_VERSION;
    id: string;
    type: K;
    payload: RequestPayload<K>;
  };
}[MessageType];

/** Pesan progres impor dari service worker ke halaman settings. */
export interface ImportProgressMessage {
  v: typeof MESSAGE_VERSION;
  id: string;
  type: 'IMPORT_PROGRESS';
  payload: {
    importId: string;
    phase: ImportPhase;
    linesRead: number;
    entriesWritten: number;
    failure?: { line?: number; reason: string };
  };
}

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'UNKNOWN_TYPE'
  | 'INVALID_PAYLOAD'
  | 'FORBIDDEN_SENDER'
  | 'NO_PERMISSION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IMPORT_FAILED'
  | 'STORAGE_QUOTA'
  | 'STORAGE_ERROR'
  /**
   * Konteks extension sudah tidak berlaku: halaman dibuat sebelum extension dimuat
   * ulang/di-update, sehingga content script di halaman itu tidak bisa menghubungi
   * service worker lagi. Halaman perlu dimuat ulang.
   */
  | 'CONTEXT_INVALIDATED'
  | 'INTERNAL';

export interface MessageError {
  code: ErrorCode;
  message: string;
}

/**
 * Deteksi kegagalan `chrome.runtime.sendMessage` karena konteks extension sudah mati.
 *
 * Chrome melempar pesan seperti "Extension context invalidated." (halaman lama setelah
 * extension dimuat ulang) atau "Could not establish connection. Receiving end does not
 * exist." (tidak ada penerima). Keduanya bukan kesalahan internal program, melainkan
 * keadaan yang harus dijelaskan ke pengguna.
 */
export function isExtensionContextInvalidated(error: unknown): boolean {
  if (typeof chrome !== 'undefined' && chrome.runtime?.id === undefined) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return /extension context invalidated|receiving end does not exist|message port closed/i.test(
    error.message,
  );
}

export type ResponseEnvelope<K extends MessageType = MessageType> =
  | {
      v: typeof MESSAGE_VERSION;
      id: string;
      response: { ok: true; data: ResponseData<K> };
    }
  | {
      v: typeof MESSAGE_VERSION;
      id: string;
      response: { ok: false; error: MessageError };
    };

export const MESSAGE_TYPES: readonly MessageType[] = [
  'PING',
  'LOOKUP',
  'GET_MEDIA',
  'GET_SELECTION',
  'SHOW_LOOKUP',
  'SETTINGS_GET',
  'SETTINGS_SET',
  'SITES_GET',
  'SITE_SCAN_ENABLE',
  'SITE_SCAN_DISABLE',
  'DICTIONARIES_GET',
  'DICTIONARY_ENABLE',
  'DICTIONARY_REORDER',
  'DICTIONARY_DELETE',
  'IMPORT_BEGIN',
  'IMPORT_COMMIT',
  'IMPORT_ABORT',
];

/**
 * Pesan yang boleh dikirim oleh content script (sumber tidak dipercaya).
 * Content script sengaja hanya bisa meminta lookup: preferensi dibacanya
 * langsung dari `chrome.storage.local`, dan pengelolaan kamus/izin hanya
 * tersedia dari halaman extension milik Shirabe.
 */
export const CONTENT_SCRIPT_MESSAGE_TYPES: readonly MessageType[] = ['LOOKUP', 'GET_MEDIA'];

/** Halaman extension milik Shirabe boleh mengirim seluruh tipe pesan. */
export function isContentScriptMessageType(type: MessageType): boolean {
  return CONTENT_SCRIPT_MESSAGE_TYPES.includes(type);
}

/** Kesalahan protokol dengan kode yang dikirim kembali ke pemanggil. */
export class ProtocolError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

export interface ValidationFailure {
  ok: false;
  code: ErrorCode;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | ValidationFailure;

function fail(code: ErrorCode, message: string): ValidationFailure {
  return { ok: false, code, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validasi envelope pesan yang datang dari `chrome.runtime.onMessage`. */
export function validateEnvelope(value: unknown): ValidationResult<ExtensionMessage> {
  if (!isPlainObject(value)) {
    return fail('INVALID_MESSAGE', 'Pesan harus berupa objek.');
  }
  if (value['v'] !== MESSAGE_VERSION) {
    return fail('INVALID_MESSAGE', `Versi pesan tidak didukung: ${String(value['v'])}.`);
  }
  const id = value['id'];
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
    return fail('INVALID_MESSAGE', 'ID pesan tidak valid.');
  }
  const type = value['type'];
  if (typeof type !== 'string') {
    return fail('INVALID_MESSAGE', 'Tipe pesan harus berupa string.');
  }
  if (!(MESSAGE_TYPES as readonly string[]).includes(type)) {
    return fail('UNKNOWN_TYPE', `Tipe pesan tidak dikenal: ${type}.`);
  }
  if (!isPlainObject(value['payload'])) {
    return fail('INVALID_PAYLOAD', 'Payload pesan harus berupa objek.');
  }
  const serialized = safeStringify(value);
  if (serialized === null || serialized.length > MAX_MESSAGE_BYTES) {
    return fail('INVALID_PAYLOAD', 'Payload pesan terlalu besar.');
  }
  return { ok: true, value: value as ExtensionMessage };
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function requestId(): string {
  return crypto.randomUUID();
}

/** Bentuk envelope pesan untuk dikirim lewat `chrome.runtime.sendMessage`. */
export function buildMessage<K extends MessageType>(
  type: K,
  payload: RequestPayload<K>,
): ExtensionMessage {
  return { v: MESSAGE_VERSION, id: requestId(), type, payload } as ExtensionMessage;
}

export function buildProgressMessage(payload: ImportProgressMessage['payload']): ImportProgressMessage {
  return { v: MESSAGE_VERSION, id: requestId(), type: 'IMPORT_PROGRESS', payload };
}

export function okResponse<K extends MessageType>(id: string, data: ResponseData<K>): ResponseEnvelope<K> {
  return { v: MESSAGE_VERSION, id, response: { ok: true, data } };
}

export function errorResponse(id: string, error: MessageError): ResponseEnvelope {
  return { v: MESSAGE_VERSION, id, response: { ok: false, error } };
}

export function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
  return (
    isPlainObject(value) &&
    value['v'] === MESSAGE_VERSION &&
    typeof value['id'] === 'string' &&
    isPlainObject(value['response']) &&
    typeof (value['response'] as Record<string, unknown>)['ok'] === 'boolean'
  );
}

export function isProgressMessage(value: unknown): value is ImportProgressMessage {
  return isPlainObject(value) && value['type'] === 'IMPORT_PROGRESS' && value['v'] === MESSAGE_VERSION;
}
