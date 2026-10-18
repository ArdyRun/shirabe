/**
 * Panel hasil lookup: tab sumber kamus, panel/kartu entri, dan navigasi keyboard.
 *
 * Dipakai bersama oleh popup dalam halaman (shadow DOM tertutup), action popup, dan
 * halaman pencarian, sehingga seluruh permukaan menampilkan struktur yang sama.
 * Kalimat sumber **tidak** ditampilkan di sini: pemilik produk memilih popup tanpa blok
 * konteks kalimat (lihat catatan deviasi pada `docs/mvp-audit.md` §4.14).
 */

import type { LookupMatch, LookupResult } from '../core/types.js';
import { clear, el } from './dom.js';
import { resetMediaCache } from './media.js';
import {
  dictionaryTabs,
  filterByDictionary,
  renderEntries,
  type DictionaryTab,
} from './results.js';
import { t } from './strings.js';

export interface ResultsPanelOptions {
  /**
   * Elemen tempat strip tab sumber kamus dirender. Bila diberikan (popup dalam halaman),
   * tab pindah ke header popup — pola `jl-header > jl-tabs` Hachidori. Bila tidak, tab
   * tampil di atas daftar hasil (halaman pencarian dan action popup).
   */
  tabsHost?: HTMLElement;
  /** Callback klik kanji pada headword (lookup kanji tunggal). */
  onKanjiClick?: (character: string) => void;
  /** Callback perubahan pilihan entri (navigasi keyboard). */
  onSelectionChange?: (index: number) => void;
}

export class ResultsPanel {
  #container: HTMLElement;
  #options: ResultsPanelOptions;
  #matches: readonly LookupMatch[] = [];
  #result: LookupResult | null = null;
  #message: string | null = null;
  #activeDictionary: string | null = null;
  #selectedIndex = 0;
  #tabsStrip: HTMLElement | null = null;

  constructor(container: HTMLElement, options: ResultsPanelOptions = {}) {
    this.#container = container;
    this.#options = options;
  }

  /** Id kamus yang sedang dipilih; `null` berarti semua kamus. */
  get activeDictionaryId(): string | null {
    return this.#activeDictionary;
  }

  /** Jumlah kartu entri yang tampil setelah pemfilteran sumber kamus. */
  get visibleCount(): number {
    return filterByDictionary(this.#matches, this.#activeDictionary).length;
  }

  get hasResults(): boolean {
    return this.#matches.length > 0;
  }

  /** Tampilkan hasil lookup; `message` mengisi pesan status bila hasil tidak ada. */
  showResult(result: LookupResult | null, message?: string): void {
    this.#result = result;
    this.#message = message ?? null;
    this.#matches = result?.matches ?? [];
    this.#selectedIndex = 0;
    // Sumber kamus yang dipilih direset bila kamus itu tidak ada lagi di hasil baru.
    if (
      this.#activeDictionary !== null &&
      !this.#matches.some((match) => match.entry.dictionaryId === this.#activeDictionary)
    ) {
      this.#activeDictionary = null;
    }
    this.#render();
  }

  showMessage(message: string): void {
    this.#result = null;
    this.#message = message;
    this.#matches = [];
    this.#selectedIndex = 0;
    this.#render();
  }

  clear(): void {
    this.#result = null;
    this.#message = null;
    this.#matches = [];
    resetMediaCache();
    clear(this.#container);
    this.#clearTabs();
  }

  /** Hapus strip tab (dipakai saat panel dibersihkan atau tab tidak diperlukan). */
  #clearTabs(): void {
    this.#tabsStrip?.remove();
    this.#tabsStrip = null;
  }

  /** Ganti sumber kamus yang ditampilkan (tanpa mengubah data hasil). */
  selectDictionary(dictionaryId: string | null): void {
    if (this.#activeDictionary === dictionaryId) {
      return;
    }
    this.#activeDictionary = dictionaryId;
    this.#selectedIndex = 0;
    this.#render();
  }

  /** Pilih kartu entri ke-`index` di antara kartu yang sedang tampil. */
  selectEntry(index: number): void {
    const cards = this.#cards();
    if (cards.length === 0) {
      return;
    }
    this.#selectedIndex = ((index % cards.length) + cards.length) % cards.length;
    cards.forEach((card, position) => {
      const selected = position === this.#selectedIndex;
      card.dataset['selected'] = selected ? 'true' : 'false';
      if (selected) {
        card.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /** Tampilkan hasil lookup (dipakai popup dalam halaman dan action popup). */
  show(result: LookupResult | null, message?: string): void {
    this.#result = result;
    this.#message = message ?? null;
    this.#matches = result?.matches ?? [];
    this.#selectedIndex = 0;
    if (
      this.#activeDictionary !== null &&
      !this.#matches.some((match) => match.entry.dictionaryId === this.#activeDictionary)
    ) {
      this.#activeDictionary = null;
    }
    this.#render();
  }

  #cards(): HTMLElement[] {
    return [...this.#container.querySelectorAll<HTMLElement>('[data-role="entry"]')];
  }

  /**
   * Tab sumber kamus (pola `jl-tabs` Hachidori: grup tombol dengan `aria-pressed`).
   * Hanya ditampilkan bila hasil memuat lebih dari satu kamus: dengan satu kamus,
   * "Semua" dan nama kamus itu identik sehingga hanya menambah kebisingan.
   */
  #renderTabs(tabs: readonly DictionaryTab[]): void {
    this.#clearTabs();
    if (tabs.length <= 2) {
      return;
    }
    const strip = el('div', {
      className: 'dict-tabs',
      attrs: { role: 'group', 'aria-label': t('results.dictionaryTabs'), 'data-role': 'dictionary-tabs' },
    });
    for (const tab of tabs) {
      const selected = tab.id === (this.#activeDictionary ?? '*');
      const button = el('button', {
        className: 'dict-tab',
        attrs: {
          type: 'button',
          'data-dictionary': tab.id,
          // Label dipotong dengan elipsis (maks. 150px seperti tab Hachidori).
          title: tab.name,
          'aria-pressed': selected ? 'true' : 'false',
          tabindex: selected ? '0' : '-1',
        },
        children: [
          el('span', { className: 'dict-tab__label', text: tab.name }),
          el('span', { className: 'dict-tab__count', text: String(tab.count) }),
        ],
      });
      button.addEventListener('click', () => {
        this.selectDictionary(tab.id === '*' ? null : tab.id);
      });
      strip.append(button);
    }
    strip.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent)) {
        return;
      }
      const buttons = [...strip.querySelectorAll<HTMLButtonElement>('.dict-tab')];
      const position = buttons.findIndex((button) => button === document.activeElement);
      if (position === -1) {
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const next = buttons[(position + delta + buttons.length) % buttons.length];
        next?.focus();
        next?.click();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const next = event.key === 'Home' ? buttons[0] : buttons.at(-1);
        next?.focus();
        next?.click();
      }
    });
    // Strip tab bisa lebih lebar daripada popup (kamus aktif banyak): roda mouse
    // menggesernya mendatar, sehingga tab terakhir tetap terjangkau tanpa menggeser isi
    // popup ke bawah. Geseran mendatar dari trackpad dibiarkan seperti adanya.
    strip.addEventListener(
      'wheel',
      (event) => {
        if (event.deltaY === 0 || strip.scrollWidth <= strip.clientWidth) {
          return;
        }
        event.preventDefault();
        strip.scrollLeft += event.deltaY;
      },
      { passive: false },
    );
    const host = this.#options.tabsHost ?? this.#container;
    host.append(strip);
    this.#tabsStrip = strip;
  }

  #render(): void {
    clear(this.#container);
    // Cache gambar sengaja TIDAK direset di sini: data URL yang sudah diambil dipakai
    // ulang antar lookup di halaman yang sama (batas 48 entri di `media.ts` yang menjaga
    // memori), dan `clear()` yang mengosongkannya saat popup/panel ditutup.
    if (this.#message !== null) {
      this.#container.append(el('p', { className: 'note', text: this.#message }));
      return;
    }

    const result = this.#result;
    if (result === null && this.#matches.length === 0) {
      return;
    }

    const kanji = result?.kanji ?? [];
    // Lookup kanji murni tidak punya entri istilah: pesan "tidak ada hasil" hanya untuk
    // kueri yang benar-benar kosong, sedangkan blok kanjinya tetap ditampilkan.
    if (this.#matches.length === 0 && kanji.length === 0) {
      this.#container.append(
        el('p', { className: 'note', text: t('results.empty', { query: result?.query ?? '' }) }),
        el('p', { className: 'note', text: t('results.emptyHint') }),
      );
      return;
    }

    this.#renderTabs(dictionaryTabs(this.#matches));

    const visible = filterByDictionary(this.#matches, this.#activeDictionary);
    const list = el('div', { className: 'results' });
    renderEntries(list, visible, {
      onKanjiClick: this.#options.onKanjiClick,
      meta: result?.meta,
      kanji,
    });
    this.#container.append(list);

    if (result?.truncated === true) {
      this.#container.append(
        el('p', { className: 'note', text: t('results.truncated', { shown: this.#matches.length }) }),
      );
    }
    if (result?.inputTruncated === true) {
      this.#container.append(el('p', { className: 'note', text: t('results.truncatedInput') }));
    }
  }
}
