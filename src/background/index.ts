/**
 * Service worker Shirabe (PRD 6.1).
 *
 * Worker ini stateless: setiap pesan mandiri, state penting tersimpan di
 * IndexedDB dan `chrome.storage.local`, dan pekerjaan panjang (impor) dikendalikan
 * dari halaman settings yang juga melaporkan progresnya.
 */

import {
  isProgressMessage,
  validateEnvelope,
  errorResponse,
  okResponse,
  ProtocolError,
  type ErrorCode,
  type MessageError,
  type MessageType,
  type ResponseEnvelope,
} from '../messaging/protocol.js';
import { sweepLeftovers } from '../data/imports.js';
import { StorageError } from '../data/db.js';
import {
  assertSenderAllowed,
  getHandler,
  isContentScriptSender,
  noteCleanedImports,
} from './handlers.js';
import { originFromUrl } from '../core/site.js';


const CONTEXT_MENU_ID = 'shirabe-lookup-selection';

/** Jalankan pembersihan staging yang ditinggalkan proses sebelumnya. */
async function runStartupSweep(): Promise<void> {
  try {
    const cleaned = await sweepLeftovers();
    noteCleanedImports(cleaned);
  } catch {
    // Pembersihan best-effort; staging tidak pernah dipakai untuk lookup.
  }
}

function ensureContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: CONTEXT_MENU_ID,
        title: 'Cari dengan Shirabe',
        contexts: ['selection'],
      },
      () => {
        // `lastError` muncul bila menu sudah ada; tidak perlu ditangani.
        void chrome.runtime.lastError;
      },
    );
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
  void runStartupSweep();
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
  void runStartupSweep();
});

/** Pesan dari konteks lain (mis. broadcast progres) bukan urusan service worker. */
function isEnvelopeCandidate(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('v' in value) || value.v !== 1) {
    return false;
  }
  if (!('type' in value) || typeof value.type !== 'string') {
    return false;
  }
  return 'id' in value && typeof value.id === 'string';
}

function envelopeIdOf(value: unknown): string {
  return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
    ? value.id
    : 'unknown';
}

async function dispatch(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  isContentScript: boolean,
): Promise<ResponseEnvelope> {
  const validation = validateEnvelope(message);
  if (!validation.ok) {
    return errorResponse(envelopeIdOf(message), {
      code: validation.code,
      message: validation.message,
    });
  }
  const envelope = validation.value;
  const context = {
    sender,
    isContentScript,
    // Untuk content script di iframe, cek pengecualian berdasarkan URL frame,
    // bukan URL tab top-level.
    tabOrigin: originFromUrl(isContentScript ? sender.url : sender.tab?.url),
  };
  try {
    assertSenderAllowed(envelope.type as MessageType, context);
    const handler = getHandler(envelope.type as MessageType);
    const data = await (handler as (payload: unknown, ctx: unknown) => Promise<unknown>)(
      envelope.payload,
      context,
    );
    return okResponse(envelope.id, data as never);
  } catch (error) {
    return errorResponse(envelope.id, toMessageError(error));
  }
}

function toMessageError(error: unknown): MessageError {
  return { code: codeOf(error), message: describe(error) };
}

function codeOf(error: unknown): ErrorCode {
  if (error instanceof ProtocolError) {
    return error.code;
  }
  if (error instanceof StorageError) {
    return error.code;
  }
  return 'INTERNAL';
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Terjadi kesalahan internal.';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isProgressMessage(message)) {
    // Progres impor ditujukan ke halaman settings, bukan ke service worker.
    return undefined;
  }
  if (!isEnvelopeCandidate(message)) {
    return undefined;
  }
  void dispatch(message, sender, isContentScriptSender(sender)).then(sendResponse, (error: unknown) => {
    sendResponse(errorResponse('unknown', toMessageError(error)));
  });
  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) {
    return;
  }
  const query = typeof info.selectionText === 'string' ? info.selectionText.trim() : '';
  if (query.length === 0) {
    return;
  }
  void openSelectionLookup(query, tab, info.frameId);
});

/**
 * Tampilkan popup lookup dari menu konteks.
 * Bila content script tidak tersedia (situs belum diaktifkan), buka halaman
 * pencarian Shirabe sebagai jalur yang tetap berfungsi.
 */
async function openSelectionLookup(
  query: string,
  tab: chrome.tabs.Tab | undefined,
  frameId?: number,
): Promise<void> {
  const tabId = tab?.id;
  if (tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(
        tabId,
        {
          v: 1,
          id: crypto.randomUUID(),
          type: 'SHOW_LOOKUP',
          payload: { query, source: 'context-menu' },
        },
        frameId === undefined ? undefined : { frameId },
      );
      return;
    } catch {
      // Lanjut ke halaman pencarian.
    }
  }
  const url = `${chrome.runtime.getURL('search.html')}?q=${encodeURIComponent(query)}`;
  await chrome.tabs.create({ url });
}

// Pembersihan juga dijalankan saat service worker pertama kali dibangun kembali
// setelah browser menghentikannya (mis. setelah idle).
void runStartupSweep();
