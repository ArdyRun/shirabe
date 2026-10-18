// @vitest-environment happy-dom
/**
 * Pengujian graf pitch accent.
 *
 * Geometrinya disalin dari Yomitan/Hachidori (`ext/js/display/pronunciation-generator.js`
 * dan `render/glossary.js`), jadi yang diuji di sini adalah hasil hitungannya: pemecahan
 * mora, tinggi/rendah tiap mora, kategori aksen, dan penanda di dalam SVG.
 */

import { describe, expect, it } from 'vitest';
import {
  isMoraPitchHigh,
  pitchCategory,
  pitchMarks,
  pitchMorae,
  pitchReading,
} from '../../src/ui/pitch.js';

describe('pitchMorae', () => {
  it('menggabungkan kana kecil dengan mora sebelumnya', () => {
    expect(pitchMorae('がくせい')).toEqual(['が', 'く', 'せ', 'い']);
    expect(pitchMorae('しゃしん')).toEqual(['しゃ', 'し', 'ん']);
    expect(pitchMorae('きょうと')).toEqual(['きょ', 'う', 'と']);
  });

  it('menghitung っ, ん, dan ー sebagai mora tersendiri', () => {
    expect(pitchMorae('がっこう')).toEqual(['が', 'っ', 'こ', 'う']);
    expect(pitchMorae('コーヒー')).toEqual(['コ', 'ー', 'ヒ', 'ー']);
  });

  it('mengembalikan daftar kosong untuk bacaan kosong', () => {
    expect(pitchMorae('')).toEqual([]);
  });
});

describe('isMoraPitchHigh', () => {
  it('menghitung pola heiban (0), atamadaka (1), dan nakadaka (n)', () => {
    // 4 mora + satu posisi partikel sesudahnya.
    expect([0, 1, 2, 3, 4].map((index) => isMoraPitchHigh(index, 0))).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
    expect([0, 1, 2, 3, 4].map((index) => isMoraPitchHigh(index, 1))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect([0, 1, 2, 3, 4].map((index) => isMoraPitchHigh(index, 3))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
  });

  it('membuat partikel setelah kata odaka jatuh (rendah)', () => {
    // Downstep di mora terakhir: kata tinggi sampai mora itu, partikelnya rendah.
    expect(isMoraPitchHigh(4, 4)).toBe(false);
  });
});

describe('pitchCategory', () => {
  it('mengenali heiban, atamadaka, nakadaka, dan odaka', () => {
    expect(pitchCategory('がくせい', 0)).toBe('heiban');
    expect(pitchCategory('がくせい', 1)).toBe('atamadaka');
    expect(pitchCategory('がくせい', 2)).toBe('nakadaka');
    expect(pitchCategory('がくせい', 3)).toBe('nakadaka');
    expect(pitchCategory('がくせい', 4)).toBe('odaka');
    // Posisi di luar jumlah mora tetap dianggap odaka (data kamus longgar).
    expect(pitchCategory('がくせい', 5)).toBe('odaka');
  });
});

describe('pitchReading', () => {
  function moraeOf(reading: string, position: number): Element[] {
    const container = pitchReading(pitchMorae(reading), position);
    return [...container.querySelectorAll('.pitch-reading__mora')];
  }

  it('menandai tiap mora tinggi atau rendah dan menandai perubahannya', () => {
    // Atamadaka: mora pertama tinggi, sisanya rendah; turunnya terjadi di mora kedua.
    const atamadaka = moraeOf('がくせい', 1);
    expect(atamadaka.map((mora) => mora.getAttribute('data-pitch-level'))).toEqual([
      'high',
      'low',
      'low',
      'low',
    ]);
    expect(atamadaka.map((mora) => mora.getAttribute('data-pitch-transition'))).toEqual([
      null,
      'down',
      null,
      null,
    ]);

    // Heiban: hanya mora pertama rendah, lalu naik dan bertahan tinggi.
    const heiban = moraeOf('がくせい', 0);
    expect(heiban.map((mora) => mora.getAttribute('data-pitch-level'))).toEqual([
      'low',
      'high',
      'high',
      'high',
    ]);
    expect(heiban.map((mora) => mora.getAttribute('data-pitch-transition'))).toEqual([
      null,
      'up',
      null,
      null,
    ]);
  });

  it('menampilkan kana tiap mora apa adanya, termasuk kana kecil yang menempel', () => {
    const morae = moraeOf('しゃしん', 0);
    expect(morae.map((mora) => mora.textContent)).toEqual(['しゃ', 'し', 'ん']);
  });

  it('menambahkan penanda ujung saat nada turun setelah kata (odaka)', () => {
    const odaka = pitchReading(pitchMorae('がくせい'), 4);
    expect(odaka.querySelector('.pitch-reading__tail')?.getAttribute('data-pitch-tail')).toBe('down');
    const heiban = pitchReading(pitchMorae('がくせい'), 0);
    expect(heiban.querySelector('.pitch-reading__tail')).toBeNull();
  });

  it('tidak menggambar mora apa pun untuk bacaan kosong', () => {
    const container = pitchReading([], 0);
    expect(container.querySelectorAll('.pitch-reading__mora')).toHaveLength(0);
  });
});

describe('pitchMarks', () => {
  it('menyaring posisi mora yang di luar jumlah mora', () => {
    expect(pitchMarks(4, [2, 9, 0], [1])).toEqual({ devoice: [2], nasal: [1] });
    expect(pitchMarks(0, [1], [])).toEqual({ devoice: [], nasal: [] });
  });
});
