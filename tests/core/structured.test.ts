/**
 * Pengujian validasi structured content (schema v2) — PRD 8.1, 8.4, 13.
 *
 * Yang dijaga: hanya subset tag/gaya yang didukung yang dapat masuk dataset, batas
 * ukuran dihormati, dan tidak ada jalur ke elemen yang memuat jaringan atau skrip.
 */

import { describe, expect, it } from 'vitest';
import { IMPORT_LIMITS } from '../../src/core/limits.js';
import {
  structuredText,
  validateDefinitionItem,
  type StructuredNode,
} from '../../src/core/structured.js';
import { parseEntry, parseHeader } from '../../src/core/jsonl.js';

const header = {
  type: 'shirabe-dictionary',
  schemaVersion: 2,
  id: 'v2-contoh',
  name: 'Kamus v2',
  language: 'ja',
  definitionLanguage: 'en',
  license: 'CC0-1.0',
  attribution: 'Sumber contoh',
};

function entryWith(definitions: unknown[]): string {
  return JSON.stringify({
    expression: '俺',
    reading: 'おれ',
    definitions,
    partOfSpeech: ['pn'],
    tags: [],
    rules: [],
  });
}

describe('validateDefinitionItem', () => {
  it('menerima string pada schema v1 dan v2', () => {
    expect(validateDefinitionItem('pelajar', false)).toEqual({ ok: true, value: 'pelajar' });
    expect(validateDefinitionItem('pelajar', true)).toEqual({ ok: true, value: 'pelajar' });
  });

  it('menolak simpul saat schema v1 dengan pesan yang menunjuk versi 2', () => {
    const result = validateDefinitionItem({ tag: 'table', content: [] }, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('schemaVersion: 2');
    }
  });

  it('menerima tabel dengan gaya yang didukung', () => {
    const result = validateDefinitionItem(
      {
        tag: 'table',
        content: [
          {
            tag: 'tr',
            content: [
              { tag: 'th', content: '俺', style: { textAlign: 'center' } },
              { tag: 'td', content: '★' },
            ],
          },
        ],
      },
      true,
    );
    expect(result.ok).toBe(true);
  });

  it('menolak tag di luar daftar putih', () => {
    for (const tag of ['script', 'iframe', 'img', 'a', 'blink', 'custom-element']) {
      const result = validateDefinitionItem({ tag, content: 'x' }, true);
      expect(result.ok, tag).toBe(false);
    }
  });

  it('menolak atribut dan properti gaya yang tidak didukung', () => {
    expect(validateDefinitionItem({ tag: 'div', className: 'x', content: 'y' }, true).ok).toBe(false);
    expect(
      validateDefinitionItem({ tag: 'div', style: { backgroundImage: 'url(x.png)' }, content: 'y' }, true).ok,
    ).toBe(false);
    expect(
      validateDefinitionItem({ tag: 'div', style: { textAlign: 'wat' }, content: 'y' }, true).ok,
    ).toBe(false);
    // Nilai `list-style-type` dengan fungsi CSS dapat memicu permintaan jaringan.
    expect(
      validateDefinitionItem({ tag: 'ul', style: { listStyleType: "url(https://x/y)" }, content: [] }, true).ok,
    ).toBe(false);
  });

  it('menerima peran konten camelCase dari Yomitan', () => {
    const result = validateDefinitionItem(
      { tag: 'span', data: { content: 'refGlosses' }, content: ' 1. to go' },
      true,
    );
    expect(result.ok).toBe(true);
  });

  it('menolak markup HTML di dalam teks', () => {
    expect(validateDefinitionItem({ tag: 'div', content: '<img src=x>' }, true).ok).toBe(false);
  });

  it('menolak sarang yang terlalu dalam dan jumlah simpul yang berlebihan', () => {
    let deep: StructuredNode = { tag: 'div', content: 'x' };
    for (let index = 0; index <= IMPORT_LIMITS.maxStructuredDepth; index += 1) {
      deep = { tag: 'div', content: deep };
    }
    expect(validateDefinitionItem(deep, true).ok).toBe(false);

    const many = Array.from({ length: IMPORT_LIMITS.maxStructuredNodesPerDefinition + 1 }, () => ({
      tag: 'div',
      content: 'x',
    }));
    expect(validateDefinitionItem({ tag: 'div', content: many }, true).ok).toBe(false);
  });
});

describe('parseEntry dengan schema v2', () => {
  it('menerima definisi berstruktur dari header v2', () => {
    const result = parseEntry(entryWith([{ tag: 'table', content: [{ tag: 'tr', content: [] }] }]), {
      schemaVersion: 2,
    });
    expect(result.ok).toBe(true);
  });

  it('menolak definisi berstruktur pada header v1', () => {
    const result = parseEntry(entryWith([{ tag: 'table', content: [] }]), { schemaVersion: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('schemaVersion: 2');
    }
  });
});

describe('parseHeader', () => {
  it('menerima versi 1 dan 2', () => {
    expect(parseHeader(JSON.stringify(header)).ok).toBe(true);
    expect(parseHeader(JSON.stringify({ ...header, schemaVersion: 1 })).ok).toBe(true);
  });
});

describe('structuredText', () => {
  it('meratakan tabel menjadi teks berurutan', () => {
    expect(
      structuredText({
        tag: 'table',
        content: [
          {
            tag: 'tr',
            content: [
              { tag: 'th', content: '俺' },
              { tag: 'th', content: '己' },
            ],
          },
        ],
      }),
    ).toBe('俺己');
  });

  it('mengabaikan furigana (rt) saat meratakan', () => {
    expect(
      structuredText({
        tag: 'ruby',
        content: ['学生', { tag: 'rt', content: 'がくせい' }],
      }),
    ).toBe('学生');
  });
});
