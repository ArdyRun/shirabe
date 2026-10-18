import { describe, expect, it } from 'vitest';
import { importProgressPercent, nextProgressPercent, type ImportProgress } from '../../src/settings/importer.js';

function progress(partial: Partial<ImportProgress>): ImportProgress {
  return {
    fileName: 'kamus.jsonl',
    phase: 'writing',
    linesRead: 0,
    entriesWritten: 0,
    entriesQueued: 0,
    bytesRead: 0,
    bytesTotal: 1000,
    ...partial,
  };
}

describe('persentase progres impor', () => {
  it('mengikuti byte yang sudah diproses saat tidak ada queue penulisan', () => {
    expect(importProgressPercent(progress({ bytesRead: 0 }))).toBe(0);
    expect(importProgressPercent(progress({ bytesRead: 250 }))).toBe(25);
    expect(importProgressPercent(progress({ bytesRead: 700, phase: 'reading' }))).toBe(70);
  });

  it('tertinggal di belakang byte yang cepat dibaca selama penulisan mengejar', () => {
    // Semua byte sudah dibaca, tetapi baru separuh entry yang tersimpan.
    expect(
      importProgressPercent(progress({ bytesRead: 1000, entriesWritten: 50, entriesQueued: 100 })),
    ).toBe(50);
    // Penulisan sudah melampaui pembacaan: yang menentukan sekarang byte.
    expect(
      importProgressPercent(progress({ bytesRead: 400, entriesWritten: 90, entriesQueued: 100 })),
    ).toBe(40);
  });

  it('tidak pernah mencapai 100 sebelum commit', () => {
    expect(importProgressPercent(progress({ bytesRead: 1000, entriesWritten: 10, entriesQueued: 10 })))
      .toBe(99);
    expect(importProgressPercent(progress({ bytesRead: 5000 }))).toBe(99);
  });

  it('commit dan gagal berarti selesai', () => {
    expect(importProgressPercent(progress({ phase: 'committing', bytesRead: 400 }))).toBe(100);
    expect(importProgressPercent(progress({ phase: 'failed', bytesRead: 400 }))).toBe(100);
  });

  it('bilah tidak bergerak mundur saat batch baru menambah pekerjaan diketahui', () => {
    const awal = progress({ bytesRead: 1000, entriesWritten: 60, entriesQueued: 100 });
    expect(importProgressPercent(awal)).toBe(60);
    // Batch baru dikirim: rasio "selesai dibagi diketahui" turun, bilah tidak.
    const setelah = progress({ bytesRead: 1000, entriesWritten: 60, entriesQueued: 150 });
    expect(importProgressPercent(setelah)).toBe(40);
    expect(nextProgressPercent(60, setelah)).toBe(60);
    expect(nextProgressPercent(60, progress({ phase: 'committing' }))).toBe(100);
  });

  it('total byte nol tidak menghasilkan NaN', () => {
    expect(importProgressPercent(progress({ bytesRead: 0, bytesTotal: 0 }))).toBe(0);
  });
});
