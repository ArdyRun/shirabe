/**
 * Web Worker impor: menjalankan `importFiles` untuk satu berkas per giliran.
 *
 * Tujuannya murni paralelisme CPU: parse JSON + konversi bank + validasi structured content
 * adalah 65–74% waktu impor dan berjalan di thread utama halaman (`docs/mvp-audit.md` §4.27).
 * Logika impor tidak diduplikasi — worker memanggil jalur yang sama dengan halaman.
 *
 * Akses `chrome.*` tidak tersedia di Web Worker, jadi setiap permintaan ke service worker
 * dan dialog konfirmasi penggantian kamus diteruskan ke halaman lewat `postMessage`.
 */

import { importFiles, importProgressPercent, setImportRequestHandler } from './importer.js';
import { setLanguage } from '../ui/strings.js';
import type { DictionarySummary } from '../data/schema.js';
import type { MessageType, RequestPayload } from '../messaging/protocol.js';
import type { PageMessage, WorkerMessage } from './import-worker-protocol.js';

type CallArgs =
  | { kind: 'request'; messageType: MessageType; payload: RequestPayload<MessageType> }
  | { kind: 'confirm'; fileName: string; existing: unknown };

const port = globalThis as unknown as {
  postMessage(message: WorkerMessage): void;
  onmessage: ((event: MessageEvent<PageMessage>) => void) | null;
};

let slot = 0;
let cancelled = false;
let nextCallId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function call(message: CallArgs): Promise<unknown> {
  const id = nextCallId;
  nextCallId += 1;
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  pending.set(id, { resolve, reject });
  port.postMessage({ ...message, type: 'call', slot, id } as WorkerMessage);
  return promise;
}

setImportRequestHandler(async (messageType, payload) =>
  (await call({ kind: 'request', messageType, payload })) as never,
);

port.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'reply') {
    const entry = pending.get(message.id);
    if (entry === undefined) {
      return;
    }
    pending.delete(message.id);
    if (message.ok) {
      entry.resolve(message.data);
    } else {
      const error = new Error(message.message);
      error.name = 'ImportRequestFailed';
      entry.reject(error);
    }
    return;
  }
  if (message.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (message.type !== 'run') {
    return;
  }
  slot = message.slot;
  cancelled = false;
  setLanguage(message.language);
  void run(message.file);
};

async function run(file: File): Promise<void> {
  try {
    const results = await importFiles([file], {
      isCancelled: () => cancelled,
      confirmReplace: async (existing: DictionarySummary, fileName: string) =>
        (await call({ kind: 'confirm', fileName, existing })) === true,
      onProgress: (update) => {
        port.postMessage({
          type: 'progress',
          slot,
          update,
          percent: importProgressPercent(update),
        });
      },
    });
    const result = results[0];
    if (result === undefined) {
      port.postMessage({ type: 'failed', slot, message: 'Impor tidak menghasilkan laporan.' });
      return;
    }
    port.postMessage({ type: 'done', slot, result });
  } catch (error) {
    port.postMessage({
      type: 'failed',
      slot,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
