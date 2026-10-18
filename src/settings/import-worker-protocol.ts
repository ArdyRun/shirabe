/**
 * Protokol pesan antara halaman pengaturan dan Web Worker impor.
 *
 * Worker memegang jalur impor yang sama dengan sebelumnya (`importFiles`), tetapi hanya
 * berisi kode murni + IndexedDB. Akses `chrome.*` tidak tersedia di Web Worker, jadi
 * permintaan ke service worker (`IMPORT_BEGIN/APPEND/COMMIT/ABORT`) dan dialog konfirmasi
 * diteruskan lewat halaman.
 */

import type { MessageType, RequestPayload } from '../messaging/protocol.js';
import type { ImportPhase } from '../data/schema.js';
import type { FileImportResult, ImportProgress } from './importer.js';

export interface WorkerProgressMessage {
  type: 'progress';
  slot: number;
  update: ImportProgress;
  /** Persentase dari `importProgressPercent`, dihitung worker agar klien tidak menghitung ulang. */
  percent: number;
}

export type WorkerRequestMessage =
  | {
      type: 'call';
      slot: number;
      id: number;
      kind: 'request';
      messageType: MessageType;
      payload: RequestPayload<MessageType>;
    }
  | {
      type: 'call';
      slot: number;
      id: number;
      kind: 'confirm';
      fileName: string;
      existing: unknown;
    };

export type WorkerMessage =
  | WorkerProgressMessage
  | WorkerRequestMessage
  | { type: 'done'; slot: number; result: FileImportResult }
  | { type: 'failed'; slot: number; message: string }
  | { type: 'ready'; slot: number };

export type PageMessage =
  | {
      type: 'run';
      slot: number;
      file: File;
      language: 'id' | 'en';
    }
  | { type: 'reply'; slot: number; id: number; ok: true; data: unknown }
  | { type: 'reply'; slot: number; id: number; ok: false; message: string }
  | { type: 'cancel'; slot: number };

export type { ImportPhase };
