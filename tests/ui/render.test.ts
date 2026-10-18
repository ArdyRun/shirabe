// @vitest-environment happy-dom
/**
 * Pengujian renderer kartu entri (PRD 4.3, 10 Keamanan).
 *
 * Dua hal yang dijaga di sini: seluruh definisi tampil tanpa aksi pengguna (tidak ada
 * langkah "klik untuk detail"), dan setiap nilai dari dataset ditampilkan sebagai teks
 * sehingga tidak pernah diinterpretasikan sebagai HTML.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { KanjiMatch, LookupMatch, MetaMatch } from '../../src/core/types.js';
import {
  dictionaryTabs,
  filterByDictionary,
  isPriorityTag,
  mergeEntries,
  renderEntries,
  renderEntry,
} from '../../src/ui/results.js';
import { ResultsPanel } from '../../src/ui/results-panel.js';
import { setLanguage } from '../../src/ui/strings.js';

function match(overrides: Partial<LookupMatch> = {}): LookupMatch {
  return {
    entry: {
      entryId: 'demo:1',
      dictionaryId: 'demo',
      dictionaryName: 'Kamus Uji',
      dictionaryOrder: 0,
      expression: '学生',
      reading: 'がくせい',
      definitions: ['pelajar', 'mahasiswa'],
      partOfSpeech: ['n'],
      tags: ['umum'],
      rules: [],
    },
    matchType: 'exact',
    matchedText: '学生',
    matchLength: 2,
    steps: [],
    partOfSpeechVerified: true,
    ...overrides,
  };
}

beforeEach(() => {
  setLanguage('id');
  document.body.innerHTML = '<div id="target"></div>';
});

/** Satu nilai meta istilah (pitch/frekuensi) untuk ekspresi `学生`. */
function meta(overrides: Partial<MetaMatch> = {}): MetaMatch {
  return {
    dictionaryId: 'demo',
    dictionaryName: 'Kamus Uji',
    dictionaryOrder: 0,
    expression: '学生',
    reading: 'がくせい',
    values: [],
    ...overrides,
  };
}

/** Satu kanji dari bank kanji. */
function kanji(overrides: Partial<KanjiMatch> = {}): KanjiMatch {
  return {
    dictionaryId: 'kanji-demo',
    dictionaryName: 'Kamus Kanji',
    dictionaryOrder: 1,
    character: '学',
    onyomi: ['ガク', 'ガッ'],
    kunyomi: ['まな.ぶ'],
    tags: ['常用'],
    meanings: ['belajar', 'ilmu'],
    stats: { strokes: '8', grade: '1' },
    ...overrides,
  };
}

function target(): HTMLElement {
  const element = document.getElementById('target');
  if (element === null) {
    throw new Error('Target tidak ada.');
  }
  return element;
}

/** Seluruh glosarium yang tampil (satu baris per definisi). */
function glosses(): (string | null)[] {
  return [...target().querySelectorAll('.glosses__item')].map((item) => item.textContent);
}

describe('renderEntries dengan definisi berstruktur (schema v2)', () => {
  it('merender tabel bentuk kata sebagai tabel asli, bukan sederet teks', () => {
    const entry = match();
    entry.entry.expression = '俺';
    entry.entry.reading = 'おれ';
    entry.entry.definitions = [
      'I',
      'me',
      {
        tag: 'table',
        content: [
          {
            tag: 'tr',
            content: [
              { tag: 'th', content: '俺', style: { textAlign: 'center' } },
              { tag: 'th', content: '己', style: { textAlign: 'center' } },
            ],
          },
          {
            tag: 'tr',
            content: [
              { tag: 'td', content: '★' },
              { tag: 'td', content: '🅁' },
            ],
          },
        ],
      },
    ];
    renderEntries(target(), [entry]);

    const wrap = target().querySelector('.sc-table-wrap');
    expect(wrap).not.toBeNull();
    const table = wrap?.querySelector('table.sc-table');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('tr')).toHaveLength(2);
    expect([...(table?.querySelectorAll('th.sc-th') ?? [])].map((cell) => cell.textContent)).toEqual([
      '俺',
      '己',
    ]);
    expect([...(table?.querySelectorAll('td.sc-td') ?? [])].map((cell) => cell.textContent)).toEqual([
      '★',
      '🅁',
    ]);
    // Gaya dari dataset diterapkan sebagai properti CSS, bukan atribut lain.
    expect(
      (table?.querySelector('th.sc-th') as HTMLElement | null)?.style.textAlign,
    ).toBe('center');
    // Tabel tetap berada di dalam satu sense (item definisi), seperti Hachidori.
    expect(target().querySelector('.glosses__item .sc-table')).not.toBeNull();
  });

  it('mempertahankan penanda daftar catatan dan tidak merendernya sebagai teks', () => {
    const entry = match();
    entry.entry.definitions = [
      'helper',
      {
        tag: 'ul',
        data: { content: 'notes' },
        style: { listStyleType: "'📝 '" },
        content: [{ tag: 'li', content: 'biasanya ditulis kana' }],
      },
    ];
    renderEntries(target(), [entry]);
    const list = target().querySelector('ul.sc-ul[data-content="notes"]');
    expect(list).not.toBeNull();
    expect((list as HTMLElement | null)?.style.getPropertyValue('list-style-type')).toBe("'📝 '");
    expect(list?.querySelector('.sc-li')?.textContent).toBe('biasanya ditulis kana');
  });

  it('tidak pernah membuat elemen untuk tag di luar daftar putih', () => {
    // Simulasi data storage yang dimodifikasi: nilai ini tidak mungkin lolos validasi
    // impor, tetapi renderer tetap harus aman (defense in depth).
    const entry = match();
    entry.entry.definitions = [
      { tag: 'script', content: 'window.__xss = 1' } as unknown as string,
      { tag: 'div', content: [{ tag: 'img', content: 'gambar' }] } as unknown as string,
      { tag: 'blink', content: 'teks tak dikenal' } as unknown as string,
    ];
    renderEntries(target(), [entry]);
    // Media/script dibuang bersama isinya; tag tak dikenal lain tampil sebagai teks.
    expect(target().querySelector('script')).toBeNull();
    expect(target().querySelector('img')).toBeNull();
    expect(target().querySelector('blink')).toBeNull();
    const text = target().textContent ?? '';
    expect(text).not.toContain('window.__xss');
    expect(text).toContain('teks tak dikenal');
  });

  it('menampilkan furigana node ruby tanpa menuliskan bacaan sebagai teks definisi', () => {
    const entry = match();
    entry.entry.definitions = [
      { tag: 'ruby', content: ['学生', { tag: 'rt', content: 'がくせい' }] },
    ];
    renderEntries(target(), [entry]);
    const ruby = target().querySelector('ruby.sc-ruby');
    expect(ruby).not.toBeNull();
    expect(ruby?.querySelector('rt.sc-rt')?.textContent).toBe('がくせい');
  });
});

describe('renderEntries', () => {
  it('menampilkan headword, bacaan, dan kamus asal pada kartu', () => {
    renderEntries(target(), [match()]);
    const text = target().textContent ?? '';
    expect(text).toContain('学生');
    expect(text).toContain('がくせい');
    expect(text).toContain('Kamus Uji');
  });

  it('menampilkan seluruh definisi tanpa aksi pengguna', () => {
    renderEntries(target(), [match()]);
    expect(glosses()).toEqual(['pelajar', 'mahasiswa']);
    // Tidak ada tombol/tautan yang perlu diklik untuk melihat definisi.
    expect(target().querySelectorAll('button')).toHaveLength(0);
  });

  it('tidak menomori sense bila entri hanya punya satu sense', () => {
    const single = match();
    single.entry.definitions = ['pelajar', 'mahasiswa'];
    renderEntries(target(), [single]);
    expect(target().querySelector('.definitions--single')).not.toBeNull();
    const list = target().querySelector('[data-role="definitions"]');
    expect(list?.getAttribute('data-count')).toBe('1');
    expect(list?.getAttribute('data-glosses')).toBe('2');
    expect(glosses()).toEqual(['pelajar', 'mahasiswa']);
  });

  it('mencatat jumlah sense dan glosarium pada atribut data', () => {
    renderEntries(target(), [match()]);
    const list = target().querySelector('[data-role="definitions"]');
    expect(list?.getAttribute('data-count')).toBe('1');
    expect(list?.getAttribute('data-glosses')).toBe('2');
  });

  it('menampilkan kelas kata dan tag inline di depan sense (pola Hachidori)', () => {
    renderEntries(target(), [match()]);
    const meta = target().querySelector('.definitions__meta');
    expect(meta?.textContent).toBe('[n, umum]');
    // Metadata berada di dalam baris sense, bukan sebagai baris chip terpisah.
    expect(target().querySelector('.badge')).toBeNull();
  });

  it('tidak menggandakan bacaan yang sama dengan headword', () => {
    const same = match();
    same.entry.reading = '学生';
    renderEntries(target(), [same]);
    expect(target().querySelectorAll('.entry__reading')).toHaveLength(0);
  });

  it('memberi label bacaan tidak tersedia bila entri tanpa bacaan', () => {
    const withoutReading = match();
    withoutReading.entry.reading = '';
    renderEntries(target(), [withoutReading]);
    expect(target().querySelector('.entry__reading--missing')?.textContent).toBe(
      'bacaan tidak tersedia',
    );
  });

  it('menampilkan tag yang tidak dikenal sebagai teks biasa', () => {
    const unknown = match();
    unknown.entry.tags = ['tag-asing-luar-biasa'];
    renderEntries(target(), [unknown]);
    expect(target().textContent).toContain('tag-asing-luar-biasa');
  });

  it('menampilkan rantai deinfleksi dari tabel rule, bukan label tebakan UI', () => {
    // Kartu menampilkan entri kamusnya; keterangan bentuk infleksi berasal dari tabel
    // rule Shirabe (bukan tebakan UI) dan hanya muncul untuk langkah yang benar-benar
    // diterapkan (PRD 4.4).
    renderEntries(target(), [
      match({
        matchType: 'deinflected',
        matchedText: '食べました',
        partOfSpeechVerified: false,
        steps: [{ transformId: '-ました', from: 'ました', to: 'る' }],
      }),
    ]);
    const card = target().querySelector('[data-role="entry"]');
    const text = card?.textContent ?? '';
    expect(text).toContain('学生');
    expect(text).toContain('pelajar');
    expect(text).toContain('n');
    // Keterangan berasal dari rule: jalur bentuk permukaan → bentuk kamus + langkahnya.
    expect(text).toContain('食べました');
    expect(text).toContain('-ました');
    expect(text).toContain('Bentuk sopan');
    expect(text).not.toContain('terverifikasi');
    expect(target().querySelector('.badge--form, .entry__match')).toBeNull();
  });

  it('menampilkan rantai 聞こえてきた → 聞こえる dengan langkah berurutan', () => {
    renderEntries(target(), [
      match({
        entry: {
          entryId: 'demo:1',
          dictionaryId: 'demo',
          dictionaryName: 'Kamus Uji',
          dictionaryOrder: 0,
          expression: '聞こえる',
          reading: 'きこえる',
          definitions: ['to be heard', 'to be audible'],
          partOfSpeech: ['v1'],
          tags: [],
          rules: [],
        },
        matchType: 'deinflected',
        matchedText: '聞こえてきた',
        matchLength: 6,
        steps: [
          { transformId: '-た', from: 'きた', to: 'くる' },
          { transformId: '-くる', from: 'てくる', to: 'て' },
          { transformId: '-て', from: 'て', to: 'る' },
        ],
      }),
    ]);

    const disclosure = target().querySelector<HTMLDetailsElement>('[data-role="inflection"]');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.open).toBe(false);
    expect(disclosure?.dataset['steps']).toBe('3');
    expect(disclosure?.querySelector('summary')?.textContent).toContain('聞こえてきた');
    expect(disclosure?.querySelector('summary')?.textContent).toContain('聞こえる');
    expect(disclosure?.querySelector('summary')?.getAttribute('title')).toContain(
      'Kenapa cocok: 聞こえてきた menjadi 聞こえる',
    );
    const steps = [...(disclosure?.querySelectorAll('.inflection__step') ?? [])];
    expect(steps.map((step) => step.getAttribute('data-transform'))).toEqual([
      '-た',
      '-くる',
      '-て',
    ]);
    expect(steps.map((step) => step.querySelector('.inflection__transform')?.textContent)).toEqual([
      '-た',
      '-くる',
      '-て',
    ]);
    // Keterangan tiap langkah berasal dari kunci deskripsi tabel transformasi.
    expect(steps[0]?.querySelector('.inflection__description')?.textContent).toContain(
      'Bentuk lampau',
    );
    expect(steps[1]?.querySelector('.inflection__description')?.textContent).toContain('-くる');
    expect(steps[2]?.querySelector('.inflection__description')?.textContent).toContain('Bentuk -て');
    expect(disclosure?.querySelector('ol')?.getAttribute('aria-label')).toBe(
      'Langkah pembentukan bentuk kamus',
    );
  });

  it('tidak menampilkan disclosure tanpa langkah atau saat bentuk sudah sama', () => {
    renderEntries(target(), [match()]);
    expect(target().querySelector('[data-role="inflection"]')).toBeNull();

    renderEntries(target(), [
      match({ matchType: 'deinflected', matchedText: '学生', steps: [] }),
    ]);
    expect(target().querySelector('[data-role="inflection"]')).toBeNull();
  });

  it('membatasi jumlah langkah yang tampil dan menandai sisanya', () => {
    const steps = Array.from({ length: 33 }, (_value, index) => ({
      transformId: '-た',
      from: `f${index}`,
      to: 'る',
    }));
    mergeEntries([]);
    renderEntries(target(), [
      match({ matchType: 'deinflected', matchedText: '食べた', steps }),
    ]);
    const items = target().querySelectorAll('.inflection__step');
    expect(items).toHaveLength(32);
    expect(items[31]?.textContent).toBe('…');
    expect(
      target().querySelector('[data-role="inflection"]')?.getAttribute('data-steps'),
    ).toBe('33');
  });

  it('menulis keterangan langkah sebagai teks, bukan markup', () => {
    renderEntries(target(), [
      match({
        matchType: 'deinflected',
        matchedText: '食べた',
        steps: [{ transformId: '<img src=x onerror=alert(1)>', from: 'た', to: 'る' }],
      }),
    ]);
    const step = target().querySelector('.inflection__step');
    expect(step?.querySelector('img')).toBeNull();
    expect(step?.querySelector('.inflection__transform')?.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
    // Transformasi tak dikenal tetap ditampilkan namanya, tanpa deskripsi.
    expect(step?.querySelector('.inflection__description')).toBeNull();
  });

  it('tidak menambahkan label apa pun pada kecocokan bacaan', () => {
    renderEntries(target(), [match({ matchType: 'reading', matchedText: 'がくせい' })]);
    expect(target().textContent).not.toContain('cocok');
    expect(target().querySelector('.entry__match')).toBeNull();
  });

  it('menavigasi kartu dengan tombol panah', () => {
    renderEntries(target(), [
      match(),
      match({ entry: { ...match().entry, entryId: 'demo:2', expression: '学問', reading: 'がくもん' } }),
    ]);
    const cards = [...target().querySelectorAll<HTMLElement>('[data-role="entry"]')];
    cards[0]?.focus();
    const list = target().querySelector('.results');
    list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(cards[1]);
  });

  it('menandai kartu pertama sebagai terpilih', () => {
    renderEntries(target(), [
      match(),
      match({ entry: { ...match().entry, entryId: 'demo:2', expression: '学問', reading: 'がくもん' } }),
    ]);
    const cards = [...target().querySelectorAll<HTMLElement>('[data-role="entry"]')];
    expect(cards[0]?.dataset['selected']).toBe('true');
    expect(cards[1]?.dataset['selected']).toBe('false');
  });

  it('tidak mengeksekusi markup atau script pada data kamus', () => {
    const unsafe = match();
    unsafe.entry.definitions = ['<img src=x onerror="window.__xss = 1">', '<script>window.__xss=2</script>'];
    unsafe.entry.tags = ['<b>tag</b>'];
    renderEntries(target(), [unsafe]);

    expect(target().querySelectorAll('img, script, b')).toHaveLength(0);
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
    // Teks tetap terbaca apa adanya.
    expect(target().textContent).toContain('<img src=x onerror=');
    expect(glosses()).toContain('<script>window.__xss=2</script>');
  });
});

describe('badge meta istilah (bank meta)', () => {
  it('mengganti bacaan dengan kontur pitch dan menaruh frekuensi di baris bawah', () => {
    renderEntries(target(), [match()], {
      meta: [
        meta({
          values: [
            {
              type: 'pitch',
              reading: 'がくせい',
              // Atamadaka: hanya mora pertama tinggi, lalu turun di mora kedua.
              pitches: [{ position: 1, devoice: [], nasal: [] }],
            },
            { type: 'freq', reading: 'がくせい', frequency: { value: 1234, displayValue: '1234 (umum)' } },
          ],
        }),
      ],
    });

    const top = target().querySelector('.entry__top');
    const reading = target().querySelector<HTMLElement>('.entry__reading--pitch');
    expect(reading?.querySelectorAll('.pitch-reading__mora')).toHaveLength(4);
    expect(reading?.querySelectorAll('.pitch-reading__mora[data-pitch-transition="down"]')).toHaveLength(1);
    const contour = reading?.querySelector<HTMLElement>('.pitch-reading');
    expect(contour?.getAttribute('data-pitch-position')).toBe('1');
    expect(contour?.getAttribute('data-pitch-category')).toBe('atamadaka');
    expect(contour?.getAttribute('title')).toBe('Kamus Uji: aksen kepala (atamadaka) [1]');
    expect(contour?.getAttribute('aria-label')).toBe('Kamus Uji: aksen kepala (atamadaka) [1]');

    // Frekuensi tidak sejajar dengan bacaan: barisnya sendiri di bawah headword.
    const frequencies = target().querySelector<HTMLElement>('.entry__frequencies');
    expect(frequencies?.querySelector('.meta-badge__source')?.textContent).toBe('Kamus Uji');
    expect(frequencies?.querySelector('.meta-badge__value')?.textContent).toBe('1234 (umum)');
    expect(frequencies?.getAttribute('title')).toBeNull();

    const children = [...(top?.children ?? [])].map((child) => child.className);
    expect(children).toEqual([
      'entry__spelling',
      'entry__reading entry__reading--pitch',
      'entry__dictionary',
    ]);
    const card = target().querySelector('.entry');
    expect([...(card?.children ?? [])].map((child) => child.className)).toEqual([
      'entry__top',
      'entry__frequencies',
      'entry__definitions',
    ]);
  });

  it('menampilkan satu kontur per pola dan membatasi jumlahnya per entri', () => {
    renderEntries(target(), [match()], {
      meta: [
        meta({
          values: [
            {
              type: 'pitch',
              reading: 'がくせい',
              // Enam pola berbeda, satu di antaranya kembar dengan kamus lain.
              pitches: [0, 1, 2, 3, 4, 5].map((position) => ({ position, devoice: [], nasal: [] })),
            },
            { type: 'freq', reading: 'がくせい', frequency: { value: 42 } },
          ],
        }),
        meta({
          dictionaryId: 'pitch-lain',
          dictionaryName: 'Kamus Pitch Lain',
          values: [
            {
              type: 'pitch',
              reading: 'がくせい',
              pitches: [{ position: 1, devoice: [], nasal: [] }],
            },
          ],
        }),
      ],
    });
    // Pola yang sama dari kamus berbeda tidak digambar dua kali, dan deretan kontur
    // dipotong pada 4 pola supaya baris bacaan tidak memanjang tanpa batas.
    const contours = [...target().querySelectorAll('.pitch-reading')];
    expect(contours.map((item) => item.getAttribute('data-pitch-position'))).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
    expect(target().querySelector('.meta-badge__value')?.textContent).toBe('42');
  });

  it('menandai mora tanpa suara dan nasal pada kontur bacaannya', () => {
    renderEntries(target(), [match()], {
      meta: [
        meta({
          values: [
            {
              type: 'pitch',
              reading: 'がくせい',
              pitches: [{ position: 0, devoice: [2], nasal: [3] }],
            },
          ],
        }),
      ],
    });
    const contour = target().querySelector<HTMLElement>('.pitch-reading');
    expect(contour?.getAttribute('data-pitch-category')).toBe('heiban');
    expect(contour?.getAttribute('title')).toBe(
      'Kamus Uji: aksen datar (heiban) [0] · mora 2 tanpa suara · mora 3 nasal',
    );
    const morae = [...(contour?.querySelectorAll('.pitch-reading__mora') ?? [])];
    expect(morae[1]?.querySelector('.pitch-reading__devoice')).not.toBeNull();
    expect(morae[2]?.querySelector('.pitch-reading__nasal')).not.toBeNull();
    expect(morae[0]?.querySelector('.pitch-reading__devoice')).toBeNull();
  });

  it('mencocokkan bacaan kecuali nilai tanpa bacaan, dan mengabaikan ekspresi lain', () => {
    renderEntries(target(), [match()], {
      meta: [
        meta({ reading: 'がくしょう' }),
        meta({ reading: '', values: [{ type: 'freq', reading: '', frequency: { value: 7 } }] }),
        meta({ expression: '学問', values: [{ type: 'pitch', reading: '', pitches: [] }] }),
      ],
    });
    // Nilai tanpa bacaan berlaku untuk bacaan apa pun; chip memuat nama kamus + nilainya.
    const frequencies = [...target().querySelectorAll('[data-role="frequency"]')];
    expect(frequencies.map((badge) => badge.querySelector('.meta-badge__value')?.textContent)).toEqual([
      '7',
    ]);
    expect(frequencies[0]?.querySelector('.meta-badge__source')?.textContent).toBe('Kamus Uji');
    // Bacaan lain (がくしょう) dan ekspresi lain (学問) tidak cocok: tidak ada kontur pitch.
    expect(target().querySelector('.pitch-reading')).toBeNull();
  });
});

describe('blok kanji (bank kanji)', () => {
  it('merender karakter, bacaan, arti, chip, dan nama kamus di atas daftar entri', () => {
    renderEntries(target(), [match()], { kanji: [kanji()] });

    const block = target().querySelector<HTMLElement>('[data-role="kanji"]');
    expect(block?.classList.contains('kanji-block')).toBe(true);
    expect(block?.getAttribute('aria-label')).toBe('Kanji');
    // Blok berada sebelum kartu entri istilah.
    expect(target().querySelector('.results')?.firstElementChild).toBe(block);

    const item = block?.querySelector('.kanji-block__item');
    expect(item?.querySelector('.kanji-block__character')?.textContent).toBe('学');
    expect(item?.querySelector('.kanji-block__onyomi')?.textContent).toBe('ガク、ガッ');
    expect(item?.querySelector('.kanji-block__kunyomi')?.textContent).toBe('まな.ぶ');
    expect(
      [...(item?.querySelectorAll('.kanji-block__meaning') ?? [])].map((entry) => entry.textContent),
    ).toEqual(['belajar', 'ilmu']);
    expect(
      [...(item?.querySelectorAll('.kanji-block__chip') ?? [])].map((chip) => chip.textContent),
    ).toEqual(['goresan: 8', 'kelas: 1', '常用']);
    expect(item?.querySelector('.entry__dictionary')?.textContent).toBe('Kamus Kanji');
    expect(target().querySelector('[data-role="entry"]')).not.toBeNull();
  });

  it('menampilkan kunci statistik yang tidak dikenal apa adanya', () => {
    renderEntries(target(), [match()], { kanji: [kanji({ stats: { unknownKey: 'x' } })] });
    const chips = [...target().querySelectorAll('.kanji-block__chip')].map((chip) => chip.textContent);
    expect(chips).toEqual(['unknownKey: x', '常用']);
  });
});

describe('gambar kamus (bank media)', () => {
  it('merender img dengan jalur media, tanpa src dan tanpa atribut di luar daftar', () => {
    const entry = match();
    entry.entry.definitions = [
      {
        tag: 'img',
        path: 'sankoku8/graphics/000irori.png',
        width: 1,
        height: 2,
        sizeUnits: 'em',
        appearance: 'monochrome',
        pixelated: true,
        verticalAlign: 'middle',
        alt: 'irori',
        // Nilai yang tidak mungkin lolos validasi impor: renderer tetap mengabaikannya.
        src: 'https://contoh.test/gambar.png',
        onerror: 'window.__xss = 1',
      } as unknown as string,
    ];
    renderEntries(target(), [entry]);

    const image = target().querySelector<HTMLImageElement>('img.sc-img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('data-media-path')).toBe('sankoku8/graphics/000irori.png');
    expect(image?.getAttribute('alt')).toBe('irori');
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('decoding')).toBe('async');
    expect(image?.getAttribute('src')).toBeNull();
    expect(image?.getAttribute('onerror')).toBeNull();
    expect(image?.classList.contains('sc-img--monochrome')).toBe(true);
    expect(image?.style.width).toBe('1em');
    expect(image?.style.height).toBe('2em');
    expect(image?.style.verticalAlign).toBe('middle');
    expect(image?.style.getPropertyValue('image-rendering')).toBe('pixelated');
  });

  it('tidak merender simpul img tanpa jalur media', () => {
    const entry = match();
    entry.entry.definitions = [{ tag: 'img', alt: 'tanpa jalur' } as unknown as string];
    renderEntries(target(), [entry]);
    expect(target().querySelector('img')).toBeNull();
  });
});

describe('renderEntry', () => {
  it('mengembalikan satu kartu entri tanpa panel pembungkus', () => {
    const card = renderEntry(match());
    expect(card.getAttribute('data-role')).toBe('entry');
    expect(card.querySelectorAll('.glosses__item')).toHaveLength(2);
    expect(card.querySelector('[data-role="dictionary-panel"]')).toBeNull();
  });

  it('menampilkan headword polos dan bacaan inline seperti popup referensi', () => {
    // Kartu memakai pola `jl-top`: headword (tanpa ruby) + bacaan di baris yang sama.
    const card = renderEntry(match());
    const spelling = card.querySelector('.entry__spelling');
    expect(spelling?.textContent).toBe('学生');
    expect(spelling?.querySelector('ruby')).toBeNull();
    expect(card.querySelector('.entry__reading')?.textContent).toBe('がくせい');
    expect(card.querySelector('.entry__dictionary')?.textContent).toBe('Kamus Uji');
  });

  it('membuat tombol per kanji hanya bila callback lookup kanji diberikan', () => {
    const clicked: string[] = [];
    renderEntries(target(), [match()], { onKanjiClick: (kanji) => clicked.push(kanji) });
    const buttons = [...target().querySelectorAll<HTMLButtonElement>('.entry__kanji')];
    expect(buttons.map((button) => button.textContent)).toEqual(['学', '生']);
    buttons[0]?.click();
    expect(clicked).toEqual(['学']);

    target().replaceChildren();
    renderEntries(target(), [match()]);
    expect(target().querySelectorAll('.entry__kanji')).toHaveLength(0);
    expect(target().querySelector('.entry__spelling')?.textContent).toBe('学生');
  });

});

describe('isPriorityTag', () => {
  it('menandai tag prioritas/frekuensi kamus gaya JMdict/Jitendex', () => {
    for (const tag of ['⭐', '⭐⭐', '★', 'ichi', 'ichi1', 'news1', 'news7k', 'nf24', 'spec1', 'gai2']) {
      expect(isPriorityTag(tag), tag).toBe(true);
    }
    for (const tag of ['n', 'vt', 'v5r', 'arch', 'uk', 'col', 'forms', 'adv-to', '感', '1']) {
      expect(isPriorityTag(tag), tag).toBe(false);
    }
  });

  it('menyembunyikan tag prioritas pada metadata sense tetapi menyisakan tag lain', () => {
    const entry = match();
    entry.entry.partOfSpeech = ['v5r', 'vt'];
    entry.entry.tags = ['⭐', 'ichi', 'news7k', 'arch'];
    renderEntries(target(), [entry]);
    const metas = [...target().querySelectorAll('.definitions__meta')].map((m) => m.textContent);
    expect(metas).toEqual(['[v5r, vt, arch]']);
    expect(target().textContent).not.toContain('⭐');
  });
});

describe('dictionaryTabs', () => {
  it('selalu memulai dengan tab Semua dan menghitung kartu per kamus', () => {
    const tabs = dictionaryTabs([
      match(),
      match({ entry: { ...match().entry, entryId: 'demo:2', expression: '学問', reading: 'がくもん' } }),
      match({
        entry: { ...match().entry, entryId: 'lain:1', dictionaryId: 'lain', dictionaryName: 'Kamus Kedua' },
      }),
    ]);
    expect(tabs).toEqual([
      { id: '*', name: 'Semua', count: 3 },
      { id: 'demo', name: 'Kamus Uji', count: 2 },
      { id: 'lain', name: 'Kamus Kedua', count: 1 },
    ]);
  });

  it('menghitung baris dengan kata yang sama sebagai satu kartu', () => {
    const tabs = dictionaryTabs([
      match(),
      match({ entry: { ...match().entry, entryId: 'demo:2' } }),
    ]);
    expect(tabs).toEqual([
      { id: '*', name: 'Semua', count: 1 },
      { id: 'demo', name: 'Kamus Uji', count: 1 },
    ]);
  });

  it('menyaring hasil per kamus', () => {
    const matches = [
      match(),
      match({ entry: { ...match().entry, entryId: 'lain:1', dictionaryId: 'lain', dictionaryName: 'Kamus Kedua' } }),
    ];
    expect(filterByDictionary(matches, null)).toHaveLength(2);
    expect(filterByDictionary(matches, 'lain').map((item) => item.entry.entryId)).toEqual(['lain:1']);
  });
});

describe('ResultsPanel', () => {
  function result(matches: LookupMatch[]) {
    return {
      query: '学生',
      status: 'ok' as const,
      truncated: false,
      inputTruncated: false,
      matches,
      meta: [] as MetaMatch[],
      kanji: [] as KanjiMatch[],
      span: null,
    };
  }

  it('menampilkan tab sumber kamus dan menyaring kartu saat tab dipilih', () => {
    const panel = new ResultsPanel(target());
    panel.showResult(
      result([
        match(),
        match({ entry: { ...match().entry, entryId: 'lain:1', dictionaryId: 'lain', dictionaryName: 'Kamus Kedua' } }),
      ]),
    );
    const tabs = [...target().querySelectorAll<HTMLButtonElement>('.dict-tab')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Semua2', 'Kamus Uji1', 'Kamus Kedua1']);
    expect(panel.visibleCount).toBe(2);

    tabs[2]?.click();
    expect(panel.activeDictionaryId).toBe('lain');
    expect(panel.visibleCount).toBe(1);
    // Daftar entri datar: tidak ada panel per kamus, label kamus ada di tiap kartu.
    expect(target().querySelectorAll('[data-role="dictionary-panel"]')).toHaveLength(0);
    expect(target().querySelectorAll('[data-role="entry"]')).toHaveLength(1);
    expect(target().querySelector('.entry__dictionary')?.textContent).toBe('Kamus Kedua');
    expect(target().querySelector('.dict-tab[aria-pressed="true"]')?.textContent).toBe(
      'Kamus Kedua1',
    );

    target().querySelector<HTMLButtonElement>('.dict-tab')?.click();
    expect(panel.activeDictionaryId).toBeNull();
    expect(panel.visibleCount).toBe(2);
  });

  it('tidak menampilkan tab bila hasil hanya dari satu kamus', () => {
    const panel = new ResultsPanel(target());
    panel.showResult(result([match()]));
    expect(target().querySelector('.dict-tabs')).toBeNull();
    expect(target().querySelectorAll('[data-role="entry"]')).toHaveLength(1);
  });

  it('tidak menampilkan blok kalimat sumber di panel hasil', () => {
    // Pemilik produk memilih popup tanpa kalimat sumber (lihat §4.14 audit); kartu
    // entri harus menjadi isi pertama panel.
    const panel = new ResultsPanel(target());
    panel.show(result([match()]));
    expect(target().querySelector('[data-role="context"]')).toBeNull();
    expect(target().querySelectorAll('mark')).toHaveLength(0);
    expect(target().querySelector('[data-role="entry"]')).not.toBeNull();
  });

  it('memilih kartu entri dan menggulirnya ke tampilan', () => {
    const panel = new ResultsPanel(target());
    panel.showResult(
      result([
        match(),
        match({ entry: { ...match().entry, entryId: 'demo:2', expression: '学問', reading: 'がくもん' } }),
      ]),
    );
    panel.selectEntry(1);
    const cards = [...target().querySelectorAll<HTMLElement>('[data-role="entry"]')];
    expect(cards[1]?.dataset['selected']).toBe('true');
    expect(cards[0]?.dataset['selected']).toBe('false');
  });

  it('menampilkan headword pada setiap kartu seperti popup referensi', () => {
    const panel = new ResultsPanel(target());
    panel.showResult(
      result([
        // Dua kamus berbeda dengan kata yang sama: keduanya menjadi satu kartu saja.
        match(),
        match({
          entry: { ...match().entry, entryId: 'lain:1', dictionaryId: 'lain', dictionaryName: 'Kamus Kedua' },
        }),
        // Kata lain dengan bacaan berbeda.
        match({ entry: { ...match().entry, entryId: 'demo:3', reading: 'がくしょう' } }),
      ]),
    );
    const cards = [...target().querySelectorAll<HTMLElement>('[data-role="entry"]')];
    // Satu kartu per kamus; kata lain (bacaan berbeda) menjadi kartu tersendiri.
    expect(cards).toHaveLength(3);
    // Setiap kartu menampilkan headword + bacaan + nama kamus (pola `jl-top`); header
    // popup memuat kata yang dipindai, bukan pengganti headword kartu.
    for (const card of cards) {
      expect(card.querySelector('.entry__spelling')).not.toBeNull();
      expect(card.querySelector('.entry__dictionary')).not.toBeNull();
    }
    expect(cards[0]?.querySelector('.entry__spelling')?.textContent).toBe('学生');
    expect(cards[0]?.querySelector('.entry__reading')?.textContent).toBe('がくせい');
    expect(cards[0]?.querySelector('.glosses__item')).not.toBeNull();
    expect(cards[1]?.querySelector('.entry__dictionary')?.textContent).toBe('Kamus Kedua');
    expect(cards[2]?.querySelector('.entry__reading')?.textContent).toBe('がくしょう');
  });

  it('menampilkan blok kanji walau tidak ada entri istilah', () => {
    // Klik kanji pada kamus bergaya KANJIDIC: `matches` kosong tetapi `kanji` terisi.
    const panel = new ResultsPanel(target());
    panel.show({ ...result([]), kanji: [kanji()] });
    expect(target().querySelector('[data-role="kanji"]')).not.toBeNull();
    expect(target().querySelector('.kanji-block__character')?.textContent).toBe('学');
    expect(target().textContent).not.toContain('Tidak ada hasil');
    expect(target().querySelector('[data-role="entry"]')).toBeNull();
  });

  it('menampilkan pesan status tanpa daftar hasil', () => {
    const panel = new ResultsPanel(target());
    panel.showMessage('Tidak dapat memuat');
    expect(target().textContent).toBe('Tidak dapat memuat');
  });
});

describe('mergeEntries', () => {
  /** Satu baris dataset (mis. satu sense pada kamus yang memecah sense per baris). */
  function row(entryId: string, definitions: string[], tags: string[], partOfSpeech: string[] = ['v1', 'vt'], reading = 'かたむける') {
    return {
      entry: {
        entryId,
        dictionaryId: 'jmdict',
        dictionaryName: 'JMdict',
        dictionaryOrder: 0,
        expression: '傾ける',
        reading,
        definitions,
        partOfSpeech,
        tags,
        rules: ['v1'],
      },
      matchType: 'exact' as const,
      matchedText: '傾ける',
      matchLength: 4,
      steps: [],
      partOfSpeechVerified: true,
    };
  }

  it('menggabungkan baris dengan kamus, kata, dan bacaan yang sama', () => {
    const merged = mergeEntries([
      row('jmdict:1', ['to incline', 'to lean'], ['1', 'ichi']),
      row('jmdict:2', ['to devote oneself to'], ['2', 'ichi']),
      row('jmdict:3', ['to ruin'], ['3']),
      row('jmdict:4', ['to drink (alcohol)'], ['4']),
    ]);
    expect(merged).toHaveLength(1);
    // Tiap baris dataset menjadi satu sense; definisinya tetap berkelompok.
    expect(merged[0]?.senses).toEqual([
      { definitions: ['to incline', 'to lean'], partOfSpeech: ['v1', 'vt'], tags: [] },
      { definitions: ['to devote oneself to'], partOfSpeech: ['v1', 'vt'], tags: [] },
      { definitions: ['to ruin'], partOfSpeech: ['v1', 'vt'], tags: [] },
      { definitions: ['to drink (alcohol)'], partOfSpeech: ['v1', 'vt'], tags: [] },
    ]);
    // Penanda nomor sense dan tag prioritas/frekuensi dibuang karena daftar definisi
    // sudah bernomor dan tag prioritas bukan keterangan pemakaian.
    expect(merged[0]?.senses.map((sense) => sense.tags)).toEqual([[], [], [], []]);
    expect(merged[0]?.rows).toBe(4);
  });

  it('tidak menggabungkan kata dengan bacaan berbeda atau kamus berbeda', () => {
    const merged = mergeEntries([
      row('jmdict:1', ['a'], []),
      row('jmdict:2', ['b'], [], ['v1'], 'かたげる'),
      {
        ...row('lain:1', ['c'], []),
        entry: { ...row('lain:1', ['c'], []).entry, dictionaryId: 'lain', dictionaryName: 'Kamus Lain' },
      },
    ]);
    expect(merged.map((entry) => entry.reading)).toEqual(['かたむける', 'かたげる', 'かたむける']);
    expect(merged.every((entry) => entry.rows === 1)).toBe(true);
  });

  it('menampilkan sense hasil gabungan sebagai daftar bernomor berisi glosariumnya', () => {
    renderEntries(target(), [
      row('jmdict:1', ['to incline', 'to lean'], ['1', 'ichi']),
      row('jmdict:2', ['to devote oneself to'], ['2']),
      row('jmdict:3', ['to ruin'], ['3']),
    ]);
    const cards = [...target().querySelectorAll<HTMLElement>('[data-role="entry"]')];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute('data-rows')).toBe('3');
    const list = cards[0]?.querySelector('[data-role="definitions"]');
    expect(list?.querySelector('.definitions--single')).toBeNull();
    expect(list?.getAttribute('data-count')).toBe('3');
    expect(list?.getAttribute('data-glosses')).toBe('4');
    // Tiga sense bernomor; glosarium tiap sense berada di dalamnya.
    const senses = [...(cards[0]?.querySelectorAll('.definitions__item') ?? [])];
    expect(senses).toHaveLength(3);
    expect(
      senses.map((sense) =>
        [...sense.querySelectorAll('.glosses__item')].map((gloss) => gloss.textContent),
      ),
    ).toEqual([['to incline', 'to lean'], ['to devote oneself to'], ['to ruin']]);
    // Metadata tiap sense ditulis inline dalam tanda kurung siku, dan nomor sense
    // (tag angka pada dataset) tidak diulang di dalamnya.
    const metas = [...(cards[0]?.querySelectorAll('.definitions__meta') ?? [])].map(
      (meta) => meta.textContent,
    );
    // `ichi` adalah tag frekuensi: tidak muncul walau ada di dataset.
    expect(metas).toEqual(['[v1, vt]', '[v1, vt]', '[v1, vt]']);
    expect(cards[0]?.querySelector('.badge')).toBeNull();
  });
});
