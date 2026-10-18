/**
 * Handler pesan service worker (PRD 6.2).
 *
 * Service worker adalah router tipis: setiap handler mandiri, membuka kembali
 * koneksi IndexedDB yang diperlukan, dan tidak bergantung pada variabel global
 * yang bertahan antar-restart.
 */

import {
  SCHEMA_VERSION,
  DICTIONARY_ID_PATTERN,
  parseHeader,
  type DictionaryHeader,
} from '../core/jsonl.js';
import { IMPORT_LIMITS } from '../core/limits.js';
import { lookup } from '../core/search.js';
import { originFromUrl } from '../core/site.js';
import { MEDIA_PATH_PATTERN } from '../core/structured.js';
import type { LookupResult } from '../core/types.js';
import {
  getDictionaryRecord,
  getStorageInfo,
  listDictionarySummaries,
  reorderDictionaries,
  setDictionaryEnabled,
  deleteDictionary,
} from '../data/dictionaries.js';
import { createLookupSource } from '../data/entries.js';
import { getMediaRecord } from '../data/media.js';
import {
  abortImport,
  beginImport,
  commitImport,
} from '../data/imports.js';
import {
  ProtocolError,
  buildProgressMessage,
  isContentScriptMessageType,
  type ImportProgressMessage,
  type DictionariesData,
  type LookupSourceKind,
  type MessageType,
  type RequestPayload,
  type ResponseData,
  type SitesData,
} from '../messaging/protocol.js';
import { getPreferences, updatePreferences } from './settings.js';
import { disableSiteScan, enableSiteScan, listDisabledOrigins } from './sites.js';

export interface MessageContext {
  sender: chrome.runtime.MessageSender;
  isContentScript: boolean;
  tabOrigin: string | null;
}

type Handler<K extends MessageType> = (
  payload: RequestPayload<K>,
  context: MessageContext,
) => Promise<ResponseData<K>>;

/** Job impor yang dibersihkan pada startup service worker (ditampilkan di UI). */
let cleanedImports = 0;
export function noteCleanedImports(count: number): void {
  cleanedImports = count;
}

function requireString(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ProtocolError('INVALID_PAYLOAD', `Field \`${field}\` tidak valid.`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProtocolError('INVALID_PAYLOAD', `Field \`${field}\` tidak valid.`);
  }
  return value;
}

/** Posisi kursor opsional: bilangan bulat kecil di dalam kueri, atau null. */
function validateCaretOffset(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 512) {
    throw new ProtocolError('INVALID_PAYLOAD', 'Field `caretOffset` tidak valid.');
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ProtocolError('INVALID_PAYLOAD', `Field \`${field}\` tidak valid.`);
  }
  return value;
}

function requireOrigin(value: unknown): string {
  const origin = requireString(value, 'origin', 300);
  if (originFromUrl(`${origin}/`) !== origin) {
    throw new ProtocolError('INVALID_PAYLOAD', 'Origin situs tidak valid.');
  }
  return origin;
}

function requireLookupSource(value: unknown): LookupSourceKind {
  const allowed: readonly LookupSourceKind[] = [
    'hover',
    'selection',
    'manual',
    'kanji',
    'context-menu',
  ];
  if (typeof value !== 'string' || !allowed.includes(value as LookupSourceKind)) {
    throw new ProtocolError('INVALID_PAYLOAD', 'Sumber lookup tidak dikenal.');
  }
  return value as LookupSourceKind;
}


function requireHeader(value: unknown): DictionaryHeader {
  const parsed = parseHeader(JSON.stringify(value));
  if (!parsed.ok) {
    throw new ProtocolError('INVALID_PAYLOAD', `Header dataset tidak valid: ${parsed.reason}`);
  }
  return parsed.value;
}

async function sitesData(): Promise<SitesData> {
  const preferences = await getPreferences();
  return {
    sites: preferences.sites,
    scanAllSites: preferences.scanAllSites,
    disabledOrigins: await listDisabledOrigins(),
  };
}

async function dictionariesData(): Promise<DictionariesData> {
  const [dictionaries, storage] = await Promise.all([listDictionarySummaries(), getStorageInfo()]);
  return { dictionaries, storage, cleanedImports };
}

/** Interval minimum antar pesan progres impor ke halaman settings. */
const PROGRESS_INTERVAL_MS = 250;
const lastProgressAt = new Map<string, number>();

/** Siarkan progres impor paling sering sekali per PROGRESS_INTERVAL_MS per job. */
export function reportImportProgress(payload: ImportProgressMessage['payload']): void {
  const now = Date.now();
  const previous = lastProgressAt.get(payload.importId) ?? 0;
  const isFinalPhase = payload.phase === 'committing' || payload.phase === 'failed';
  if (!isFinalPhase && now - previous < PROGRESS_INTERVAL_MS) {
    return;
  }
  lastProgressAt.set(payload.importId, now);
  if (isFinalPhase) {
    lastProgressAt.delete(payload.importId);
  }
  broadcastImportProgress(payload);
}

export function broadcastImportProgress(payload: ImportProgressMessage['payload']): void {
  // Halaman lain mungkin tidak sedang mendengarkan; kegagalan diabaikan.
  void chrome.runtime.sendMessage(buildProgressMessage(payload)).catch(() => undefined);
}

/**
 * Ringkasan isi kamus selain istilah yang dilaporkan halaman impor saat commit.
 *
 * Halaman impor menulis sendiri data turunan (kanji/meta/media) karena berbagi origin
 * extension dengan service worker, jadi jumlahnya harus ikut dikirim di sini agar
 * metadata kamus memuat ringkasan yang benar.
 */
function requireAuxCounts(
  value: unknown,
): { kanjiCount: number; metaCount: number; mediaCount: number; mediaBytes: number } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    throw new ProtocolError('INVALID_PAYLOAD', 'Field `aux` harus berupa objek.');
  }
  const record = value as Record<string, unknown>;
  const count = (field: string): number => {
    const parsed = requireNumber(record[field], `aux.${field}`);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new ProtocolError('INVALID_PAYLOAD', `Field \`aux.${field}\` harus bilangan bulat >= 0.`);
    }
    return parsed;
  };
  return {
    kanjiCount: count('kanjiCount'),
    metaCount: count('metaCount'),
    mediaCount: count('mediaCount'),
    mediaBytes: count('mediaBytes'),
  };
}

/**
 * Byte gambar kamus sebagai data URL.
 *
 * Jalur datang dari halaman, jadi tidak ada URL yang diterima: background hanya membaca
 * store `media` milik kamus yang bersangkutan, dan kamus non-aktif tidak dilayani.
 */
async function handleGetMedia(
  payload: RequestPayload<'GET_MEDIA'>,
): Promise<ResponseData<'GET_MEDIA'>> {
  const dictionaryId = payload.dictionaryId;
  if (typeof dictionaryId !== 'string' || !DICTIONARY_ID_PATTERN.test(dictionaryId)) {
    throw new ProtocolError('INVALID_PAYLOAD', 'Field `dictionaryId` tidak valid.');
  }
  const path = payload.path;
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > IMPORT_LIMITS.maxMediaPathCodePoints ||
    !MEDIA_PATH_PATTERN.test(path)
  ) {
    throw new ProtocolError('INVALID_PAYLOAD', 'Field `path` tidak valid.');
  }
  const dictionary = await getDictionaryRecord(dictionaryId);
  if (dictionary === undefined || dictionary.status !== 'active') {
    return { dataUrl: null };
  }
  const record = await getMediaRecord(dictionaryId, path, dictionary.activeVersion);
  if (record === undefined) {
    return { dataUrl: null };
  }
  const bytes = new Uint8Array(await record.blob.arrayBuffer());
  let binary = '';
  // Potongan 32 KiB: `String.fromCharCode` tidak boleh menerima puluhan ribu argumen.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return { dataUrl: `data:${record.mime};base64,${btoa(binary)}` };
}

async function handleLookup(
  payload: RequestPayload<'LOOKUP'>,
  context: MessageContext,
): Promise<LookupResult> {
  // Kueri kosong/whitespace tetap diterima dan dijawab dengan status `empty-query`
  // supaya pemanggil menerima hasil terstruktur, bukan error payload.
  if (typeof payload.query !== 'string' || payload.query.length > 512) {
    throw new ProtocolError('INVALID_PAYLOAD', 'Field `query` tidak valid.');
  }
  const query = payload.query;
  // Sumber lookup divalidasi tetapi tidak memengaruhi hasil: teks halaman tidak pernah
  // dikirim oleh content script.
  requireLookupSource(payload.source);
  const preferences = await getPreferences();
  if (context.isContentScript) {
    const origin = context.tabOrigin;
    const disabled = origin !== null && preferences.sites[origin]?.enabled === false;
    if (origin === null || disabled || !preferences.scanAllSites) {
      throw new ProtocolError('NO_PERMISSION', 'Pemindaian tidak aktif untuk situs ini.');
    }
  }
  const maxResults =
    payload.maxResults === undefined
      ? preferences.maxResults
      : Math.min(preferences.maxResults, Math.max(1, requireNumber(payload.maxResults, 'maxResults')));
  const caretOffset = validateCaretOffset(payload.caretOffset);
  return lookup(query, createLookupSource(), {
    maxResults,
    readingSearch: preferences.readingSearch,
    caretOffset,
    // Klik kanji pada headword meminta data bank kanji, bukan hanya istilah.
    kanji: payload.source === 'kanji',
  });
}

export const handlers: { [K in MessageType]: Handler<K> } = {
  PING: async () => ({
    version: chrome.runtime.getManifest().version,
    schemaVersion: SCHEMA_VERSION,
    // Identitas build kode yang benar-benar berjalan di service worker.
    build: __BUILD_ID__,
  }),

  LOOKUP: handleLookup,

  GET_MEDIA: handleGetMedia,

  SETTINGS_GET: async () => ({ preferences: await getPreferences() }),

  SETTINGS_SET: async (payload) => {
    if (typeof payload.changes !== 'object' || payload.changes === null) {
      throw new ProtocolError('INVALID_PAYLOAD', 'Field `changes` harus berupa objek.');
    }
    return { preferences: await updatePreferences(payload.changes as Record<string, unknown>) };
  },

  SITES_GET: async (): Promise<SitesData> => sitesData(),

  SITE_SCAN_ENABLE: async (payload): Promise<SitesData> => {
    await enableSiteScan(requireOrigin(payload.origin));
    return sitesData();
  },

  SITE_SCAN_DISABLE: async (payload): Promise<SitesData> => {
    await disableSiteScan(requireOrigin(payload.origin));
    return sitesData();
  },

  DICTIONARIES_GET: async () => dictionariesData(),

  DICTIONARY_ENABLE: async (payload) => {
    const id = requireString(payload.id, 'id', 64);
    await setDictionaryEnabled(id, requireBoolean(payload.enabled, 'enabled'));
    return dictionariesData();
  },

  DICTIONARY_REORDER: async (payload) => {
    if (!Array.isArray(payload.ids) || payload.ids.length > 100) {
      throw new ProtocolError('INVALID_PAYLOAD', 'Field `ids` harus berupa array ID kamus.');
    }
    const ids = payload.ids.map((id) => requireString(id, 'ids', 64));
    await reorderDictionaries(ids);
    return dictionariesData();
  },

  DICTIONARY_DELETE: async (payload) => {
    const id = requireString(payload.id, 'id', 64);
    await deleteDictionary(id);
    return dictionariesData();
  },

  IMPORT_BEGIN: async (payload) => {
    const result = await beginImport({
      fileName: requireString(payload.fileName, 'fileName', 200),
      fileSize: requireNumber(payload.fileSize, 'fileSize'),
      header: requireHeader(payload.header),
      replace: requireBoolean(payload.replace, 'replace'),
    });
    return result;
  },

  IMPORT_COMMIT: async (payload) => {
    const importId = requireString(payload.importId, 'importId', 64);
    try {
      await commitImport(importId, requireAuxCounts(payload.aux));
    } catch (error) {
      reportImportProgress({
        importId,
        phase: 'failed',
        linesRead: 0,
        entriesWritten: 0,
        failure: { reason: error instanceof Error ? error.message : 'Impor gagal.' },
      });
      throw error;
    }
    return dictionariesData();
  },

  IMPORT_ABORT: async (payload) => {
    const importId = requireString(payload.importId, 'importId', 64);
    return { aborted: await abortImport(importId) };
  },

  GET_SELECTION: async () => {
    throw new ProtocolError('FORBIDDEN_SENDER', 'Pesan ini hanya untuk content script.');
  },

  SHOW_LOOKUP: async () => {
    throw new ProtocolError('FORBIDDEN_SENDER', 'Pesan ini hanya untuk content script.');
  },

};

export function getHandler(type: MessageType): Handler<MessageType> {
  return handlers[type] as Handler<MessageType>;
}

/**
 * Benar bila pengirim adalah content script di sebuah halaman web.
 *
 * Halaman extension milik Shirabe juga dapat dibuka di dalam tab, jadi keberadaan
 * `sender.tab` saja tidak cukup: skema URL pengirim dipakai untuk membedakannya
 * (halaman web = http/https, halaman extension = chrome-extension://).
 */
export function isContentScriptSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.tab === undefined) {
    return false;
  }
  const url = sender.url ?? sender.tab.url ?? '';
  return !url.startsWith('chrome-extension://');
}

/** Pesan yang boleh diterima dari content script. */
export function assertSenderAllowed(type: MessageType, context: MessageContext): void {
  if (!context.isContentScript) {
    return;
  }
  if (!isContentScriptMessageType(type)) {
    throw new ProtocolError('FORBIDDEN_SENDER', 'Content script tidak boleh mengirim pesan ini.');
  }
  // Frame web juga memiliki content script statis di manifest; frameId > 0 tetap
  // dipercaya sebagai content script milik kita dan origin-nya dicek per frame.
}
