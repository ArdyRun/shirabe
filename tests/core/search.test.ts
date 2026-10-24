import { describe, expect, it } from 'vitest';
import { candidatePrefixes, candidateWindows, lookup, rankMatches } from '../../src/core/search.js';
import type { DictionaryEntry, LookupMatch } from '../../src/core/types.js';
import { createMemorySource } from '../helpers/memory-source.js';

const corpus = createMemorySource([
  { expression: '食べる', reading: 'たべる', definitions: ['makan'], partOfSpeech: ['v1'], rules: ['v1'] },
  { expression: '書く', reading: 'かく', definitions: ['menulis'], partOfSpeech: ['v5k'], rules: ['v5k'] },
  { expression: '高い', reading: 'たかい', definitions: ['tinggi'], partOfSpeech: ['adj-i'], rules: ['adj-i'] },
  { expression: 'する', reading: 'する', definitions: ['melakukan'], partOfSpeech: ['vs'], rules: ['vs'] },
  { expression: '来る', reading: 'くる', definitions: ['datang'], partOfSpeech: ['vk'], rules: ['vk'] },
  { expression: '学生', reading: 'がくせい', definitions: ['pelajar'], partOfSpeech: ['n'] },
  { expression: '東京都', reading: 'とうきょうと', definitions: ['Prefektur Tokyo'], partOfSpeech: ['n'] },
  { expression: '東京', reading: 'とうきょう', definitions: ['Tokyo'], partOfSpeech: ['n'] },
  { expression: '橋', reading: 'はし', definitions: ['jembatan'], partOfSpeech: ['n'] },
  { expression: '箸', reading: 'はし', definitions: ['sumpit'], partOfSpeech: ['n'] },
  { expression: '猫', reading: '', definitions: ['kucing'], partOfSpeech: ['n'] },
  { expression: '静か', reading: 'しずか', definitions: ['tenang'], partOfSpeech: ['adj-na'], rules: ['adj-na'] },
  { expression: '待つ', reading: 'まつ', definitions: ['menunggu'], partOfSpeech: ['v5t'], rules: ['v5t'] },
  { expression: '野生', reading: 'やせい', definitions: ['liar'], partOfSpeech: ['adj-na'], rules: ['adj-na'] },
]);

function expressions(matches: LookupMatch[]): string[] {
  return matches.map((match) => match.entry.expression);
}

describe('lookup: corpus morfologi MVP (PRD 4.4)', () => {
  it.each([
    ['食べました', '食べる'],
    ['書いて', '書く'],
    ['高くない', '高い'],
    ['します', 'する'],
    ['来た', '来る'],
  ])('%s → %s', async (query, expected) => {
    const result = await lookup(query, corpus);
    expect(result.status).toBe('ok');
    expect(expressions(result.matches)).toContain(expected);
    expect(result.matches[0]?.matchType).toBe('deinflected');
  });
});

describe('lookup: bentuk kanji kuru (来る)', () => {
  // Bentuk kana (`きます`) tidak cocok dengan `来ます`; tanpa aturan kanji khusus,
  // deinflection v1 menghasilkan `来る` bertag `v1` yang ditolak validasi POS `vk`.
  it.each([
    ['来ます', 'ます'],
    ['来ました', 'ました'],
    ['来ません', 'ません'],
    ['来ませんでした', 'ませんでした'],
    ['来ない', 'ない'],
    ['来なかった', 'なかった'],
    ['来なくて', 'なくて'],
    ['来ず', 'ず'],
    ['来れば', 'れば'],
    ['来よう', 'よう'],
    ['来た', 'た'],
    ['来て', 'て'],
    ['来い', 'ろ'],
  ])('%s → 来る (%s)', async (query) => {
    const result = await lookup(query, corpus);
    expect(result.status).toBe('ok');
    expect(result.matches[0]?.entry.expression).toBe('来る');
    expect(result.matches[0]?.matchType).toBe('deinflected');
  });
});

describe('lookup: pitch accent, frekuensi, dan kanji (bank meta/kanji)', () => {
  const withAux = createMemorySource(
    [{ expression: '食べる', reading: 'たべる', definitions: ['makan'], partOfSpeech: ['v1'] }],
    {
      meta: [
        {
          dictionaryId: 'pitch',
          dictionaryName: 'Kamus Pitch',
          dictionaryOrder: 1,
          expression: '食べる',
          reading: 'たべる',
          values: [
            {
              type: 'pitch',
              reading: 'たべる',
              pitches: [{ position: 2, devoice: [], nasal: [] }],
            },
            { type: 'freq', reading: 'たべる', frequency: { value: 12, displayValue: '12㋕' } },
          ],
        },
      ],
      kanji: [
        {
          dictionaryId: 'kanjidic',
          dictionaryName: 'KANJIDIC',
          dictionaryOrder: 2,
          character: '食',
          onyomi: ['ショク'],
          kunyomi: ['た.べる'],
          tags: ['jouyou'],
          meanings: ['eat', 'food'],
          stats: { strokes: '9', grade: '2' },
        },
      ],
    },
  );

  it('mengisi meta untuk istilah yang cocok dan tetap array kosong bila tidak ada', async () => {
    const result = await lookup('食べる', withAux);
    expect(result.meta).toHaveLength(1);
    expect(result.meta[0]?.values.map((value) => value.type)).toEqual(['pitch', 'freq']);

    const tanpaMeta = await lookup('学生', withAux);
    expect(tanpaMeta.meta).toEqual([]);
  });

  it('mengambil kanji hanya bila diminta, dan tetap sukses walau tidak ada istilah', async () => {
    const biasa = await lookup('食', withAux);
    expect(biasa.kanji).toEqual([]);

    const klik = await lookup('食', withAux, { kanji: true });
    expect(klik.kanji.map((item) => item.character)).toEqual(['食']);
    expect(klik.kanji[0]?.meanings).toContain('eat');
  });

  it('mengambil data kanji walau kamus itu tidak punya istilah sama sekali', async () => {
    // Kamus kanji/pitch nyata tidak punya term bank: lookup kanji harus tetap berhasil.
    const kanjiOnly = createMemorySource([], {
      kanji: [
        {
          dictionaryId: 'kanjidic',
          dictionaryName: 'KANJIDIC',
          dictionaryOrder: 0,
          character: '鬱',
          onyomi: ['ウツ'],
          kunyomi: ['うっ.する'],
          tags: ['jouyou'],
          meanings: ['gloom', 'depression'],
          stats: { strokes: '29' },
        },
      ],
    });
    const result = await lookup('鬱', kanjiOnly, { kanji: true });
    expect(result.status).toBe('ok');
    expect(result.matches).toEqual([]);
    expect(result.kanji[0]?.character).toBe('鬱');
  });
});

describe('lookup: exact dan kandidat terpanjang', () => {
  it('mendahulukan exact match atas deinflection', async () => {
    const source = createMemorySource([
      { expression: '食べました', reading: 'たべました', definitions: ['bentuk lampau'], partOfSpeech: ['v1'] },
      { expression: '食べる', reading: 'たべる', definitions: ['makan'], partOfSpeech: ['v1'], rules: ['v1'] },
    ]);
    const result = await lookup('食べました', source);
    expect(result.matches[0]?.entry.expression).toBe('食べました');
    expect(result.matches[0]?.matchType).toBe('exact');
  });

  it('memilih kandidat terpanjang pada teks tanpa spasi', async () => {
    const result = await lookup('東京都に行く', corpus);
    // Seluruh kandidat prefix yang cocok dilaporkan, terpanjang lebih dahulu.
    expect(result.matches[0]?.entry.expression).toBe('東京都');
    expect(expressions(result.matches)).toContain('東京');
    expect(result.span).toEqual({ start: 0, end: 3 });
  });

  it('kembali ke kandidat lebih pendek bila kandidat panjang tidak ditemukan', async () => {
    const result = await lookup('東京タワー', corpus);
    expect(expressions(result.matches)).toEqual(['東京']);
    expect(result.span).toEqual({ start: 0, end: 2 });
  });

  it('membatasi panjang kandidat 32 code point', async () => {
    const long = 'あ'.repeat(40);
    const result = await lookup(long, corpus);
    expect(result.status).toBe('empty');
    expect(result.inputTruncated).toBe(true);
    expect(candidatePrefixes(long, 32)).toHaveLength(32);
  });

  it('tidak memotong surrogate pair pada kandidat', async () => {
    const query = `${'\u{20000}'.repeat(31)}あ`;
    const prefixes = candidatePrefixes(query, 32);
    expect(prefixes[0]).toBe(query);
    for (const prefix of prefixes) {
      expect(prefix.includes('\ud83d') && !prefix.includes('\ud83d\udc00')).toBe(false);
    }
  });
});

describe('peringkat lintas kamus: kecocokan lebih panjang menang atas prioritas kamus', () => {
  // Kasus nyata (laporan pemilik produk): di halaman ada `呼んだ`, dan JMnedict yang
  // ditempatkan lebih awal memuat nama keluarga satu kanji `呼`. Sebelumnya prioritas kamus
  // diurutkan lebih dulu, sehingga entri nama itu muncul di depan `呼ぶ` dari JMdict.
  const source = createMemorySource([
    {
      expression: '呼',
      reading: 'こ',
      definitions: ['nama keluarga'],
      partOfSpeech: ['n'],
      dictionaryId: 'jmnedict',
      dictionaryName: 'JMnedict',
      dictionaryOrder: 0,
    },
    {
      expression: '呼ぶ',
      reading: 'よぶ',
      definitions: ['memanggil'],
      partOfSpeech: ['v5b'],
      rules: ['v5b'],
      dictionaryId: 'jmdict',
      dictionaryName: 'JMdict',
      dictionaryOrder: 1,
    },
  ]);

  it('呼んだ → 呼ぶ (JMdict) mendahului 呼 (JMnedict) yang cocok satu karakter', async () => {
    const result = await lookup('呼んだ', source);
    expect(result.matches[0]?.entry.expression).toBe('呼ぶ');
    expect(result.matches.map((match) => match.entry.expression)).toContain('呼');
  });

  it('homomim dengan panjang sama tetap mengikuti prioritas kamus pengguna', async () => {
    const homonyms = createMemorySource([
      {
        expression: '橋',
        reading: 'はし',
        definitions: ['jembatan'],
        partOfSpeech: ['n'],
        dictionaryId: 'kedua',
        dictionaryOrder: 1,
      },
      {
        expression: '橋',
        reading: 'はし',
        definitions: ['jembatan (kamus utama)'],
        partOfSpeech: ['n'],
        dictionaryId: 'utama',
        dictionaryOrder: 0,
      },
    ]);
    const result = await lookup('橋', homonyms);
    expect(result.matches[0]?.entry.dictionaryId).toBe('utama');
  });
});

describe('fragmen deinflection dari jendela pendek tidak menutupi hasil', () => {
  // Kasus nyata: kursor di tengah `呼んだ` membuat jendela `んだ` ikut diuji. Deinflection
  // `んだ` menghasilkan む/ぬ/ん, dan karena pencarian bacaan aktif, entri bacaan satu kanji
  // (無, 不, 六, …) ikut cocok — belasan kartu palsu di atas kata sebenarnya.
  const source = createMemorySource([
    { expression: '呼ぶ', reading: 'よぶ', definitions: ['memanggil'], partOfSpeech: ['v5b'], rules: ['v5b'] },
    { expression: '無', reading: 'む', definitions: ['tidak ada'], partOfSpeech: ['n'] },
    { expression: '不', reading: 'ふ', definitions: ['bukan'], partOfSpeech: ['n'] },
    { expression: '六', reading: 'む', definitions: ['enam'], partOfSpeech: ['num'] },
    { expression: 'んだ', reading: 'んだ', definitions: ['kopula percakapan'], partOfSpeech: ['aux'] },
  ]);

  it('kursor di dalam 呼んだ: 呼ぶ tampil, fragmen bacaan satu kanji tidak', async () => {
    const result = await lookup('呼んだ', source, { caretOffset: 2 });
    const expressions = result.matches.map((match) => match.entry.expression);
    expect(expressions[0]).toBe('呼ぶ');
    expect(expressions).not.toContain('無');
    expect(expressions).not.toContain('六');
    // Entri exact yang benar-benar tertulis tetap dilaporkan.
    expect(expressions).toContain('んだ');
  });

  it('fragmen awalan (bukan akhiran) tetap dipertahankan', async () => {
    // `東京` adalah awalan dari jendela `東京都`, bukan akhiran: teks yang sama tidak
    // dijelaskan olehnya, jadi keduanya tetap tampil terpanjang dahulu.
    const places = createMemorySource([
      { expression: '東京都', reading: 'とうきょうと', definitions: ['Tokyo'], partOfSpeech: ['n'] },
      { expression: '東京', reading: 'とうきょう', definitions: ['Tokyo (kota)'], partOfSpeech: ['n'] },
    ]);
    const result = await lookup('東京都', places);
    expect(result.matches.map((match) => match.entry.expression)).toEqual(['東京都', '東京']);
  });
});

describe('lookup: kamus besar dengan entry satu karakter (regresi JMdict)', () => {
  // Kamus nyata memuat entry satu kanji (食, 書, 高, 行) dan partikel kana (は).
  // Kandidat yang lebih panjang harus tetap menang karena deinflection dijalankan
  // untuk kandidat terpanjang sebelum turun ke kandidat lebih pendek.
  const large = createMemorySource([
    { expression: '食', reading: 'しょく', definitions: ['makanan'], partOfSpeech: ['n'] },
    { expression: '書', reading: 'ふみ', definitions: ['surat'], partOfSpeech: ['n'] },
    { expression: '高', reading: 'たか', definitions: ['jumlah'], partOfSpeech: ['n'] },
    { expression: '行', reading: 'くだり', definitions: ['bagian'], partOfSpeech: ['n'] },
    { expression: 'は', reading: 'は', definitions: ['partikel topik'], partOfSpeech: ['prt'] },
    { expression: 'た', reading: 'た', definitions: ['bentuk lampau'], partOfSpeech: ['aux'] },
    { expression: '食べる', reading: 'たべる', definitions: ['makan'], partOfSpeech: ['v1'], rules: ['v1'] },
    { expression: '書く', reading: 'かく', definitions: ['menulis'], partOfSpeech: ['v5k'], rules: ['v5'] },
    { expression: '高い', reading: 'たかい', definitions: ['tinggi'], partOfSpeech: ['adj-i'], rules: ['adj-i'] },
    { expression: '行く', reading: 'いく', definitions: ['pergi'], partOfSpeech: ['v5k-s'], rules: ['v5'] },
    { expression: 'する', reading: 'する', definitions: ['melakukan'], partOfSpeech: ['vs-i'], rules: ['vs'] },
    { expression: '見る', reading: 'みる', definitions: ['melihat'], partOfSpeech: ['v1'], rules: ['v1'] },
    { expression: '橋', reading: 'はし', definitions: ['jembatan'], partOfSpeech: ['n'] },
  ]);

  it.each([
    ['食べました', '食べる'],
    ['書いて', '書く'],
    ['高くない', '高い'],
    ['行った', '行く'],
    ['します', 'する'],
    ['みて', '見る'],
  ])('%s → %s meski ada entry satu karakter', async (query, expected) => {
    const result = await lookup(query, large);
    expect(result.matches[0]?.entry.expression).toBe(expected);
  });

  it('kueri kana memakai reading kandidat terpanjang sebelum kandidat pendek', async () => {
    const result = await lookup('はし', large);
    expect(result.matches[0]?.entry.expression).toBe('橋');
    expect(result.matches[0]?.matchType).toBe('reading');
  });

  it('hasil deinflection ikut disertakan bila bentuk permukaan juga terdaftar', async () => {
    const withInterjection = createMemorySource([
      { expression: '来た', reading: 'きた', definitions: [' berhasil'], partOfSpeech: ['int'] },
      { expression: '来る', reading: 'くる', definitions: ['datang'], partOfSpeech: ['vk'], rules: ['vk'] },
    ]);
    const result = await lookup('来た', withInterjection);
    expect(result.matches.map((match) => match.entry.expression)).toEqual(['来た', '来る']);
    expect(result.matches[0]?.matchType).toBe('exact');
    expect(result.matches[1]?.matchType).toBe('deinflected');
  });
});

describe('lookup: kompatibilitas tag kelas kata bergaya JMdict', () => {
  // Dataset seperti JMdict menandai aturan godan sebagai grup `v5`, sementara rule
  // Shirabe bekerja per baris (`v5k`, `v5u`, …).
  const jmdictStyle = createMemorySource([
    { expression: '書く', reading: 'かく', definitions: ['menulis'], partOfSpeech: ['v5k', 'vt'], rules: ['v5'] },
    { expression: '行く', reading: 'いく', definitions: ['pergi'], partOfSpeech: ['v5k-s', 'vi'], rules: ['v5'] },
    { expression: '食べる', reading: 'たべる', definitions: ['makan'], partOfSpeech: ['v1', 'vt'], rules: ['v1'] },
    { expression: '来る', reading: 'くる', definitions: ['datang'], partOfSpeech: ['vk', 'vi'], rules: ['vk'] },
    { expression: 'する', reading: 'する', definitions: ['melakukan'], partOfSpeech: ['vs-i'], rules: ['vs'] },
    { expression: '高い', reading: 'たかい', definitions: ['tinggi'], partOfSpeech: ['adj-i'], rules: ['adj-i'] },
    { expression: '野生', reading: 'やせい', definitions: ['liar'], partOfSpeech: ['adj-na'], rules: ['adj-na'] },
  ]);

  it.each([
    ['食べました', '食べる'],
    ['書いて', '書く'],
    ['書きました', '書く'],
    ['来た', '来る'],
    ['します', 'する'],
    ['高くない', '高い'],
  ])('deinflection %s → %s dengan tag grup dari dataset', async (query, expected) => {
    const result = await lookup(query, jmdictStyle);
    expect(result.status).toBe('ok');
    expect(result.matches[0]?.entry.expression).toBe(expected);
    expect(result.matches[0]?.partOfSpeechVerified).toBe(true);
  });

  it('menerima subtipe tag (v5k-s untuk rule v5k)', async () => {
    const result = await lookup('行った', jmdictStyle);
    expect(result.matches[0]?.entry.expression).toBe('行く');
  });

  it('tetap menolak kelas kata yang berbeda (adj-i vs adj-na)', async () => {
    const result = await lookup('野かった', jmdictStyle);
    expect(result.status).toBe('empty');
  });

  it('menolak tag yang bukan prefix maupun sama', async () => {
    const wrongPos = createMemorySource([
      { expression: '書く', reading: 'かく', definitions: ['menulis'], partOfSpeech: ['v1'], rules: ['v1'] },
    ]);
    const result = await lookup('書いて', wrongPos);
    expect(result.status).toBe('empty');
  });
});

describe('lookup: kandidat dari posisi kursor (hover)', () => {
  const sentence = createMemorySource([
    { expression: '毎日', reading: 'まいにち', definitions: ['setiap hari'], partOfSpeech: ['n'] },
    { expression: '日本語', reading: 'にほんご', definitions: ['bahasa Jepang'], partOfSpeech: ['n'] },
    { expression: '学生', reading: 'がくせい', definitions: ['pelajar'], partOfSpeech: ['n'] },
    { expression: '私立', reading: 'しりつ', definitions: ['swasta'], partOfSpeech: ['n'] },
  ]);

  it('memilih kata yang mencakup posisi kursor, bukan kata sebelumnya', async () => {
    // Kursor berada pada 語 (indeks 4) di dalam "毎日日本語を勉強します".
    const result = await lookup('毎日日本語を勉強します', sentence, { caretOffset: 4 });
    expect(expressions(result.matches)).toEqual(['日本語']);
    expect(result.span).toEqual({ start: 2, end: 5 });
  });

  it('tetap memakai kata terpanjang yang mencakup kursor', async () => {
    const result = await lookup('私立大学に通う', sentence, { caretOffset: 1 });
    expect(expressions(result.matches)).toEqual(['私立']);
  });

  it('memakai prefix dari awal kueri bila posisi kursor tidak diketahui', async () => {
    const result = await lookup('毎日日本語', sentence);
    expect(expressions(result.matches)).toEqual(['毎日']);
    expect(result.span).toEqual({ start: 0, end: 2 });
  });

  it('menemukan kata kanji di tengah kalimat tanpa partikel pemisah', async () => {
    const result = await lookup('私は学生です', sentence, { caretOffset: 3 });
    expect(expressions(result.matches)).toEqual(['学生']);
    expect(result.span).toEqual({ start: 2, end: 4 });
  });
});

describe('lookup: kandidat pada kalimat tanpa spasi', () => {
  // Kasus nyata: `陸上部だったので髪型はベリィショート` — sebelumnya kandidat membentang
  // satu kalimat sehingga kata di tengah (だった) tidak pernah ditemukan.
  const sentence = '陸上部だったので髪型はベリィショート';
  const indeks = {
    陸上部: sentence.indexOf('陸上部'),
    だった: sentence.indexOf('だった'),
    ので: sentence.indexOf('ので'),
    髪型: sentence.indexOf('髪型'),
    ベリィショート: sentence.indexOf('ベリィショート'),
  };
  const noSpaceSource = createMemorySource([
    { expression: '陸上部', reading: 'りくじょうぶ', definitions: ['klub atletik'], partOfSpeech: ['n'] },
    { expression: 'だった', reading: 'だった', definitions: ['adalah (lampau)'], partOfSpeech: ['exp'] },
    { expression: 'ので', reading: 'ので', definitions: ['karena'], partOfSpeech: ['prt'] },
    { expression: '髪型', reading: 'かみがた', definitions: ['gaya rambut'], partOfSpeech: ['n'] },
    { expression: 'ベリィショート', reading: 'ベリィショート', definitions: ['very short'], partOfSpeech: ['n'] },
  ]);

  it('menghasilkan kandidat pendek dan panjang di sekitar kursor', () => {
    const windows = candidateWindows(sentence, 32, indeks.だった).map((window) => window.text);
    expect(windows).toContain('だった');
    expect(windows).toContain('だったの');
    // Setiap jendela memuat posisi kursor.
    for (const window of candidateWindows(sentence, 32, indeks.だった)) {
      expect(window.start).toBeLessThanOrEqual(indeks.だった);
      expect(window.end).toBeGreaterThan(indeks.だった);
    }
  });

  it('menemukan kata kana di tengah kalimat tanpa spasi', async () => {
    const result = await lookup(sentence, noSpaceSource, { caretOffset: indeks.だった });
    expect(expressions(result.matches)).toContain('だった');
    expect(result.span).toEqual({ start: indeks.だった, end: indeks.だった + 3 });
  });

  it('menemukan partikel kana yang tidak berada di awal kalimat', async () => {
    const result = await lookup(sentence, noSpaceSource, { caretOffset: indeks.ので });
    expect(expressions(result.matches)).toContain('ので');
  });

  it('menemukan kata kanji yang berdiri sendiri di tengah kalimat', async () => {
    const result = await lookup(sentence, noSpaceSource, { caretOffset: indeks.髪型 + 1 });
    expect(expressions(result.matches)).toContain('髪型');
  });

  it('menemukan kata katakana setelah partikel', async () => {
    const result = await lookup(sentence, noSpaceSource, { caretOffset: indeks.ベリィショート + 2 });
    expect(expressions(result.matches)).toContain('ベリィショート');
  });

  it('menemukan kata pendek di dalam rentetan kana panjang (がな)', async () => {
    const kalimat = '俺がなんでそんなことを、とも思った。';
    const source = createMemorySource([
      { expression: 'がな', reading: 'がな', definitions: ['akhiran partikel'], partOfSpeech: ['prt'] },
      { expression: 'なんで', reading: 'なんで', definitions: ['kenapa'], partOfSpeech: ['adv'] },
    ]);
    for (const [kata, contoh] of [['がな', 'が'], ['なんで', 'なん']] as const) {
      const kursor = kalimat.indexOf(contoh) + 1;
      const windows = candidateWindows(kalimat, 32, kursor).map((window) => window.text);
      expect(windows, `jendela untuk ${kata}`).toContain(kata);
      const result = await lookup(kalimat, source, { caretOffset: kursor });
      expect(expressions(result.matches), `hasil untuk ${kata}`).toContain(kata);
    }
  });

  it('tidak memilih kata yang tidak memuat posisi kursor', async () => {
    const result = await lookup(sentence, noSpaceSource, { caretOffset: indeks.だった + 1 });
    // Kursor di dalam `だった`: `陸上部` (di sebelah kiri) bukan kandidat.
    expect(expressions(result.matches)).not.toContain('陸上部');
  });
});

describe('lookup: reading dan normalisasi', () => {
  it('mencocokkan kueri kana ke reading (NFC)', async () => {
    const composed = 'がくせい';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    const result = await lookup(decomposed, corpus);
    expect(expressions(result.matches)).toContain('学生');
    expect(result.matches[0]?.matchType).toBe('reading');
  });

  it('dapat mematikan pencarian reading', async () => {
    const result = await lookup('がくせい', corpus, { readingSearch: false });
    expect(result.status).toBe('empty');
  });

  it('menampilkan homonim sebagai alternatif', async () => {
    const result = await lookup('はし', corpus);
    expect(expressions(result.matches)).toEqual(expect.arrayContaining(['橋', '箸']));
  });

  it('entri tanpa reading tetap dapat ditemukan lewat expression', async () => {
    const result = await lookup('猫', corpus);
    expect(expressions(result.matches)).toEqual(['猫']);
    expect(result.matches[0]?.entry.reading).toBe('');
  });
});

describe('lookup: kelas kata dan batas hasil', () => {
  it('menolak lemma yang kelas katanya tidak diizinkan rule', async () => {
    // 野生 adalah adj-na; rule かった→い (adj-i) tidak boleh menerimanya.
    const result = await lookup('野かった', corpus);
    expect(result.status).toBe('empty');
  });

  it('menerima deinflection adj-na untuk kata yang tepat', async () => {
    const result = await lookup('静かでした', corpus);
    expect(expressions(result.matches)).toEqual(['静か']);
  });

  it('membatasi jumlah hasil dan menandai pemotongan', async () => {
    const many = createMemorySource(
      Array.from({ length: 40 }, (_, index) => ({
        expression: '学生',
        reading: `がくせい${index}`,
        definitions: [`pelajar ${index}`],
        partOfSpeech: ['n'],
      })),
    );
    const result = await lookup('学生', many, { maxResults: 30 });
    expect(result.matches).toHaveLength(30);
    expect(result.truncated).toBe(true);
  });

  it('kueri kosong tidak diproses', async () => {
    const result = await lookup('   ', corpus);
    expect(result.status).toBe('empty-query');
    expect(result.matches).toEqual([]);
  });

  it('kueri tanpa hasil mengembalikan status empty', async () => {
    const result = await lookup('ゾゾゾ', corpus);
    expect(result.status).toBe('empty');
    expect(result.matches).toEqual([]);
  });

  it('teks non-Jepang tetap dapat dicari', async () => {
    const source = createMemorySource([
      { expression: 'Tokyo', reading: 'とうきょう', definitions: ['Tokyo'], partOfSpeech: ['n'] },
    ]);
    const result = await lookup('Tokyo', source);
    expect(expressions(result.matches)).toEqual(['Tokyo']);
  });
});

describe('lookup: prioritas dataset (score Yomitan)', () => {
  it('mengurutkan hasil dengan prioritas lebih tinggi lebih dahulu', async () => {
    const source = createMemorySource([
      { expression: '同形', reading: 'どうけい', definitions: ['jarang'], partOfSpeech: ['n'] },
      { expression: '同形', reading: 'どうけい', definitions: ['umum'], partOfSpeech: ['n'] },
    ]);
    source.entries[0]!.priority = -200;
    source.entries[1]!.priority = 1999800;
    const result = await lookup('同形', source);
    expect(result.matches.map((match) => match.entry.definitions[0])).toEqual(['umum', 'jarang']);
  });

  it('tanpa prioritas, urutan dataset tetap dipertahankan', async () => {
    const source = createMemorySource([
      { expression: '同形', reading: 'どうけい', definitions: ['pertama'], partOfSpeech: ['n'] },
      { expression: '同形', reading: 'どうけい', definitions: ['kedua'], partOfSpeech: ['n'] },
    ]);
    const result = await lookup('同形', source);
    expect(result.matches.map((match) => match.entry.definitions[0])).toEqual(['pertama', 'kedua']);
  });
});

describe('rankMatches', () => {
  const entry = (id: string, order: number): DictionaryEntry => ({
    entryId: id,
    dictionaryId: `d${order}`,
    dictionaryName: `Kamus ${order}`,
    dictionaryOrder: order,
    expression: '学生',
    reading: '',
    definitions: [],
    partOfSpeech: [],
    tags: [],
    rules: [],
  });

  const match = (override: Partial<LookupMatch> & { entry: DictionaryEntry }): LookupMatch => ({
    matchType: 'exact',
    matchedText: '学生',
    matchLength: 2,
    steps: [],
    partOfSpeechVerified: true,
    ...override,
  });

  it('mengurutkan berdasarkan urutan kamus lalu jenis kecocokan', () => {
    const ranked = rankMatches(
      [
        match({ entry: entry('b', 1), matchType: 'deinflected' }),
        match({ entry: entry('a', 0), matchType: 'exact' }),
        match({ entry: entry('c', 1), matchType: 'exact' }),
      ],
      10,
    );
    expect(ranked.matches.map((item) => item.entry.entryId)).toEqual(['a', 'c', 'b']);
  });

  it('mendeduplikasi berdasarkan pasangan dictionary ID + entry ID', () => {
    const ranked = rankMatches(
      [match({ entry: entry('a', 0) }), match({ entry: entry('a', 0), matchLength: 1 })],
      10,
    );
    expect(ranked.matches).toHaveLength(1);
  });
});
