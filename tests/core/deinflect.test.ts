import { describe, expect, it } from 'vitest';
import { deinflect } from '../../src/core/deinflect.js';
import {
  ALL_CONDITIONS,
  DEINFLECTION_RULES,
  DEINFLECTION_TRANSFORMS,
  POS_CONDITIONS,
} from '../../src/core/rules.js';

/** Rantai transformasi (nama langkah) untuk sebuah lema. */
function chainFor(surface: string, lemma: string): string[] {
  const analysis = deinflect(surface).find((candidate) => candidate.lemma === lemma);
  return analysis?.steps.map((step) => step.transformId) ?? [];
}

function lemmas(surface: string): string[] {
  return deinflect(surface).map((analysis) => analysis.lemma);
}

describe('deinflect', () => {
  it('mengembalikan bentuk kamus untuk verba ichidan sopan dan lampau', () => {
    expect(lemmas('食べました')).toContain('食べる');
    expect(lemmas('食べます')).toContain('食べる');
    expect(lemmas('食べません')).toContain('食べる');
    expect(lemmas('食べませんでした')).toContain('食べる');
    expect(lemmas('食べて')).toContain('食べる');
    expect(lemmas('食べた')).toContain('食べる');
    expect(lemmas('食べない')).toContain('食べる');
  });

  it('menangani bentuk te dan lampau verba godan per row', () => {
    expect(lemmas('書いて')).toContain('書く');
    expect(lemmas('書いた')).toContain('書く');
    expect(lemmas('書きます')).toContain('書く');
    expect(lemmas('書きました')).toContain('書く');
    expect(lemmas('書かない')).toContain('書く');
    expect(lemmas('待って')).toContain('待つ');
    expect(lemmas('買った')).toContain('買う');
    expect(lemmas('読んで')).toContain('読む');
    expect(lemmas('話して')).toContain('話す');
    expect(lemmas('泳いで')).toContain('泳ぐ');
    expect(lemmas('遊んだ')).toContain('遊ぶ');
    expect(lemmas('死んだ')).toContain('死ぬ');
  });

  it('menangani 行く yang tidak teratur (bentuk te/lampau v5t)', () => {
    expect(lemmas('行って')).toContain('行く');
    expect(lemmas('行った')).toContain('行く');
  });

  it('menangani suru dan kuru', () => {
    expect(lemmas('します')).toContain('する');
    expect(lemmas('しました')).toContain('する');
    expect(lemmas('して')).toContain('する');
    expect(lemmas('勉強します')).toContain('勉強する');
    expect(lemmas('来た')).toContain('来る');
    expect(lemmas('来ます')).toContain('来る');
    expect(lemmas('来て')).toContain('来る');
  });

  it('menangani adjektiva-i umum', () => {
    expect(lemmas('高くない')).toContain('高い');
    expect(lemmas('高かった')).toContain('高い');
    expect(lemmas('高くて')).toContain('高い');
    expect(lemmas('高くなかった')).toContain('高い');
  });

  it('menangani adjektiva-na tanpa だ', () => {
    expect(lemmas('静かでした')).toContain('静か');
    expect(lemmas('静かじゃない')).toContain('静か');
  });

  it('membawa nama transformasi dan kelas kata pada setiap langkah', () => {
    const past = deinflect('食べました').find((analysis) => analysis.lemma === '食べる');
    expect(past?.steps).toHaveLength(1);
    expect(past?.steps[0]?.transformId).toBe('-ました');
    expect(past?.steps[0]?.from).toBe('ました');
    expect(past?.partOfSpeech).toContain('v1');
  });

  it('merantai transformasi majemuk 聞こえてきた → 聞こえる', () => {
    expect(chainFor('聞こえてきた', '聞こえる')).toEqual(['-た', '-くる', '-て']);
    // 聞こえてきて = bentuk te dari 聞こえてくる, jadi rantainya satu langkah lebih panjang.
    expect(chainFor('聞こえてきて', '聞こえる')).toEqual(['-て', '-くる', '-て']);
    expect(chainFor('書いてしまった', '書く')).toEqual(['-た', '-しまう', '-て']);
    expect(chainFor('読んでいる', '読む')).toEqual(['-いる', '-て']);
    expect(chainFor('食べていました', '食べる')).toEqual(['-ました', '-いる', '-て']);
  });

  it('menghasilkan lema antara sebagai kandidat sendiri', () => {
    // 聞こえてくる bisa saja terdaftar sebagai entri; rantai satu langkah tetap valid.
    expect(chainFor('聞こえてきた', '聞こえてくる')).toEqual(['-た']);
  });

  it('membatasi kedalaman rantai', () => {
    const shallow = deinflect('食べていました', { maxDepth: 1 });
    expect(shallow.map((analysis) => analysis.lemma)).not.toContain('食べる');
    const deep = deinflect('食べていました', { maxDepth: 4 });
    expect(deep.map((analysis) => analysis.lemma)).toContain('食べる');
  });

  it('menetapkan kelas kata lema dari kondisi keluar rule', () => {
    const analysis = deinflect('書いた').find((candidate) => candidate.lemma === '書く');
    expect(analysis?.partOfSpeech).toContain('v5k');
    // Tag grup juga diterima supaya dataset bertag `v5` tetap cocok.
    expect(analysis?.partOfSpeech).toContain('v5');
    expect(analysis?.partOfSpeech.every((pos) => POS_CONDITIONS.includes(pos))).toBe(true);
  });

  it('menghasilkan lebih dari satu kandidat untuk akhiran ambigu', () => {
    const candidates = lemmas('待って');
    expect(candidates).toContain('待つ');
    expect(candidates).toContain('待う');
    expect(candidates).toContain('待る');
  });

  it('tidak menghasilkan apa pun untuk akhiran yang tidak dikenali', () => {
    expect(lemmas('食べる')).toEqual([]);
    expect(lemmas('')).toEqual([]);
  });

  it('memakai batas jumlah analisis', () => {
    const limited = deinflect('遊んだ', { maxAnalyses: 1 });
    expect(limited).toHaveLength(1);
  });

  it('tidak mengulang kondisi yang sama dua kali (anti siklus)', () => {
    // Setiap kondisi hasil hanya dikunjungi sekali, jadi analisis tidak meledak.
    const analyses = deinflect('食べてしまいました');
    expect(analyses.map((analysis) => analysis.lemma)).toContain('食べる');
    expect(analyses.length).toBeLessThanOrEqual(128);
  });

  it('tidak memotong surrogat pair pada rule data', () => {
    const analyses = deinflect('\u{20000}った');
    expect(analyses.every((analysis) => !analysis.lemma.includes('\ud83d'))).toBe(true);
  });

  it('setiap rule memiliki ID unik dan akhiran non-kosong', () => {
    const ids = new Set<string>();
    for (const rule of DEINFLECTION_RULES) {
      expect(rule.from.length).toBeGreaterThan(0);
      expect(ids.has(rule.id)).toBe(false);
      ids.add(rule.id);
    }
  });
});

describe('tabel transformasi', () => {
  it('setiap transformasi yang dipakai rule punya kunci deskripsi', () => {
    const used = new Set(DEINFLECTION_RULES.map((rule) => rule.transform));
    expect([...used].sort()).toEqual(DEINFLECTION_TRANSFORMS.map((item) => item.id).sort());
    for (const transform of DEINFLECTION_TRANSFORMS) {
      expect(transform.descriptionKey.length).toBeGreaterThan(0);
    }
  });

  it('setiap rule menyatakan kondisi masuk dan keluar dari kosakata yang dikenal', () => {
    const known = new Set(ALL_CONDITIONS);
    for (const rule of DEINFLECTION_RULES) {
      expect(rule.conditionsIn.length).toBeGreaterThan(0);
      expect(rule.conditionsOut.length).toBeGreaterThan(0);
      for (const condition of [...rule.conditionsIn, ...rule.conditionsOut]) {
        expect(known.has(condition)).toBe(true);
      }
    }
  });
});
