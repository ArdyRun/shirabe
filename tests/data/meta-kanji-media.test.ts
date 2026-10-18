import { beforeEach, describe, expect, it } from 'vitest';
import { IMPORT_LIMITS } from '../../src/core/limits.js';
import type { MetaValue } from '../../src/core/types.js';
import { STORES, getAllRecords, getRecord, putRecord, withTransaction } from '../../src/data/db.js';
import { createLookupSource, deleteVersionData, writeEntryBatch } from '../../src/data/entries.js';
import { findKanjiMatches, writeKanjiBatch } from '../../src/data/kanji.js';
import { appendMetaItems, findMetaMatches, flushMetaPacks } from '../../src/data/meta.js';
import { getMediaRecord, parseMediaMime, writeMediaBatch } from '../../src/data/media.js';
import { appendImportBatch, beginImport, commitImport } from '../../src/data/imports.js';
import { getDictionaryRecord } from '../../src/data/dictionaries.js';
import type {
  DictionaryRecord,
  KanjiRecord,
  MediaRecord,
  MetaPackRecord,
} from '../../src/data/schema.js';
import { resetDatabase } from '../helpers/dataset.js';

function makeDictionary(
  id: string,
  activeVersion: string,
  overrides: Partial<DictionaryRecord> = {},
): DictionaryRecord {
  return {
    id,
    name: `Kamus ${id}`,
    language: 'ja',
    definitionLanguage: 'id',
    schemaVersion: 2,
    license: '',
    attribution: '',
    entryCount: 0,
    status: 'active',
    order: 0,
    importedAt: Date.now(),
    activeVersion,
    versions: [activeVersion],
    approxSize: 0,
    sourceFileName: `${id}.jsonl`,
    ...overrides,
  };
}

const PITCH: MetaValue = {
  type: 'pitch',
  reading: 'たべる',
  pitches: [{ position: 1, devoice: [], nasal: [] }],
};
const FREQ: MetaValue = { type: 'freq', reading: '', frequency: { value: 1200 } };

beforeEach(async () => {
  await resetDatabase();
});

/** Tulis item meta sebagai record pack (buffer + flush seperti alur impor). */
async function writeMeta(
  version: string,
  dictionaryId: string,
  items: Parameters<typeof appendMetaItems>[2],
): Promise<void> {
  await appendMetaItems(version, dictionaryId, items);
  await flushMetaPacks();
}

describe('store meta (pitch/frekuensi)', () => {
  it('menulis dan membaca nilai meta, menyaring versi dataset yang tidak aktif', async () => {
    await putRecord(STORES.dictionaries, makeDictionary('d1', 'v1'));
    await putRecord(STORES.dictionaries, makeDictionary('d2', 'v2', { order: 1 }));

    await writeMeta('v1', 'd1', [
      { expression: '食べる', reading: 'たべる', values: [PITCH] },
      { expression: '食べる', reading: '', values: [FREQ] },
    ]);
    // Versi lama milik d2 (bukan `activeVersion`-nya): tidak boleh muncul.
    await writeMeta('v-stale', 'd2', [{ expression: '食べる', reading: '', values: [FREQ] }]);

    const matches = await findMetaMatches('食べる', 'たべる');
    expect(matches).toHaveLength(2);
    expect(matches[0]?.dictionaryId).toBe('d1');
    // Bacaan kosong cocok untuk bacaan apa pun; urutan bacaan kosong lebih dahulu.
    expect(matches.map((match) => match.values[0]?.type)).toEqual(['freq', 'pitch']);

    expect(await findMetaMatches('食べる', 'のむ')).toHaveLength(1);

    // Sumber lookup produksi memakai normalisasi NFC yang sama.
    const viaSource = await createLookupSource().findMeta('食べる', 'たべる');
    expect(viaSource).toHaveLength(2);
  });
});

describe('store kanji', () => {
  it('menulis dan membaca kanji, urut dictionaryOrder, menyaring versi tidak aktif', async () => {
    await putRecord(STORES.dictionaries, makeDictionary('d1', 'v1', { order: 1 }));
    await putRecord(STORES.dictionaries, makeDictionary('d2', 'v2', { order: 0 }));

    await writeKanjiBatch('v1', 'd1', [
      { character: '食', onyomi: ['ショク'], kunyomi: ['た.べる'], tags: [], meanings: ['makan'], stats: { strokes: '9' } },
    ]);
    await writeKanjiBatch('v2', 'd2', [
      { character: '食', onyomi: ['ショク'], kunyomi: [], tags: [], meanings: ['eat'], stats: {} },
    ]);
    await writeKanjiBatch('v-stale', 'd2', [
      { character: '飲', onyomi: [], kunyomi: [], tags: [], meanings: ['lama'], stats: {} },
    ]);

    const matches = await findKanjiMatches('食');
    expect(matches.map((match) => match.dictionaryId)).toEqual(['d2', 'd1']);
    expect(matches[1]?.meanings).toEqual(['makan']);

    // Kanji pada versi tidak aktif tidak pernah terlihat.
    expect(await findKanjiMatches('飲')).toHaveLength(0);

    const viaSource = await createLookupSource().findKanji('食');
    expect(viaSource.map((match) => match.dictionaryId)).toEqual(['d2', 'd1']);
  });
});

describe('store media', () => {
  it('menyimpan media dengan MIME dari ekstensi dan membacanya hanya lewat versi aktif', async () => {
    await putRecord(STORES.dictionaries, makeDictionary('d1', 'v1'));

    const result = await writeMediaBatch('v1', 'd1', [
      { path: 'graphics/0001.png', bytes: Uint8Array.of(1, 2, 3) },
      { path: 'graphics/0002.SVG', bytes: Uint8Array.of(4, 5) },
    ]);
    expect(result).toEqual({ stored: 2, bytes: 5, skipped: 0 });

    const record = await getMediaRecord('d1', 'graphics/0001.png', 'v1');
    expect(record?.mime).toBe('image/png');
    expect(record?.size).toBe(3);
    expect(record?.blob).toBeInstanceOf(Blob);

    expect(await getMediaRecord('d1', 'graphics/0002.SVG', 'v1')).toMatchObject({
      mime: 'image/svg+xml',
    });
    // Versi lain tidak pernah dipakai.
    expect(await getMediaRecord('d1', 'graphics/0001.png', 'v-lain')).toBeUndefined();

    expect(parseMediaMime('a.PNG')).toBe('image/png');
    expect(parseMediaMime('a.jpeg')).toBe('image/jpeg');
    expect(parseMediaMime('tanpa-ekstensi')).toBe('application/octet-stream');
    expect(parseMediaMime('a.indd')).toBe('application/octet-stream');
  });

  it('melewati berkas di atas batas ukuran dan menghitungnya sebagai skipped', async () => {
    await putRecord(STORES.dictionaries, makeDictionary('d1', 'v1'));

    const tooBig = new Uint8Array(IMPORT_LIMITS.maxMediaFileBytes + 1);
    const result = await writeMediaBatch('v1', 'd1', [
      { path: 'besar.png', bytes: tooBig },
      { path: 'kecil.png', bytes: Uint8Array.of(7) },
    ]);
    expect(result).toEqual({ stored: 1, bytes: 1, skipped: 1 });
    expect(await getMediaRecord('d1', 'besar.png', 'v1')).toBeUndefined();
    expect(await getMediaRecord('d1', 'kecil.png', 'v1')).toMatchObject({ size: 1 });
  });
});

describe('deleteVersionData', () => {
  it('menghapus satu versi dataset dari entries, meta, kanji, dan media', async () => {
    await putRecord(STORES.dictionaries, makeDictionary('d1', 'v1'));
    await putRecord(STORES.dictionaries, makeDictionary('d2', 'v2'));

    await withTransaction([STORES.entries], 'readwrite', async (transaction) => {
      writeEntryBatch(transaction, 'v1', 'd1', 0, [
        { expression: '食べる', reading: 'たべる', definitions: ['lama'], partOfSpeech: [], tags: [], rules: [] },
      ]);
      writeEntryBatch(transaction, 'v2', 'd2', 0, [
        { expression: '食べる', reading: 'たべる', definitions: ['baru'], partOfSpeech: [], tags: [], rules: [] },
      ]);
    });
    await writeMeta('v1', 'd1', [{ expression: '食べる', reading: '', values: [PITCH] }]);
    await writeMeta('v2', 'd2', [{ expression: '食べる', reading: '', values: [PITCH] }]);
    await writeKanjiBatch('v1', 'd1', [
      { character: '食', onyomi: [], kunyomi: [], tags: [], meanings: [], stats: {} },
    ]);
    await writeKanjiBatch('v2', 'd2', [
      { character: '食', onyomi: [], kunyomi: [], tags: [], meanings: [], stats: {} },
    ]);
    await writeMediaBatch('v1', 'd1', [{ path: 'a.png', bytes: Uint8Array.of(1) }]);
    await writeMediaBatch('v2', 'd2', [{ path: 'a.png', bytes: Uint8Array.of(2) }]);

    await deleteVersionData('v1');

    const entries = await getAllRecords<{ version: string }>(STORES.entries);
    const meta = await getAllRecords<MetaPackRecord>(STORES.metaPacks);
    const kanji = await getAllRecords<KanjiRecord>(STORES.kanji);
    const media = await getAllRecords<MediaRecord>(STORES.media);
    expect(entries.map((record) => record.version)).toEqual(['v2']);
    expect(meta.map((record) => record.version)).toEqual(['v2']);
    expect(kanji.map((record) => record.version)).toEqual(['v2']);
    expect(media.map((record) => record.version)).toEqual(['v2']);
  });
});

describe('commitImport hitungan data turunan', () => {
  it('menyimpan kanjiCount/metaCount/mediaCount/mediaBytes pada metadata kamus', async () => {
    const header = {
      type: 'shirabe-dictionary' as const,
      schemaVersion: 1,
      id: 'kamus-aux',
      name: 'Kamus Aux',
      language: 'ja',
      definitionLanguage: 'id',
      license: '',
      attribution: '',
    };
    const begin = await beginImport({ fileName: 'aux.jsonl', fileSize: 100, header, replace: false });
    // Versi dataset staging harus dilaporkan supaya halaman impor tahu ke mana
    // menulis meta/kanji/media.
    expect(typeof begin.version).toBe('string');
    expect(begin.version).not.toBe('');
    const importId = begin.importId;
    if (importId === null) {
      throw new Error('Impor tidak dimulai.');
    }
    await appendImportBatch(
      importId,
      [{ expression: '食べる', reading: 'たべる', definitions: ['x'], partOfSpeech: [], tags: [], rules: [] }],
      0,
      1,
    );
    await commitImport(importId, { kanjiCount: 5, metaCount: 3, mediaCount: 2, mediaBytes: 1234 });

    const record = await getDictionaryRecord('kamus-aux');
    expect(record).toMatchObject({
      kanjiCount: 5,
      metaCount: 3,
      mediaCount: 2,
      mediaBytes: 1234,
    });

    // Tanpa parameter: nilai default 0, bukan `undefined`.
    const second = await beginImport({
      fileName: 'aux2.jsonl',
      fileSize: 100,
      header: { ...header, id: 'kamus-polos', name: 'Kamus Polos' },
      replace: false,
    });
    if (second.importId === null) {
      throw new Error('Impor kedua tidak dimulai.');
    }
    await appendImportBatch(
      second.importId,
      [{ expression: '飲む', reading: 'のむ', definitions: ['y'], partOfSpeech: [], tags: [], rules: [] }],
      0,
      1,
    );
    await commitImport(second.importId);
    expect(await getRecord<DictionaryRecord>(STORES.dictionaries, 'kamus-polos')).toMatchObject({
      kanjiCount: 0,
      metaCount: 0,
      mediaCount: 0,
      mediaBytes: 0,
    });

    // Impor yang belum dimulai tidak punya versi staging.
    const confirm = await beginImport({
      fileName: 'aux3.jsonl',
      fileSize: 100,
      header,
      replace: false,
    });
    expect(confirm).toMatchObject({ status: 'needs-confirm', importId: null, version: null });
  });
});

describe('record pack meta', () => {
  it('menulis banyak item ke bucket yang sama sebagai beberapa record dan tetap terbaca', async () => {
    await putRecord(STORES.dictionaries, makeDictionary('d1', 'v1'));

    // 1.200 item dengan ekspresi sama memaksa bucket itu melewati batas item per record
    // (PACK_ITEMS), sehingga bucket ditulis sebagai beberapa record dengan nomor urut
    // berbeda — jalur yang juga dipakai kamus besar saat anggaran memori tercapai.
    const items = Array.from({ length: 1200 }, (_, index) => ({
      expression: '食べる',
      reading: `ご${index}`,
      values: [{ type: 'freq' as const, reading: `ご${index}`, frequency: { value: index } }],
    }));
    await appendMetaItems('v1', 'd1', items);
    await flushMetaPacks();

    const packs = await getAllRecords<MetaPackRecord>(STORES.metaPacks);
    expect(packs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(packs.map((pack) => pack.bucket)).size).toBe(1);
    expect(packs.reduce((total, pack) => total + pack.items.length, 0)).toBe(1200);
    // Nomor urut berbeda supaya penulisan bersifat append (tanpa baca-ubah-tulis).
    expect(new Set(packs.map((pack) => pack.seq)).size).toBe(packs.length);

    const match = await findMetaMatches('食べる', 'ご1199');
    expect(match).toHaveLength(1);
    expect(match[0]?.reading).toBe('ご1199');
    expect(await findMetaMatches('食べる', 'ご-tidak-ada')).toHaveLength(0);
  });

  it('bucket berbeda tidak tercampur dan flush berikutnya memakai nomor urut baru', async () => {
    await putRecord(STORES.dictionaries, makeDictionary('d1', 'v1'));
    await writeMeta('v1', 'd1', [{ expression: '食べる', reading: '', values: [FREQ] }]);
    await writeMeta('v1', 'd1', [{ expression: '学生', reading: 'がくせい', values: [FREQ] }]);

    const packs = await getAllRecords<MetaPackRecord>(STORES.metaPacks);
    expect(packs).toHaveLength(2);
    expect(packs[0]?.key).not.toBe(packs[1]?.key);
    expect(await findMetaMatches('食べる', '')).toHaveLength(1);
    expect(await findMetaMatches('学生', 'がくせい')).toHaveLength(1);
    expect(await findMetaMatches('学生', 'たべる')).toHaveLength(0);
  });
});
