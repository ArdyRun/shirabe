import { beforeEach, describe, expect, it } from 'vitest';
import { lookup } from '../../src/core/search.js';
import { IMPORT_LIMITS } from '../../src/core/limits.js';
import {
  deleteDictionary,
  getDictionaryRecord,
  listDictionaryRecords,
  listDictionarySummaries,
  reorderDictionaries,
  setDictionaryEnabled,
} from '../../src/data/dictionaries.js';
import { closeDatabase, getAllRecords, putRecord } from '../../src/data/db.js';
import { countAllEntries, createLookupSource } from '../../src/data/entries.js';
import {
  abortImport,
  appendImportBatch,
  beginImport,
  commitImport,
  sweepLeftovers,
} from '../../src/data/imports.js';
import { STORES, getRecord } from '../../src/data/db.js';
import type { ImportJobRecord } from '../../src/data/schema.js';
import { loadFixture, resetDatabase } from '../helpers/dataset.js';

const source = createLookupSource();

async function importFixture(
  file: string,
  options: { replace?: boolean; batchSize?: number } = {},
): Promise<string> {
  const dataset = await loadFixture(file);
  const begin = await beginImport({
    fileName: file,
    fileSize: 1024,
    header: dataset.header,
    replace: options.replace ?? false,
  });
  if (begin.importId === null) {
    throw new Error(`Impor ${file} meminta konfirmasi replace.`);
  }
  const batchSize = options.batchSize ?? 10;
  for (let index = 0; index < dataset.entries.length; index += batchSize) {
    const batch = dataset.entries.slice(index, index + batchSize);
    await appendImportBatch(begin.importId, batch, index, index + batch.length);
  }
  await commitImport(begin.importId);
  return begin.importId;
}

beforeEach(async () => {
  await resetDatabase();
});

describe('impor kamus', () => {
  it('mengimpor dataset valid, dapat dicari, dan bertahan setelah koneksi dibuka ulang', async () => {
    await importFixture('demo-mini.jsonl');

    const summaries = await listDictionarySummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: 'shirabe-demo-mini',
      status: 'active',
      order: 0,
    });
    expect(summaries[0]?.entryCount).toBe(34);
    expect(summaries[0]?.license).toContain('CC0-1.0');

    const first = await lookup('食べる', source);
    expect(first.matches[0]?.entry.expression).toBe('食べる');

    // Simulasi restart: tutup koneksi dan buka lagi.
    closeDatabase();
    const afterRestart = await lookup('学生', source);
    expect(afterRestart.matches[0]?.entry.expression).toBe('学生');
  });

  it('menulis staging tanpa pernah membuatnya tampak sebagai kamus aktif', async () => {
    const dataset = await loadFixture('demo-mini.jsonl');
    const begin = await beginImport({
      fileName: 'demo-mini.jsonl',
      fileSize: 1024,
      header: dataset.header,
      replace: false,
    });
    expect(begin.status).toBe('started');
    const importId = begin.importId;
    if (importId === null) {
      throw new Error('Impor tidak dimulai.');
    }
    await appendImportBatch(importId, dataset.entries.slice(0, 5), 0, 5);

    expect(await listDictionarySummaries()).toHaveLength(0);
    const result = await lookup('食べる', source);
    expect(result.status).toBe('empty');
    expect(await countAllEntries()).toBe(5);

    await abortImport(importId);
    expect(await countAllEntries()).toBe(0);
    expect(await getRecord<ImportJobRecord>(STORES.imports, importId)).toBeUndefined();
  });

  it('kegagalan impor tidak merusak kamus yang sudah aktif', async () => {
    await importFixture('demo-mini.jsonl');
    const before = await listDictionarySummaries();
    const beforeEntries = await countAllEntries();

    // Impor kedua (dataset berbeda) dibatalkan di tengah jalan.
    const dataset = await loadFixture('demo-extended.jsonl');
    const begin = await beginImport({
      fileName: 'demo-extended.jsonl',
      fileSize: 2048,
      header: dataset.header,
      replace: false,
    });
    const importId = begin.importId;
    if (importId === null) {
      throw new Error('Impor tidak dimulai.');
    }
    await appendImportBatch(importId, dataset.entries.slice(0, 4), 0, 4);
    await abortImport(importId);

    expect(await listDictionarySummaries()).toEqual(before);
    expect(await countAllEntries()).toBe(beforeEntries);
    const result = await lookup('食べる', source);
    expect(result.matches[0]?.entry.dictionaryId).toBe('shirabe-demo-mini');
  });

  it('meminta konfirmasi bila ID kamus sudah ada, lalu menggantinya setelah commit', async () => {
    await importFixture('demo-mini.jsonl');
    const dataset = await loadFixture('demo-extended.jsonl');
    const sameId = { ...dataset.header, id: 'shirabe-demo-mini', name: 'Kamus Contoh v2' };

    const notConfirmed = await beginImport({
      fileName: 'ganti.jsonl',
      fileSize: 4096,
      header: sameId,
      replace: false,
    });
    expect(notConfirmed.status).toBe('needs-confirm');
    expect(notConfirmed.importId).toBeNull();
    expect(notConfirmed.existing?.entryCount).toBe(34);

    const begin = await beginImport({
      fileName: 'ganti.jsonl',
      fileSize: 4096,
      header: sameId,
      replace: true,
    });
    const importId = begin.importId;
    if (importId === null) {
      throw new Error('Impor pengganti tidak dimulai.');
    }
    const jobBefore = await getRecord<ImportJobRecord>(STORES.imports, importId);
    const oldVersion = (await getDictionaryRecord('shirabe-demo-mini'))?.activeVersion;
    await appendImportBatch(importId, dataset.entries, 0, dataset.entries.length);
    await commitImport(importId);

    const records = await listDictionaryRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.name).toBe('Kamus Contoh v2');
    expect(records[0]?.entryCount).toBe(dataset.entries.length);
    expect(records[0]?.versions).toEqual([jobBefore?.version]);
    expect(records[0]?.activeVersion).not.toBe(oldVersion);
    // Entry versi lama sudah dibersihkan setelah commit.
    expect(await countAllEntries()).toBe(dataset.entries.length);
  });

  it('menolak impor tanpa entry pada commit', async () => {
    const dataset = await loadFixture('demo-mini.jsonl');
    const begin = await beginImport({
      fileName: 'kosong.jsonl',
      fileSize: 10,
      header: dataset.header,
      replace: false,
    });
    const importId = begin.importId;
    if (importId === null) {
      throw new Error('Impor tidak dimulai.');
    }
    await expect(commitImport(importId)).rejects.toThrow(/tidak berisi/i);
  });

  it('menolak file yang melebihi batas ukuran', async () => {
    const dataset = await loadFixture('demo-mini.jsonl');
    await expect(
      beginImport({
        fileName: 'besar.jsonl',
        fileSize: IMPORT_LIMITS.maxFileBytes + 1,
        header: dataset.header,
        replace: false,
      }),
    ).rejects.toThrow(/batas/i);
  });

  it('menolak header yang tidak valid', async () => {
    const dataset = await loadFixture('demo-mini.jsonl');
    await expect(
      beginImport({
        fileName: 'rusak.jsonl',
        fileSize: 10,
        header: { ...dataset.header, schemaVersion: 42 },
        replace: false,
      }),
    ).rejects.toThrow(/schema/i);
  });
});

describe('urutan dataset di dalam satu kamus', () => {
  it('mengembalikan entry sesuai urutan file, bukan urutan leksikografis kunci', async () => {
    // 12 entry dengan expression sama: tanpa padding lebar tetap, kunci `:10` akan
    // diurutkan sebelum `:2` sehingga urutan dataset rusak.
    const entries = Array.from({ length: 12 }, (_, index) => ({
      expression: '同形',
      reading: `どうけい${index}`,
      definitions: [`definisi ${index}`],
      partOfSpeech: ['n'],
      tags: [],
      rules: [],
    }));
    const begin = await beginImport({
      fileName: 'urutan.jsonl',
      fileSize: 1024,
      header: {
        type: 'shirabe-dictionary',
        schemaVersion: 1,
        id: 'urutan-test',
        name: 'Uji Urutan',
        language: 'ja',
        definitionLanguage: 'id',
        license: '',
        attribution: '',
      },
      replace: false,
    });
    const importId = begin.importId;
    if (importId === null) {
      throw new Error('Impor tidak dimulai.');
    }
    await appendImportBatch(importId, entries, 0, entries.length);
    await commitImport(importId);

    const result = await lookup('同形', source);
    expect(result.matches.map((match) => match.entry.definitions[0])).toEqual(
      entries.map((entry) => entry.definitions[0]),
    );
  });
});

describe('pengelolaan kamus', () => {
  it('mengaktifkan, menonaktifkan, mengurutkan, dan menghapus kamus', async () => {
    await importFixture('demo-mini.jsonl');
    await importFixture('demo-extended.jsonl', { replace: false });

    let summaries = await listDictionarySummaries();
    expect(summaries.map((item) => item.id)).toEqual([
      'shirabe-demo-mini',
      'shirabe-demo-extended',
    ]);

    summaries = await reorderDictionaries(['shirabe-demo-extended', 'shirabe-demo-mini']);
    expect(summaries.map((item) => item.id)).toEqual([
      'shirabe-demo-extended',
      'shirabe-demo-mini',
    ]);
    expect(summaries.map((item) => item.order)).toEqual([0, 1]);

    summaries = await setDictionaryEnabled('shirabe-demo-mini', false);
    expect(summaries.find((item) => item.id === 'shirabe-demo-mini')?.status).toBe('disabled');
    const onlySecond = await lookup('がくせい', source);
    expect(onlySecond.matches[0]?.entry.dictionaryId).toBe('shirabe-demo-extended');

    const totalBefore = await countAllEntries();
    await deleteDictionary('shirabe-demo-mini');
    summaries = await listDictionarySummaries();
    expect(summaries.map((item) => item.id)).toEqual(['shirabe-demo-extended']);
    expect(await countAllEntries()).toBeLessThan(totalBefore);
    // Kamus lain tetap dapat dicari.
    const stillThere = await lookup('たべる', source);
    expect(stillThere.matches[0]?.entry.dictionaryId).toBe('shirabe-demo-extended');
  });

  it('menghapus seluruh entry milik kamus yang dihapus', async () => {
    await importFixture('demo-mini.jsonl');
    await deleteDictionary('shirabe-demo-mini');
    expect(await countAllEntries()).toBe(0);
    expect(await lookup('食べる', source)).toMatchObject({ status: 'empty' });
  });

  it('mengurutkan hasil lookup mengikuti urutan kamus', async () => {
    await importFixture('demo-mini.jsonl');
    await importFixture('demo-extended.jsonl');
    const first = await lookup('食べる', source);
    expect(first.matches.map((match) => match.entry.dictionaryId)).toEqual([
      'shirabe-demo-mini',
      'shirabe-demo-extended',
    ]);

    await reorderDictionaries(['shirabe-demo-extended', 'shirabe-demo-mini']);
    const second = await lookup('食べる', source);
    expect(second.matches.map((match) => match.entry.dictionaryId)).toEqual([
      'shirabe-demo-extended',
      'shirabe-demo-mini',
    ]);
  });

  it('menolak operasi pada kamus yang tidak ada', async () => {
    await expect(setDictionaryEnabled('tidak-ada', true)).rejects.toThrow(/tidak ditemukan/i);
    await expect(deleteDictionary('tidak-ada')).rejects.toThrow(/tidak ditemukan/i);
  });
});

describe('sweep startup', () => {
  it('membersihkan job impor yang ditinggalkan beserta staging-nya', async () => {
    const dataset = await loadFixture('demo-mini.jsonl');
    const begin = await beginImport({
      fileName: 'demo-mini.jsonl',
      fileSize: 1024,
      header: dataset.header,
      replace: false,
    });
    const importId = begin.importId;
    if (importId === null) {
      throw new Error('Impor tidak dimulai.');
    }
    await appendImportBatch(importId, dataset.entries.slice(0, 6), 0, 6);

    // Job belum kedaluwarsa: tidak dibersihkan.
    expect(await sweepLeftovers()).toBe(0);
    expect(await countAllEntries()).toBe(6);

    const future = Date.now() + 10 * 60 * 1000;
    expect(await sweepLeftovers(future)).toBe(1);
    expect(await countAllEntries()).toBe(0);
    expect(await getRecord<ImportJobRecord>(STORES.imports, importId)).toBeUndefined();
  });

  it('menyelesaikan penghapusan kamus yang tertinggal dalam status pendingDelete', async () => {
    await importFixture('demo-mini.jsonl');
    const record = await getDictionaryRecord('shirabe-demo-mini');
    if (record === undefined) {
      throw new Error('Kamus tidak ditemukan.');
    }
    await putRecord(STORES.dictionaries, {
      ...record,
      status: 'disabled',
      pendingDelete: true,
    });

    const cleaned = await sweepLeftovers();
    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(await listDictionaryRecords()).toHaveLength(0);
    expect(await getAllRecords(STORES.entries)).toHaveLength(0);
  });
});
