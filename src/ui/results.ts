/**
 * Renderer kartu entri kamus, dipakai bersama oleh popup dalam halaman, action popup,
 * dan halaman pencarian (PRD 4.3, 5.3).
 *
 * Struktur tampilan mengikuti popup Hachidori/GSM (kelas `jl-*`):
 *
 *   ┌─ header (jl-header) ───────────────────────────────┐
 *   │ [nav: kueri + status + tutup]                      │
 *   │ [jl-tabs: All · JMdict · …]                        │
 *   ├─ area gulir (jl-scroll) ──────────────────────────┤
 *   │ ┌─ article.jl-entry ─────────────────────────────┐ │
 *   │ │ 野垂れ死ぬ  のたれじぬ            JMdict       │ │  ← jl-top
 *   │ │ 1. [v5n, vi]                                  │ │
 *   │ │    • to die by the roadside                    │ │
 *   │ │    • to die a dog's death                      │ │
 *   │ │ 2. [forms] …                                   │ │
 *   │ └────────────────────────────────────────────────┘ │
 *   └────────────────────────────────────────────────────┘
 *
 * Perbedaan yang disengaja dari referensi (lihat `docs/mvp-audit.md` §4.21): entri tidak
 * punya tombol audio maupun tombol Anki (di luar cakupan MVP), dan setiap kartu tetap
 * menyediakan disclosure rantai deinfleksi (§4.18).
 *
 * Kontrak keamanan: seluruh nilai dari dataset ditulis sebagai teks (`textContent`);
 * definisi berstruktur (schema v2) dibangun dari daftar putih tag di `./structured.ts`,
 * jadi markup/script pada data kamus tidak pernah dieksekusi browser.
 */

import type { DefinitionItem } from '../core/structured.js';
import type {
  DeinflectionStep,
  KanjiMatch,
  LookupMatch,
  MetaMatch,
  PitchValue,
} from '../core/types.js';
import { el } from './dom.js';
import { inflectionDisclosure } from './inflection.js';
import { pitchCategory, pitchMarks, pitchMorae, pitchReading } from './pitch.js';
import { structuredDefinitionDom } from './structured.js';
import { t } from './strings.js';

export interface EntryListOptions {
  /**
   * Bila diberikan, setiap kanji pada headword menjadi tombol yang memanggil callback
   * ini (pola `gsm-hoshidicts-kanji-link` Hachidori: klik kanji → lookup kanji itu).
   */
  onKanjiClick?: (character: string) => void;
  /** Nilai meta istilah (pitch accent/frekuensi); ditampilkan sebagai badge di baris atas. */
  meta?: readonly MetaMatch[];
  /** Data kanji (bank kanji) untuk kueri; ditampilkan sebagai blok di atas daftar entri. */
  kanji?: readonly KanjiMatch[];
}

/**
 * Kumpulan baris dataset yang digabung menjadi satu kartu.
 *
 * Format kamus seperti JMdict memecah satu kata menjadi beberapa baris (satu baris per
 * sense) dengan expression + bacaan yang sama. Yomitan/Hachidori merendernya sebagai satu
 * kotak dengan sense bernomor, jadi baris-baris itu digabung untuk tampilan.
 */
export interface MergedSense {
  /**
   * Glosarium satu sense; beberapa nilai = sinonim dalam sense yang sama. Item dapat
   * berupa teks biasa atau structured content (mis. tabel bentuk kata).
   */
  definitions: DefinitionItem[];
  /** Kelas kata baris ini (dari dataset), tampil sebagai `[v1, vt]` di depan sense. */
  partOfSpeech: string[];
  /** Tag metadata baris ini (tanpa penanda nomor sense dan tag prioritas). */
  tags: string[];
}

export interface MergedEntry {
  dictionaryId: string;
  dictionaryName: string;
  expression: string;
  reading: string;
  /**
   * Sense entri, satu per baris dataset. Satu sense dapat memuat beberapa definisi
   * (sinonim); sense dinomori hanya bila ada lebih dari satu.
   */
  senses: MergedSense[];
  /** Jumlah baris dataset yang digabung (1 = tidak ada penggabungan). */
  rows: number;
  /**
   * Rantai deinfleksi untuk kartu ini bila bentuk permukaan pada halaman berbeda dari
   * bentuk kamus (mis. `聞こえてきた` → `聞こえる`). `null` bila kecocokan sudah persis.
   */
  inflection: { surface: string; steps: readonly DeinflectionStep[] } | null;
}

/** Rantai deinfleksi yang layak dijelaskan untuk sebuah kecocokan. */
function inflectionOf(match: LookupMatch): MergedEntry['inflection'] {
  if (match.steps.length === 0 || match.matchedText === match.entry.expression) {
    return null;
  }
  return { surface: match.matchedText, steps: match.steps };
}

/** Tag yang hanya berisi angka = penanda nomor sense, bukan metadata kelas kata. */
function isSenseIndexTag(tag: string): boolean {
  return /^\d{1,3}$/u.test(tag);
}

/**
 * Tag prioritas/frekuensi tidak ditampilkan di baris sense.
 *
 * Kamus gaya JMdict/Jitendex menandai kata umum lewat `tag_bank` dengan kategori
 * **popular** (`⭐`) dan **frequent** (`ichi`, `spec`, `gai`, `news1k`…`news24k`, dan
 * `nf01`…`nf48` pada kamus lain). Tag itu bukan kelas kata maupun keterangan pemakaian —
 * popup referensi (Hachidori/GSM) hanya menulis kelas kata di baris sense — dan menampilkan
 * bintang di setiap sense pada kata umum hanya menambah kebisingan. Data tetap utuh di
 * storage; penyaringan ini murni penyajian.
 */
export function isPriorityTag(tag: string): boolean {
  return /^[⭐★\uFE0F]+$/u.test(tag) || /^(?:ichi|news|nf|spec|gai)\d*[a-z]*$/u.test(tag);
}

/**
 * Gabungkan baris hasil yang berasal dari kamus, expression, dan bacaan yang sama.
 * Urutan kemunculan pertama dipertahankan.
 */
export function mergeEntries(matches: readonly LookupMatch[]): MergedEntry[] {
  const merged = new Map<string, MergedEntry>();
  for (const match of matches) {
    const { entry } = match;
    const tags = entry.tags.filter((tag) => !isSenseIndexTag(tag) && !isPriorityTag(tag));
    const key = `${entry.dictionaryId}\u0000${entry.expression}\u0000${entry.reading}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        dictionaryId: entry.dictionaryId,
        dictionaryName: entry.dictionaryName,
        expression: entry.expression,
        reading: entry.reading,
        senses: [
          {
            definitions: [...entry.definitions],
            partOfSpeech: [...entry.partOfSpeech],
            tags: [...tags],
          },
        ],
        rows: 1,
        inflection: inflectionOf(match),
      });
      continue;
    }
    // Kartu yang sama hanya menampilkan satu rantai: baris pertama yang memerlukan
    // deinfleksi sudah mewakili bentuk permukaan kartu ini.
    existing.inflection ??= inflectionOf(match);
    existing.senses.push({
      definitions: [...entry.definitions],
      partOfSpeech: [...entry.partOfSpeech],
      tags: [...tags],
    });
    existing.rows += 1;
  }
  return [...merged.values()];
}

/** Identitas sumber kamus dalam hasil: id internal, nama tampilan, jumlah entri. */
export interface DictionaryTab {
  id: string;
  name: string;
  count: number;
}

/**
 * Daftar sumber kamus pada hasil, urut sesuai kemunculan (urutan kamus aktif).
 * Entri pertama selalu "Semua" dengan id `*`.
 */
export function dictionaryTabs(matches: readonly LookupMatch[]): DictionaryTab[] {
  const merged = mergeEntries(matches);
  const tabs: DictionaryTab[] = [
    { id: '*', name: t('results.allDictionaries'), count: merged.length },
  ];
  const index = new Map<string, DictionaryTab>();
  for (const entry of merged) {
    const existing = index.get(entry.dictionaryId);
    if (existing === undefined) {
      const tab: DictionaryTab = {
        id: entry.dictionaryId,
        name: entry.dictionaryName,
        count: 1,
      };
      index.set(tab.id, tab);
      tabs.push(tab);
    } else {
      existing.count += 1;
    }
  }
  return tabs;
}

/** Saring hasil berdasarkan id kamus; `null` berarti semua kamus. */
export function filterByDictionary(
  matches: readonly LookupMatch[],
  dictionaryId: string | null,
): LookupMatch[] {
  if (dictionaryId === null) {
    return [...matches];
  }
  return matches.filter((match) => match.entry.dictionaryId === dictionaryId);
}

/** Karakter kanji (blok utama, ekstensi A, dan bentuk kompatibilitas). */
const KANJI = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

/**
 * Headword berisi tombol per kanji (pola `gsm-hoshidicts-kanji-link`) atau teks biasa
 * bila pemanggil tidak menyediakan callback klik kanji.
 */
function spelling(
  expression: string,
  onKanjiClick: EntryListOptions['onKanjiClick'],
): HTMLElement {
  const container = el('span', { className: 'entry__spelling' });
  if (onKanjiClick === undefined) {
    container.textContent = expression;
    return container;
  }
  for (const character of expression) {
    if (KANJI.test(character)) {
      const button = el('button', {
        className: 'entry__kanji',
        text: character,
        attrs: {
          type: 'button',
          'data-kanji': character,
          title: t('results.kanjiLookup', { kanji: character }),
          'aria-label': t('results.kanjiLookup', { kanji: character }),
        },
      });
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onKanjiClick(character);
      });
      container.append(button);
      continue;
    }
    container.append(document.createTextNode(character));
  }
  return container;
}

/**
 * Bacaan entri.
 *
 * Bila ada kamus pitch accent, bacaan diganti kontur nadanya (kana + garis naik/turun);
 * tanpa kamus pitch, bacaan ditampilkan apa adanya. Bacaan yang sama dengan headword
 * (kata kana) hanya ditampilkan sekali.
 */
function readingLine(
  expression: string,
  reading: string,
  pitches: readonly PitchReadingValue[],
): HTMLElement | null {
  if (pitches.length > 0) {
    const line = el('span', { className: 'entry__reading entry__reading--pitch' });
    for (const value of pitches) {
      line.append(pitchReadingElement(value));
    }
    return line;
  }
  if (reading.length === 0) {
    return el('span', {
      className: 'entry__reading entry__reading--missing',
      text: t('results.readingUnavailable'),
    });
  }
  if (reading === expression) {
    return null;
  }
  return el('span', { className: 'entry__reading', text: reading });
}

/** Satu pola aksen siap tampil: bacaan, posisi downstep, dan kamus asalnya. */
interface PitchReadingValue {
  reading: string;
  pitch: PitchValue;
  dictionaryName: string;
}

/**
 * Kontur satu pola aksen: kana bacaan dengan garis nada + keterangan untuk pembaca layar
 * (kategori, posisi, penanda mora, dan kamus asalnya).
 */
function pitchReadingElement(value: PitchReadingValue): HTMLElement {
  const morae = pitchMorae(value.reading);
  const category = pitchCategory(value.reading, value.pitch.position);
  const marks = pitchMarks(morae.length, value.pitch.devoice, value.pitch.nasal);
  const label = `${t(`results.pitch.${category}`)} [${value.pitch.position}]`;
  const extra = [
    marks.devoice.length > 0 ? t('results.pitchDevoice', { positions: marks.devoice.join(', ') }) : null,
    marks.nasal.length > 0 ? t('results.pitchNasal', { positions: marks.nasal.join(', ') }) : null,
  ].filter((part): part is string => part !== null);
  const title = `${value.dictionaryName}: ${label}${extra.length > 0 ? ` · ${extra.join(' · ')}` : ''}`;

  const element = pitchReading(morae, value.pitch.position, value.pitch.devoice, value.pitch.nasal);
  element.dataset['pitchCategory'] = category;
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', title);
  element.title = title;
  return element;
}

/**
 * Metadata satu sense: `[v1, vt, umum]` (pola Hachidori). `null` bila tidak ada metadata
 * yang perlu ditampilkan.
 */
function senseMeta(sense: MergedSense): HTMLElement | null {
  const values = [...sense.partOfSpeech, ...sense.tags];
  if (values.length === 0) {
    return null;
  }
  return el('span', {
    className: 'definitions__meta',
    text: `[${values.join(', ')}]`,
    attrs: { 'data-role': 'sense-meta' },
  });
}

/** Glosarium satu sense: beberapa definisi (sinonim) ditulis sebagai baris terpisah. */
function glossList(definitions: readonly DefinitionItem[], dictionaryId: string): HTMLElement {
  const list = el('ul', { className: 'glosses' });
  for (const definition of definitions) {
    list.append(
      el('li', {
        className: 'glosses__item',
        children: [structuredDefinitionDom(definition, dictionaryId)],
      }),
    );
  }
  return list;
}

/**
 * Seluruh sense entri ditampilkan sekaligus.
 *
 * Lebih dari satu sense → daftar bernomor (1, 2, 3, …) seperti Yomitan/Hachidori, dan
 * glosarium tiap sense berada di dalam nomor tersebut. Satu sense saja → glosariumnya
 * ditulis langsung tanpa nomor (tidak ada gunanya menomori satu-satunya sense).
 */
function definitionsList(senses: readonly MergedSense[], dictionaryId: string): HTMLElement {
  const glossCount = senses.reduce((total, sense) => total + sense.definitions.length, 0);
  const container = el('div', {
    className: 'entry__definitions',
    attrs: { 'data-role': 'definitions', 'data-count': senses.length, 'data-glosses': glossCount },
  });
  const glossary = el('div', { className: 'entry__glossary' });

  if (senses.length <= 1) {
    const single = el('div', { className: 'definitions definitions--single' });
    const sense = senses[0];
    if (sense !== undefined) {
      const meta = senseMeta(sense);
      if (meta !== null) {
        single.append(meta);
      }
      single.append(glossList(sense.definitions, dictionaryId));
    }
    glossary.append(single);
    container.append(glossary);
    return container;
  }

  const list = el('ol', { className: 'definitions' });
  for (const sense of senses) {
    const item = el('li', { className: 'definitions__item' });
    const meta = senseMeta(sense);
    if (meta !== null) {
      item.append(meta);
    }
    item.append(glossList(sense.definitions, dictionaryId));
    list.append(item);
  }
  glossary.append(list);
  container.append(glossary);
  return container;
}

/**
 * Batas graf pitch per entri: kata dengan banyak varian aksen jarang, dan deretan graf
 * panjang membuat baris atas kartu memenuhi popup.
 */
const MAX_PITCH_GRAPHS = 4;

/** Kunci satu pola aksen, dipakai membuang pola kembar dari kamus berbeda. */
function pitchSignature(pitch: PitchValue): string {
  return `${pitch.position}\u0000${pitch.devoice.join(',')}\u0000${pitch.nasal.join(',')}`;
}

/**
 * Pola pitch accent untuk sebuah entri, urut kemunculan dan tanpa pola kembar.
 *
 * Nilai tanpa bacaan (`reading` kosong) berlaku untuk bacaan apa pun; selain itu bacaan
 * harus sama supaya pitch kata berhomograf tidak tertukar. Pola yang persis sama dari
 * kamus berbeda hanya digambar sekali (beberapa kamus pitch memuat pola identik), dan
 * deretannya dipotong supaya baris bacaan tidak memanjang tanpa batas.
 */
function pitchValuesFor(entry: MergedEntry, meta: readonly MetaMatch[] | undefined): PitchReadingValue[] {
  const values: PitchReadingValue[] = [];
  const seen = new Set<string>();
  for (const match of meta ?? []) {
    if (match.expression !== entry.expression) {
      continue;
    }
    if (match.reading.length > 0 && match.reading !== entry.reading) {
      continue;
    }
    for (const value of match.values) {
      if (value.type !== 'pitch') {
        continue;
      }
      for (const pitch of value.pitches) {
        if (values.length >= MAX_PITCH_GRAPHS) {
          return values;
        }
        const signature = pitchSignature(pitch);
        if (seen.has(signature)) {
          continue;
        }
        seen.add(signature);
        values.push({
          reading: value.reading.length > 0 ? value.reading : entry.reading,
          pitch,
          dictionaryName: match.dictionaryName,
        });
      }
    }
  }
  return values;
}

/**
 * Frekuensi istilah untuk sebuah entri: satu chip per kamus (`[Jiten|200]`).
 *
 * Nama kamus ditampilkan karena frekuensi berbeda-beda antar kamus; pasangan kamus+nilai
 * yang sama hanya muncul sekali.
 */
function frequenciesFor(entry: MergedEntry, meta: readonly MetaMatch[] | undefined): HTMLElement[] {
  const badges: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const match of meta ?? []) {
    if (match.expression !== entry.expression) {
      continue;
    }
    if (match.reading.length > 0 && match.reading !== entry.reading) {
      continue;
    }
    for (const value of match.values) {
      if (value.type !== 'freq') {
        continue;
      }
      const text = value.frequency.displayValue ?? String(value.frequency.value);
      const signature = `${match.dictionaryName}\u0000${text}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      badges.push(
        el('span', {
          className: 'meta-badge meta-badge--freq',
          children: [
            el('span', { className: 'meta-badge__source', text: match.dictionaryName }),
            el('span', { className: 'meta-badge__value', text }),
          ],
          attrs: {
            'data-role': 'frequency',
            title: `${match.dictionaryName}: ${t('results.frequency')}`,
          },
        }),
      );
    }
  }
  return badges;
}

/** Kunci statistik bank kanji yang punya label Indonesia; kunci lain ditampilkan apa adanya. */
const KANJI_STAT_KEYS: Readonly<Record<string, string>> = {
  strokes: 'results.stat.strokes',
  grade: 'results.stat.grade',
  freq: 'results.stat.freq',
  jlpt: 'results.stat.jlpt',
  jouyou: 'results.stat.jouyou',
  jinmeiyou: 'results.stat.jinmeiyou',
};

/** Satu kartu kanji: karakter, bacaan on/kun, arti bernomor, lalu chip statistik dan tag. */
function kanjiItem(match: KanjiMatch): HTMLElement {
  const item = el('article', {
    className: 'kanji-block__item',
    attrs: { 'data-dictionary': match.dictionaryId },
  });

  const top = el('div', { className: 'kanji-block__top' });
  top.append(el('span', { className: 'kanji-block__character', text: match.character }));
  if (match.onyomi.length > 0) {
    top.append(el('span', { className: 'kanji-block__onyomi', text: match.onyomi.join('、') }));
  }
  if (match.kunyomi.length > 0) {
    top.append(el('span', { className: 'kanji-block__kunyomi', text: match.kunyomi.join('、') }));
  }
  top.append(
    el('span', {
      className: 'entry__dictionary',
      text: match.dictionaryName,
      attrs: { title: `${t('results.source')}: ${match.dictionaryId}` },
    }),
  );
  item.append(top);

  if (match.meanings.length > 0) {
    const meanings = el('ol', { className: 'kanji-block__meanings' });
    for (const meaning of match.meanings) {
      meanings.append(el('li', { className: 'kanji-block__meaning', text: meaning }));
    }
    item.append(meanings);
  }

  const chips = el('div', { className: 'kanji-block__chips' });
  for (const [key, value] of Object.entries(match.stats)) {
    const label = KANJI_STAT_KEYS[key];
    chips.append(
      el('span', {
        className: 'kanji-block__chip',
        text: `${label === undefined ? key : t(label)}: ${value}`,
      }),
    );
  }
  for (const tag of match.tags) {
    chips.append(el('span', { className: 'kanji-block__chip', text: tag }));
  }
  if (chips.childElementCount > 0) {
    item.append(chips);
  }
  return item;
}

/** Blok data kanji (bank kanji) di atas daftar entri, satu kartu per kamus. */
function kanjiBlock(kanji: readonly KanjiMatch[]): HTMLElement {
  const section = el('section', {
    className: 'kanji-block',
    attrs: { 'data-role': 'kanji', 'aria-label': t('results.kanji') },
  });
  for (const match of kanji) {
    section.append(kanjiItem(match));
  }
  return section;
}

/**
 * Satu kartu entri: baris atas (headword, bacaan, kamus, rantai infleksi) dan definisi.
 *
 * Headword **selalu** ditampilkan (pola `jl-top` Hachidori): header popup memuat kata
 * yang dipindai, sedangkan kartu memuat bentuk kamus entri — keduanya bukan hal yang sama
 * (mis. memindai `聞こえてきた` menampilkan entri `聞こえる`).
 */
function entryCard(entry: MergedEntry, options: EntryListOptions, showFrequencies = true): HTMLElement {
  const card = el('article', {
    className: 'entry',
    attrs: {
      'data-role': 'entry',
      'data-rows': String(entry.rows),
      'data-dictionary': entry.dictionaryId,
    },
  });

  const top = el('div', { className: 'entry__top' });
  top.append(spelling(entry.expression, options.onKanjiClick));
  const reading = readingLine(entry.expression, entry.reading, pitchValuesFor(entry, options.meta));
  if (reading !== null) {
    top.append(reading);
  }
  top.append(
    el('span', {
      className: 'entry__dictionary',
      text: entry.dictionaryName,
      attrs: { title: `${t('results.source')}: ${entry.dictionaryId}` },
    }),
  );
  card.append(top);

  // Frekuensi tampil di barisnya sendiri di bawah headword (bukan sejajar dengan bacaan):
  // satu kamus frekuensi bisa menyumbang beberapa baris, dan chip `[kamus|nilai]` panjang.
  // Hanya pada kartu pertama bentuk istilah itu supaya nilainya tidak terulang di setiap kartu.
  const frequencies = showFrequencies ? frequenciesFor(entry, options.meta) : [];
  if (frequencies.length > 0) {
    card.append(el('div', { className: 'entry__frequencies', children: frequencies }));
  }

  const inflection =
    entry.inflection === null
      ? null
      : inflectionDisclosure(entry.inflection.surface, entry.expression, entry.inflection.steps);
  if (inflection !== null) {
    card.append(inflection);
  }

  card.append(definitionsList(entry.senses, entry.dictionaryId));

  return card;
}

/**
 * Satu kartu entri berdiri sendiri (headword selalu tampil).
 * Baris dengan kamus/expression/bacaan sama digabung menjadi satu kartu.
 */
export function renderEntry(match: LookupMatch, options: EntryListOptions = {}): HTMLElement {
  const [entry] = mergeEntries([match]);
  if (entry === undefined) {
    throw new Error('Entry kosong.');
  }
  return entryCard(entry, options);
}

/**
 * Daftar entri datar (pola `jl-scroll > article.jl-entry`): setiap kartu menampilkan
 * namanya sebagai penanda kamus, jadi tidak ada panel per kamus. Navigasi panah
 * atas/bawah berpindah antar kartu.
 */
export function renderEntries(
  container: HTMLElement,
  matches: readonly LookupMatch[],
  options: EntryListOptions = {},
): void {
  const list = el('div', { className: 'results' });

  if (options.kanji !== undefined && options.kanji.length > 0) {
    list.append(kanjiBlock(options.kanji));
  }

  // Frekuensi dimiliki bentuk istilah, bukan satu kamus: barisnya hanya tampil pada kartu
  // pertama bentuk itu, supaya tidak terulang di setiap kartu kamus untuk kata yang sama.
  const termsWithFrequencies = new Set<string>();
  mergeEntries(matches).forEach((entry, index) => {
    const termKey = `${entry.expression}\u0000${entry.reading}`;
    const firstOfTerm = !termsWithFrequencies.has(termKey);
    termsWithFrequencies.add(termKey);
    const card = entryCard(entry, options, firstOfTerm);
    card.tabIndex = -1;
    card.dataset['index'] = String(index);
    card.dataset['selected'] = index === 0 ? 'true' : 'false';
    list.append(card);
  });

  list.addEventListener('keydown', (event) => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    const cards = [...list.querySelectorAll<HTMLElement>('[data-role="entry"]')];
    const position = cards.findIndex((card) => card === document.activeElement);
    if (position === -1) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      cards[(position + delta + cards.length) % cards.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      cards[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      cards[cards.length - 1]?.focus();
    }
  });

  container.append(list);
}
