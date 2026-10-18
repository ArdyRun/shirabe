/**
 * Pengujian pembaca ZIP (PRD 8.4): arsip Yomitan asli (deflate + stored), arsip rusak,
 * dan penanda ZIP64.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ZipFormatError,
  findZipEntry,
  matchZipEntries,
  openZipEntryStream,
  readZipEntries,
  readZipEntryText,
} from '../../src/core/zip.js';

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures');

async function fixtureBlob(name: string): Promise<Blob> {
  const bytes = await readFile(path.join(FIXTURES, name));
  return new Blob([new Uint8Array(bytes)]);
}

describe('readZipEntries', () => {
  it('membaca central directory arsip Yomitan (deflate dan stored)', async () => {
    const entries = await readZipEntries(await fixtureBlob('yomitan-demo.zip'));
    const names = entries.map((entry) => entry.name);
    expect(names).toEqual([
      'index.json',
      'term_bank_1.json',
      'term_bank_2.json',
      'tag_bank_1.json',
      'kanji_bank_1.json',
    ]);
    expect(findZipEntry(entries, 'term_bank_1.json')?.method).toBe(8);
    expect(findZipEntry(entries, 'term_bank_2.json')?.method).toBe(0);
    expect(matchZipEntries(entries, /^term_bank_\d+\.json$/u)).toHaveLength(2);
  });

  it('membaca isi anggota yang dideflate dan yang disimpan', async () => {
    const blob = await fixtureBlob('yomitan-demo.zip');
    const entries = await readZipEntries(blob);
    const index = findZipEntry(entries, 'index.json');
    const bank1 = findZipEntry(entries, 'term_bank_1.json');
    const bank2 = findZipEntry(entries, 'term_bank_2.json');
    if (index === undefined || bank1 === undefined || bank2 === undefined) {
      throw new Error('Anggota arsip tidak ditemukan.');
    }

    const indexText = await readZipEntryText(blob, index);
    expect(JSON.parse(indexText).format).toBe(3);

    const bank1Text = await readZipEntryText(blob, bank1);
    const bank2Text = await readZipEntryText(blob, bank2);
    expect(JSON.parse(bank1Text)).toHaveLength(5);
    expect(JSON.parse(bank1Text)[0][0]).toBe('食べる');
    expect(JSON.parse(bank2Text)[1][0]).toBe('高い');
  });

  it('membaca aliran byte mentah anggota arsip', async () => {
    const blob = await fixtureBlob('yomitan-demo.zip');
    const entries = await readZipEntries(blob);
    const bank = findZipEntry(entries, 'term_bank_1.json');
    if (bank === undefined) {
      throw new Error('Anggota arsip tidak ditemukan.');
    }
    const reader = (await openZipEntryStream(blob, bank)).getReader();
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done === true) {
        break;
      }
      size += chunk.value.byteLength;
    }
    reader.releaseLock();
    expect(size).toBe(bank.uncompressedSize);
  });

  it('menolak arsip yang central directory-nya rusak', async () => {
    await expect(readZipEntries(await fixtureBlob('broken.zip'))).rejects.toBeInstanceOf(
      ZipFormatError,
    );
  });

  it('menolak arsip ZIP64 dengan pesan yang dapat ditindaklanjuti', async () => {
    await expect(readZipEntries(await fixtureBlob('zip64-marker.zip'))).rejects.toThrowError(
      /ZIP64/,
    );
  });

  it('menolak berkas yang terlalu kecil untuk menjadi ZIP', async () => {
    await expect(readZipEntries(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toThrowError(
      /terlalu kecil/,
    );
  });
});
