import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, parseEntry, parseHeader, splitLines } from '../../src/core/jsonl.js';
import { IMPORT_LIMITS } from '../../src/core/limits.js';

const validHeader = {
  type: 'shirabe-dictionary',
  schemaVersion: SCHEMA_VERSION,
  id: 'contoh-ja-id',
  name: 'Kamus Contoh',
  language: 'ja',
  definitionLanguage: 'id',
  license: 'CC0-1.0',
  attribution: 'Sumber contoh',
};

describe('parseHeader', () => {
  it('menerima header valid', () => {
    const result = parseHeader(JSON.stringify(validHeader));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('contoh-ja-id');
      expect(result.warnings).toEqual([]);
    }
  });

  it('menolak tipe dokumen yang salah', () => {
    const result = parseHeader(JSON.stringify({ ...validHeader, type: 'lain' }));
    expect(result.ok).toBe(false);
  });

  it('menolak versi schema yang tidak didukung dengan pesan jelas', () => {
    const result = parseHeader(JSON.stringify({ ...validHeader, schemaVersion: 99 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('99');
      expect(result.reason).toContain(String(SCHEMA_VERSION));
    }
  });

  it('menolak ID yang tidak aman untuk kunci storage', () => {
    const result = parseHeader(JSON.stringify({ ...validHeader, id: '../etc/passwd' }));
    expect(result.ok).toBe(false);
  });

  it('memberi peringatan bila lisensi/atribusi kosong', () => {
    const result = parseHeader(JSON.stringify({ ...validHeader, license: '', attribution: '' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toHaveLength(2);
    }
  });

  it('menolak JSON yang rusak', () => {
    expect(parseHeader('{bukan json').ok).toBe(false);
  });
});

describe('parseEntry', () => {
  it('menerima entry minimal', () => {
    const result = parseEntry(JSON.stringify({ expression: '食べる', definitions: ['makan'] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reading).toBe('');
      expect(result.value.partOfSpeech).toEqual([]);
    }
  });

  it('menolak entry tanpa definisi', () => {
    expect(parseEntry(JSON.stringify({ expression: '食べる', definitions: [] })).ok).toBe(false);
  });

  it('menolak definisi bukan string', () => {
    expect(parseEntry(JSON.stringify({ expression: '食べる', definitions: [1] })).ok).toBe(false);
  });

  it('menolak expression kosong', () => {
    expect(parseEntry(JSON.stringify({ expression: '  ', definitions: ['x'] })).ok).toBe(false);
  });

  it('menolak markup HTML pada data kamus', () => {
    const result = parseEntry(
      JSON.stringify({ expression: '<img src=x>', definitions: ['<b>makan</b>'] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('HTML');
    }
  });

  it('menolak karakter kontrol', () => {
    expect(parseEntry(JSON.stringify({ expression: 'a\u0007b', definitions: ['x'] })).ok).toBe(false);
  });

  it('menolak string yang melebihi batas', () => {
    const long = 'あ'.repeat(IMPORT_LIMITS.maxStringCodePoints + 1);
    expect(parseEntry(JSON.stringify({ expression: long, definitions: ['x'] })).ok).toBe(false);
  });

  it('menolak terlalu banyak definisi', () => {
    const definitions = Array.from({ length: IMPORT_LIMITS.maxDefinitionsPerEntry + 1 }, () => 'x');
    expect(parseEntry(JSON.stringify({ expression: '学生', definitions })).ok).toBe(false);
  });

  it('mendeduplikasi tag', () => {
    const result = parseEntry(
      JSON.stringify({ expression: '学生', definitions: ['pelajar'], tags: ['umum', 'umum'] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tags).toEqual(['umum']);
    }
  });

  it('mengabaikan field tambahan yang tidak dikenal', () => {
    const result = parseEntry(
      JSON.stringify({ expression: '学生', definitions: ['pelajar'], fieldBaru: 1 }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('splitLines', () => {
  it('menyimpan sisa buffer tanpa baris terakhir yang belum lengkap', () => {
    expect(splitLines('a\nb\nc')).toEqual({ lines: ['a', 'b'], rest: 'c' });
    expect(splitLines('a\r\nb\r\n')).toEqual({ lines: ['a', 'b'], rest: '' });
  });
});
