/**
 * Pengujian adapter Yomitan → Shirabe (PRD 8.4).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  POS_TAGS,
  convertKanjiBank,
  convertTermBank,
  convertTermMetaBank,
  definitionsFromGlossary,
  dictionaryHeaderFromIndex,
  dictionaryIdFromIndex,
  parseYomitanIndex,
} from '../../src/core/yomitan.js';
import { findZipEntry, readZipEntries, readZipEntryText } from '../../src/core/zip.js';

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures');

const glossary = (senses: string[]): unknown[] => [
  {
    type: 'structured-content',
    content: [
      {
        tag: 'ul',
        data: { content: 'glossary' },
        content: senses.map((sense) => ({ tag: 'li', content: sense })),
      },
    ],
  },
];

describe('parseYomitanIndex', () => {
  it('menerima index format 3', () => {
    const result = parseYomitanIndex(
      JSON.stringify({ title: 'Kamus Uji', format: 3, revision: 'r1', attribution: 'sumber' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Kamus Uji');
      expect(result.value.revision).toBe('r1');
    }
  });

  it('menolak format yang tidak didukung dengan pesan jelas', () => {
    const result = parseYomitanIndex(JSON.stringify({ title: 'Kamus Lama', format: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("1");
      expect(result.reason).toContain('3');
    }
  });

  it('menolak index tanpa title atau tanpa format', () => {
    expect(parseYomitanIndex(JSON.stringify({ format: 3 })).ok).toBe(false);
    expect(parseYomitanIndex(JSON.stringify({ title: 'X' })).ok).toBe(false);
  });

  it('menolak JSON yang rusak', () => {
    expect(parseYomitanIndex('{bukan json').ok).toBe(false);
  });

  it('membuat ID kamus yang aman untuk kunci storage', () => {
    const metadata = { title: 'JMdict [2026-10-16]', format: 3, revision: '', author: '', url: '', attribution: '', description: '' };
    expect(dictionaryIdFromIndex(metadata)).toBe('jmdict-2026-10-16');
    expect(dictionaryIdFromIndex({ ...metadata, title: '###' })).toBe('yomitan-dictionary');
  });

  it('menggabungkan atribusi, penulis, sumber, dan revisi ke header Shirabe', () => {
    const header = dictionaryHeaderFromIndex({
      title: 'Kamus Uji',
      format: 3,
      revision: 'r2',
      author: 'Penulis',
      url: 'https://contoh.invalid',
      attribution: 'Atribusi sumber',
      description: '',
    });
    // Konverter menulis schema v2 (mendukung structured content; superset v1).
    expect(header.schemaVersion).toBe(2);
    expect(header.attribution).toContain('Atribusi sumber');
    expect(header.attribution).toContain('Penulis');
    expect(header.attribution).toContain('https://contoh.invalid');
    expect(header.attribution).toContain('r2');
  });
});

describe('definitionsFromGlossary', () => {
  it('mengambil satu definisi per sense', () => {
    expect(definitionsFromGlossary(glossary(['to eat', 'to consume'])).definitions).toEqual([
      'to eat',
      'to consume',
    ]);
  });

  it('menerima glossary berupa string biasa', () => {
    expect(definitionsFromGlossary(['makan']).definitions).toEqual(['makan']);
  });

  it('mempertahankan tabel bentuk kata sebagai simpul, bukan teks yang menempel', () => {
    // Bentuk asli dari kamus JMdict (glosarium `forms`): tabel 4 kolom.
    const value = [
      {
        type: 'structured-content',
        content: {
          tag: 'table',
          content: [
            {
              tag: 'tr',
              content: [
                { tag: 'th', content: '', style: { textAlign: 'center' } },
                { tag: 'th', content: '俺', style: { textAlign: 'center' } },
                { tag: 'th', content: '己', style: { textAlign: 'center' } },
              ],
            },
            {
              tag: 'tr',
              content: [
                { tag: 'th', content: 'おれ', style: { textAlign: 'left' } },
                { tag: 'td', content: '★', style: { textAlign: 'center' } },
                { tag: 'td', content: '🅁', style: { textAlign: 'center' } },
              ],
            },
          ],
        },
      },
    ];
    const conversion = definitionsFromGlossary(value);
    expect(conversion.flattened).toBe(0);
    expect(conversion.definitions).toEqual([
      {
        tag: 'table',
        content: [
          {
            tag: 'tr',
            content: [
              { tag: 'th', content: '', style: { textAlign: 'center' } },
              { tag: 'th', content: '俺', style: { textAlign: 'center' } },
              { tag: 'th', content: '己', style: { textAlign: 'center' } },
            ],
          },
          {
            tag: 'tr',
            content: [
              { tag: 'th', content: 'おれ', style: { textAlign: 'left' } },
              { tag: 'td', content: '★', style: { textAlign: 'center' } },
              { tag: 'td', content: '🅁', style: { textAlign: 'center' } },
            ],
          },
        ],
      },
    ]);
  });

  it('mempertahankan penanda daftar catatan (listStyleType) dan warna peran', () => {
    const conversion = definitionsFromGlossary([
      {
        type: 'structured-content',
        content: {
          tag: 'ul',
          data: { content: 'notes' },
          style: { listStyleType: "'📝 '" },
          lang: 'ja',
          content: [{ tag: 'li', content: 'informal, rough, blunt' }],
        },
      },
    ]);
    expect(conversion.definitions).toEqual([
      {
        tag: 'ul',
        data: { content: 'notes' },
        style: { listStyleType: "'📝 '" },
        lang: 'ja',
        content: [{ tag: 'li', content: 'informal, rough, blunt' }],
      },
    ]);
  });

  it('membuang properti gaya yang tidak didukung dan melaporkannya', () => {
    const conversion = definitionsFromGlossary([
      {
        type: 'structured-content',
        content: {
          tag: 'div',
          style: { textAlign: 'center', backgroundImage: 'url(https://contoh.invalid/x.png)' },
          content: 'teks',
        },
      },
    ]);
    expect(conversion.definitions).toEqual([
      { tag: 'div', style: { textAlign: 'center' }, content: 'teks' },
    ]);
    expect([...conversion.unsupported.keys()].some((key) => key.includes('backgroundImage'))).toBe(true);
  });

  it('memetakan gambar bentuk lama (`image`) ke simpul img dan mengumpulkan jalur media', () => {
    const conversion = definitionsFromGlossary([
      {
        type: 'structured-content',
        content: [
          { type: 'image', path: 'gambar.png' },
          { tag: 'span', content: 'teks biasa' },
        ],
      },
    ]);
    expect(conversion.definitions).toEqual([{ tag: 'img', path: 'gambar.png' }, 'teks biasa']);
    expect(conversion.media).toEqual(['gambar.png']);
  });

  it('mempertahankan daftar rujukan sebagai simpul dan meratakan tautannya', () => {
    const value = [
      {
        type: 'structured-content',
        content: [
          {
            tag: 'ul',
            data: { content: 'glossary' },
            content: [{ tag: 'li', content: 'to come' }],
          },
          {
            tag: 'ul',
            data: { content: 'references' },
            content: {
              tag: 'li',
              content: [
                'see: ',
                { tag: 'a', href: '?query=行く', content: '行く' },
                { tag: 'span', data: { content: 'refGlosses' }, content: ' 1. to go' },
              ],
            },
          },
        ],
      },
    ];
    const conversion = definitionsFromGlossary(value);
    expect(conversion.flattened).toBe(0);
    expect(conversion.definitions).toEqual([
      'to come',
      {
        tag: 'ul',
        data: { content: 'references' },
        content: [
          {
            tag: 'li',
            content: [
              'see: ',
              '行く',
              { tag: 'span', data: { content: 'refGlosses' }, content: ' 1. to go' },
            ],
          },
        ],
      },
    ]);
    // Tautan belum didukung: diratakan menjadi teks dan dilaporkan.
    expect([...conversion.unsupported.keys()].some((key) => key.includes('tautan'))).toBe(true);
  });

  it('tidak menggandakan definisi yang sama', () => {
    expect(definitionsFromGlossary(glossary(['sama', 'sama'])).definitions).toEqual(['sama']);
  });

  it('mengabaikan node kosong', () => {
    expect(definitionsFromGlossary([{ type: 'structured-content', content: [] }]).definitions).toEqual([]);
  });
});

describe('convertTermBank', () => {
  it('memetakan expression, reading, POS, tag, rules, dan score', () => {
    const result = convertTermBank([
      ['食べる', 'たべる', '1 v1 vt uk', 'v1', 1999800, glossary(['to eat']), 1, '⭐ ichi'],
    ]);
    expect(result.skipped.count).toBe(0);
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry?.expression).toBe('食べる');
    expect(entry?.reading).toBe('たべる');
    expect(entry?.definitions).toEqual(['to eat']);
    expect(entry?.partOfSpeech).toEqual(['v1', 'vt']);
    expect(entry?.tags).toEqual(['1', 'uk', '⭐', 'ichi']);
    expect(entry?.rules).toEqual(['v1']);
    expect(entry?.priority).toBe(1999800);
  });

  it('melewatkan entry dengan markup HTML dan mencatat alasannya', () => {
    const result = convertTermBank([
      ['高い', 'たかい', '1 adj-i', 'adj-i', 1999800, ['high', '<script>jahat</script>'], 2, ''],
    ]);
    expect(result.entries).toHaveLength(0);
    expect(result.skipped.count).toBe(1);
    expect(result.skipped.example).toBe('高い');
    expect(result.skipped.reason).toContain('HTML');
  });

  it('melewatkan baris yang bentuknya tidak sesuai term bank v3', () => {
    const result = convertTermBank([['食べる'], [], 'bukan array', ['', '', '', '', 0, []]]);
    expect(result.entries).toHaveLength(0);
    expect(result.skipped.count).toBe(4);
  });

  it('memotong daftar definisi yang melebihi batas schema', () => {
    const many = Array.from({ length: 70 }, (_, index) => `definisi ${index}`);
    const result = convertTermBank([
      ['多い', 'おおい', '', '', 10, glossary(many), 1, ''],
    ]);
    expect(result.entries[0]?.definitions).toHaveLength(64);
    expect(result.truncatedDefinitions).toBe(1);
  });

  it('menolak bank yang bukan array', () => {
    expect(convertTermBank({ rows: [] }).skipped.reason).toContain('array');
  });

  it('mengenali seluruh tag POS yang didukung', () => {
    for (const tag of POS_TAGS) {
      const result = convertTermBank([['語', '', tag, '', 0, ['def'], 1, '']]);
      expect(result.entries[0]?.partOfSpeech).toEqual([tag]);
    }
  });
});

describe('adapter melalui arsip uji', () => {
  it('mengubah isi yomitan-demo.zip menjadi entry Shirabe', async () => {
    const bytes = await readFile(path.join(FIXTURES, 'yomitan-demo.zip'));
    const blob = new Blob([new Uint8Array(bytes)]);
    const zipEntries = await readZipEntries(blob);
    const indexEntry = findZipEntry(zipEntries, 'index.json');
    const bank = findZipEntry(zipEntries, 'term_bank_1.json');
    if (indexEntry === undefined || bank === undefined) {
      throw new Error('Fixture tidak lengkap.');
    }
    const metadata = parseYomitanIndex(await readZipEntryText(blob, indexEntry));
    expect(metadata.ok).toBe(true);
    const conversion = convertTermBank(JSON.parse(await readZipEntryText(blob, bank)));
    expect(conversion.entries.map((entry) => entry.expression)).toEqual([
      '食べる',
      '書く',
      '学生',
      '来る',
    ]);
    // Baris "空" dilewati karena glossary kosong.
    expect(conversion.skipped.count).toBe(1);
    expect(conversion.entries[3]?.definitions).toEqual([
      'to come',
      {
        tag: 'ul',
        data: { content: 'references' },
        content: [
          {
            tag: 'li',
            content: [
              'see: ',
              '行く',
              { tag: 'span', data: { content: 'refGlosses' }, content: ' 1. to go' },
            ],
          },
        ],
      },
    ]);
    expect(conversion.entries[3]?.priority).toBe(1999800);
  });
});

describe('gambar (structured content)', () => {
  it('mempertahankan simpul img beserta atributnya dan mengumpulkan jalur media unik', () => {
    const conversion = definitionsFromGlossary([
      {
        type: 'structured-content',
        content: [
          {
            tag: 'img',
            path: 'gambar/ikan.png',
            width: 16,
            height: 16,
            sizeUnits: 'px',
            appearance: 'monochrome',
            pixelated: true,
            alt: 'ikan',
            title: 'Ikan',
          },
          { tag: 'img', path: 'gambar/ikan.png' },
          { type: 'image', path: 'gambar/neko.png' },
        ],
      },
    ]);
    expect(conversion.definitions).toEqual([
      {
        tag: 'img',
        path: 'gambar/ikan.png',
        width: 16,
        height: 16,
        sizeUnits: 'px',
        appearance: 'monochrome',
        pixelated: true,
        alt: 'ikan',
        title: 'Ikan',
      },
      { tag: 'img', path: 'gambar/ikan.png' },
      { tag: 'img', path: 'gambar/neko.png' },
    ]);
    expect(conversion.media).toEqual(['gambar/ikan.png', 'gambar/neko.png']);
  });

  it('menghitung atribut img yang tidak didukung', () => {
    const conversion = definitionsFromGlossary([
      {
        type: 'structured-content',
        content: {
          tag: 'img',
          path: 'gambar/a.png',
          border: '1px solid',
          collapsible: true,
          imageRendering: 'pixelated',
        },
      },
    ]);
    expect(conversion.definitions).toEqual([{ tag: 'img', path: 'gambar/a.png' }]);
    const labels = [...conversion.unsupported.keys()];
    expect(labels.some((label) => label.includes('border'))).toBe(true);
    expect(labels.some((label) => label.includes('collapsible'))).toBe(true);
    expect(labels.some((label) => label.includes('imageRendering'))).toBe(true);
  });

  it('menerima nilai atribut gambar berupa string ala kamus nyata (sankoku8)', () => {
    const conversion = definitionsFromGlossary([
      {
        type: 'structured-content',
        content: {
          tag: 'img',
          path: 'sankoku8/svg-accent/アクセント.svg',
          width: '1',
          height: '0.5',
          sizeUnits: "'em'",
          appearance: "'monochrome'",
          collapsible: 'false',
        },
      },
    ]);
    // Tanda kutip literal dan angka berbentuk string dinormalkan; `collapsible` dibuang
    // dan dilaporkan, tetapi gambarnya tetap tersimpan.
    expect(conversion.definitions).toEqual([
      {
        tag: 'img',
        path: 'sankoku8/svg-accent/アクセント.svg',
        width: 1,
        height: 0.5,
        sizeUnits: 'em',
        appearance: 'monochrome',
      },
    ]);
    expect(conversion.media).toEqual(['sankoku8/svg-accent/アクセント.svg']);
    expect([...conversion.unsupported.keys()].some((label) => label.includes('collapsible'))).toBe(true);
  });

  it('membuang hanya atribut gambar yang tidak sah, bukan gambarnya', () => {
    const conversion = definitionsFromGlossary([
      {
        type: 'structured-content',
        content: {
          tag: 'img',
          path: 'gambar/b.png',
          width: 2,
          verticalAlign: 'tengah',
        },
      },
    ]);
    expect(conversion.definitions).toEqual([{ tag: 'img', path: 'gambar/b.png', width: 2 }]);
    expect(conversion.media).toEqual(['gambar/b.png']);
    expect([...conversion.unsupported.keys()].some((label) => label.includes('verticalAlign'))).toBe(true);
  });

  it('melewatkan img tanpa path yang sah dan menghitungnya', () => {
    const conversion = definitionsFromGlossary([
      {
        type: 'structured-content',
        content: [
          { tag: 'img' },
          { tag: 'img', path: 'https://contoh.invalid/x.png' },
          'teks',
        ],
      },
    ]);
    expect(conversion.definitions).toEqual(['teks']);
    expect(conversion.media).toEqual([]);
    expect([...conversion.unsupported.keys()].some((label) => label.includes('path'))).toBe(true);
  });
});

describe('convertKanjiBank', () => {
  it('memetakan baris kanji yang valid', () => {
    const result = convertKanjiBank([
      ['日', 'ニチ ジツ', 'ひ か', 'ichi', ['day', 'sun'], { grade: '1', strokes: '4' }],
    ]);
    expect(result.skipped).toBe(0);
    expect(result.entries).toEqual([
      {
        character: '日',
        onyomi: ['ニチ', 'ジツ'],
        kunyomi: ['ひ', 'か'],
        tags: ['ichi'],
        meanings: ['day', 'sun'],
        stats: { grade: '1', strokes: '4' },
      },
    ]);
  });

  it('melewatkan baris kanji yang tidak sesuai dan menghitungnya', () => {
    const result = convertKanjiBank([
      ['日', 'ニチ', 'ひ', 'ichi', ['day'], { grade: '1' }],
      ['', 'ニチ', 'ひ', 'ichi', ['day'], {}],
      ['水', 'スイ', 'みず', 'ichi', 'bukan array', {}],
      ['火'],
      'bukan baris',
      ['木', 'モク', 'き', 'ichi', ['tree'], { grade: 1 }],
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.character).toBe('日');
    expect(result.skipped).toBe(5);
  });

  it('menolak bank kanji yang bukan array', () => {
    expect(convertKanjiBank({}).skipped).toBe(1);
  });
});

describe('convertTermMetaBank', () => {
  it('menggabungkan nilai pitch untuk (expression, reading) yang sama', () => {
    const result = convertTermMetaBank([
      ['食べる', 'pitch', { reading: 'たべる', pitches: [{ position: 2, devoice: [2], nasal: [] }] }],
      ['食べる', 'pitch', { reading: 'たべる', pitches: [{ position: 1 }] }],
      ['食べる', 'pitch', { pitches: [{ position: 0 }] }],
    ]);
    expect(result.skipped).toBe(0);
    expect(result.entries).toEqual([
      {
        expression: '食べる',
        reading: 'たべる',
        values: [
          { type: 'pitch', reading: 'たべる', pitches: [{ position: 2, devoice: [2], nasal: [] }] },
          { type: 'pitch', reading: 'たべる', pitches: [{ position: 1, devoice: [], nasal: [] }] },
        ],
      },
      {
        expression: '食べる',
        reading: '食べる',
        values: [
          { type: 'pitch', reading: '食べる', pitches: [{ position: 0, devoice: [], nasal: [] }] },
        ],
      },
    ]);
  });

  it('menormalkan posisi mora berbentuk string dan membuang penanda yang tidak terbaca', () => {
    const result = convertTermMetaBank([
      ['飲む', 'pitch', { reading: 'のむ', pitches: [{ position: 0, devoice: ['2'], nasal: ['た'] }] }],
    ]);
    expect(result.skipped).toBe(0);
    // Posisi mora yang bisa dibaca tetap dipakai; penanda asing dibuang tanpa
    // menggugurkan nilai pitch-nya (pola `_toNumberArray` Yomitan).
    expect(result.entries[0]?.values).toEqual([
      { type: 'pitch', reading: 'のむ', pitches: [{ position: 0, devoice: [2], nasal: [] }] },
    ]);
  });

  it('menerima dua bentuk data frekuensi dan menormalkan varian tipe', () => {
    const result = convertTermMetaBank([
      ['猫', 'freq', { value: 1000, displayValue: '1000' }],
      ['猫', 'frequency', { reading: 'ねこ', frequency: { value: 2000 } }],
      ['犬', 'freq', { value: 500 }],
    ]);
    expect(result.skipped).toBe(0);
    expect(result.entries).toEqual([
      {
        expression: '猫',
        reading: '',
        values: [{ type: 'freq', reading: '', frequency: { value: 1000, displayValue: '1000' } }],
      },
      {
        expression: '猫',
        reading: 'ねこ',
        values: [{ type: 'freq', reading: 'ねこ', frequency: { value: 2000 } }],
      },
      {
        expression: '犬',
        reading: '',
        values: [{ type: 'freq', reading: '', frequency: { value: 500 } }],
      },
    ]);
  });

  it('menghitung tipe meta yang tidak dikenal dan baris yang tidak sesuai', () => {
    const result = convertTermMetaBank([
      ['猫', 'pitch', { pitches: [{ position: 0 }] }],
      ['猫', 'forms', {}],
      ['猫', 'freq', { value: 'bukan angka' }],
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect([...result.unsupported.keys()].some((label) => label.includes('forms'))).toBe(true);
  });
});
