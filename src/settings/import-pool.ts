/**
 * Impor paralel berbasis Web Worker (halaman pengaturan).
 *
 * Setiap berkas dijalankan oleh worker pada slot yang tersedia; worker memakai jalur impor
 * yang sama (`importFiles`), sehingga data, staging, dan rollback tidak berubah. Halaman
 * hanya: (1) mengantre berkas, (2) meneruskan permintaan worker ke service worker dan
 * dialog konfirmasi, (3) merangkum progres per berkas.
 *
 * Konkurensi dibatasi (bukan satu worker per berkas) karena setiap berkas yang diproses
 * menahan bank hasil parse + entry hasil konversi; 10 berkas sekaligus dapat menghabiskan
 * beberapa GB RAM. Angka default 3 dipilih dari pengukuran: penulisan IndexedDB menyerialkan
 * semua koneksi (`docs/mvp-audit.md` §4.26), jadi worker di atas jumlah inti efektif tidak
 * menambah throughput tulis.
 */

import type { DictionarySummary, ImportPhase } from '../data/schema.js';
import type { PageMessage, WorkerMessage } from './import-worker-protocol.js';
import {
  nextProgressPercent,
  type FileImportResult,
  type ImportRequest,
} from './importer.js';

/** Jumlah berkas yang diproses bersamaan. */
export const DEFAULT_IMPORT_CONCURRENCY = 3;

export interface ParallelFileState {
  fileName: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'skipped';
  phase: ImportPhase | null;
  percent: number;
  lines: number;
  entries: number;
}

export interface ParallelImportCallbacks {
  /** Status seluruh berkas setiap ada perubahan (untuk merender daftar). */
  onFiles(states: readonly ParallelFileState[]): void;
  confirmReplace(existing: DictionarySummary, fileName: string): Promise<boolean>;
  isCancelled(): boolean;
}

export interface ParallelImportRun {
  results: Promise<FileImportResult[]>;
  /** Batalkan: worker berhenti di batas potongan dan staging-nya dibuang. */
  cancel(): void;
}

interface Slot {
  id: number;
  worker: Worker;
}

/**
 * Permintaan worker ke service worker diteruskan oleh lapisan halaman.
 *
 * Dipisah agar alur ini dapat diganti saat pengujian; halaman memasangnya lewat
 * `setParallelRequestHandler`.
 */
let forwardRequest: ImportRequest | null = null;

export function setParallelRequestHandler(handler: ImportRequest): void {
  forwardRequest = handler;
}

function createWorker(): Worker {
  return new Worker(new URL('./import-worker.ts', import.meta.url), { type: 'module' });
}

/** Impor banyak berkas secara paralel; hasil mengikuti urutan berkas masukan. */
export function importFilesParallel(
  files: readonly File[],
  callbacks: ParallelImportCallbacks,
  options: {
    concurrency?: number;
    language: 'id' | 'en';
  },
): ParallelImportRun {
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_IMPORT_CONCURRENCY, files.length || 1),
  );
  const states: ParallelFileState[] = files.map((file) => ({
    fileName: file.name,
    status: 'queued',
    phase: null,
    percent: 0,
    lines: 0,
    entries: 0,
  }));
  const results: (FileImportResult | undefined)[] = files.map(() => undefined);
  const slots: Slot[] = [];
  let nextIndex = 0;
  let cancelled = false;

  const publish = (): void => {
    callbacks.onFiles(states.map((state) => ({ ...state })));
  };

  const takeNext = (): number | null => {
    const index = nextIndex;
    nextIndex += 1;
    return index < files.length ? index : null;
  };

  const runSlot = async (slot: Slot): Promise<void> => {
    for (;;) {
      const index = takeNext();
      if (index === null) {
        return;
      }
      const file = files[index];
      const state = states[index];
      if (file === undefined || state === undefined) {
        return;
      }
      if (cancelled || callbacks.isCancelled()) {
        state.status = 'skipped';
        publish();
        continue;
      }
      state.status = 'running';
      state.phase = 'reading';
      publish();
      results[index] = await runFile(slot, file, options.language, callbacks, state, publish, () => cancelled);
      publish();
    }
  };

  const run = async (): Promise<FileImportResult[]> => {
    try {
      for (let index = 0; index < concurrency; index += 1) {
        slots.push({ id: index, worker: createWorker() });
      }
      await Promise.all(slots.map((slot) => runSlot(slot)));
    } finally {
      for (const slot of slots) {
        slot.worker.terminate();
      }
    }
    return results.map(
      (result, index): FileImportResult =>
        result ?? {
          fileName: files[index]?.name ?? '',
          status: 'skipped',
          format: 'jsonl',
        },
    );
  };

  return {
    results: run(),
    cancel: () => {
      cancelled = true;
      for (const slot of slots) {
        slot.worker.postMessage({ type: 'cancel', slot: slot.id } satisfies PageMessage);
      }
    },
  };
}

/** Jalankan satu berkas pada satu worker; mengembalikan hasil akhirnya. */
function runFile(
  slot: Slot,
  file: File,
  language: 'id' | 'en',
  callbacks: ParallelImportCallbacks,
  state: ParallelFileState,
  publish: () => void,
  isCancelled: () => boolean,
): Promise<FileImportResult> {
  const worker = slot.worker;
  const { promise, resolve } = Promise.withResolvers<FileImportResult>();
  let settled = false;
  let lastPercent = 0;

  const finish = (result: FileImportResult): void => {
    if (settled) {
      return;
    }
    settled = true;
    state.status = result.status === 'ok' ? 'done' : result.status;
    state.percent = 100;
    if (result.status !== 'ok') {
      state.phase = null;
    }
    resolve(result);
  };

  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === 'progress') {
      lastPercent = nextProgressPercent(lastPercent, message.update);
      state.phase = message.update.phase;
      state.percent = lastPercent;
      state.lines = message.update.linesRead;
      state.entries = message.update.entriesWritten;
      publish();
      return;
    }
    if (message.type === 'call') {
      void handleCall(slot, message, callbacks);
      return;
    }
    if (message.type === 'done') {
      finish(message.result);
      return;
    }
    if (message.type === 'failed') {
      finish({ fileName: file.name, status: 'failed', format: 'jsonl', reason: message.message });
    }
  };
  worker.onerror = (event) => {
    finish({
      fileName: file.name,
      status: 'failed',
      format: 'jsonl',
      reason: event.message.length > 0 ? event.message : 'Worker impor gagal dijalankan.',
    });
  };
  worker.postMessage({ type: 'run', slot: slot.id, file, language } satisfies PageMessage);
  state.percent = 0;
  publish();
  void isCancelled;
  return promise;
}

/** Teruskan permintaan worker (service worker / dialog) lalu balas hasilnya. */
async function handleCall(
  slot: Slot,
  message: Extract<WorkerMessage, { type: 'call' }>,
  callbacks: ParallelImportCallbacks,
): Promise<void> {
  try {
    if (message.kind === 'confirm') {
      const confirmed = await callbacks.confirmReplace(
        message.existing as DictionarySummary,
        message.fileName,
      );
      slot.worker.postMessage({
        type: 'reply',
        slot: message.slot,
        id: message.id,
        ok: true,
        data: confirmed,
      } satisfies PageMessage);
      return;
    }
    if (forwardRequest === null) {
      throw new Error('Handler request impor paralel belum dipasang.');
    }
    const data = await forwardRequest(message.messageType, message.payload);
    slot.worker.postMessage({
      type: 'reply',
      slot: message.slot,
      id: message.id,
      ok: true,
      data,
    } satisfies PageMessage);
  } catch (error) {
    slot.worker.postMessage({
      type: 'reply',
      slot: message.slot,
      id: message.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    } satisfies PageMessage);
  }
}

/** Progres batch untuk bilah utama: rata-rata progres semua berkas. */
export function batchPercent(states: readonly ParallelFileState[]): number {
  if (states.length === 0) {
    return 0;
  }
  let total = 0;
  for (const state of states) {
    total +=
      state.status === 'done' || state.status === 'failed' || state.status === 'skipped'
        ? 100
        : state.percent;
  }
  return Math.min(99, Math.floor(total / states.length));
}
