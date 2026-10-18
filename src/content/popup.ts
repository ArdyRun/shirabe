/**
 * Popup hasil lookup di dalam halaman (PRD 4.1, 4.3, 5.4).
 *
 * Isolasi: host element + Shadow DOM tertutup + `all: initial`, sehingga CSS situs
 * tidak memengaruhi popup dan sebaliknya. Tidak ada node situs yang diubah selain
 * penambahan host popup milik Shirabe.
 */

import type { ThemePreference } from '../core/preferences.js';
import type { LookupSourceKind } from '../messaging/protocol.js';
import type { LookupMatch, LookupResult } from '../core/types.js';
import { el } from '../ui/dom.js';
import { resetMediaCache } from '../ui/media.js';
import { ResultsPanel } from '../ui/results-panel.js';
import { t } from '../ui/strings.js';
import { applyThemeWithListener } from '../ui/theme.js';
import popupStyles from './popup.css?inline';

export interface PopupAnchor {
  left: number;
  top: number;
  bottom: number;
  height: number;
}

export interface PopupView {
  query: string;
  source: LookupSourceKind;
  result: LookupResult | null;

  /** Pesan status ketika hasil belum tersedia (memuat atau gagal). */
  status?: string;
  /** Benar bila `status` adalah pesan pemuatan (bukan kegagalan). */
  loading?: boolean;
}

export interface PopupOptions {
  width: number;
  maxHeight: number;
  /** Preferensi tema (id katalog atau `auto`); lihat `src/core/themes.ts`. */
  theme: ThemePreference;
  /** Dipanggil saat pengguna mengklik satu kanji pada headword (lookup kanji tunggal). */
  onKanjiClick?: (character: string) => void;
  /** Dipanggil setelah pengguna selesai menarik pegangan ubah ukuran (lebar dalam px). */
  onResize?: (width: number) => void;
}

/** Rentang lebar popup saat diubah dengan menarik; sama dengan pengaturan lebar. */
const RESIZE_MIN_WIDTH = 280;
const RESIZE_MAX_WIDTH = 720;

const SOURCE_LABELS: Record<PopupView['source'], string> = {
  hover: 'hover',
  selection: 'teks terpilih',
  manual: 'pencarian manual',
  kanji: 'kanji',
  'context-menu': 'teks terpilih',
};

/**
 * Jarak popup dari posisi kursor (px) — sama dengan nilai default Yomitan
 * (`popupHorizontalOffset`/`popupVerticalOffset`).
 */
const PLACEMENT_MARGIN = 10;
/** Sisi utama popup: di bawah teks, seperti default Yomitan (`popupHorizontalTextPosition`). */
const PLACEMENT_PREFER_BELOW = true;

export class ContentPopup {
  readonly host: HTMLDivElement;

  #shadow: ShadowRoot;
  #panel: HTMLDivElement;
  #tabs!: HTMLDivElement;
  #status: HTMLSpanElement;
  #body: HTMLDivElement;
  #results: ResultsPanel;
  #matches: LookupMatch[] = [];
  #selectedIndex = 0;
  #open = false;
  #view: PopupView | null = null;
  #anchor: PopupAnchor | null = null;
  #baseMaxHeight = '72vh';
  #removeThemeListener: () => void = () => undefined;
  #onClose: (() => void) | null = null;
  #options: PopupOptions;

  constructor(options: PopupOptions) {
    this.host = document.createElement('div');
    this.host.hidden = true;
    this.host.setAttribute('data-shirabe', 'popup');
    this.#shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = popupStyles;

    this.#panel = el('div', {
      className: 'panel',
      attrs: { role: 'dialog', 'aria-label': 'Hasil lookup Shirabe' },
    });
    this.#status = el('span', { className: 'panel__status', attrs: { 'aria-live': 'polite' } });
    const closeButton = el('button', {
      className: 'icon-button',
      text: '✕',
      attrs: { type: 'button', title: t('results.close'), 'aria-label': t('results.close') },
    });
    closeButton.addEventListener('click', () => {
      this.close();
    });

    this.#body = el('div', { className: 'panel__body' });
    // Host strip tab dibuat SEBELUM panel: `tabsHost` dibaca saat konstruksi, jadi kalau
    // dibuat sesudahnya nilainya `undefined` dan tab akan jatuh ke area gulir (bukan header).
    this.#tabs = el('div', {
      className: 'panel__tabs',
      attrs: { 'data-role': 'dictionary-tabs-host' },
    });
    this.#results = new ResultsPanel(this.#body, {
      // Strip sumber kamus mengisi baris atas popup; kata yang dipindai tidak diulang di
      // sini karena kartu entri sudah menampilkan headword + bacaannya.
      tabsHost: this.#tabs,
      onKanjiClick: (character) => {
        this.#options.onKanjiClick?.(character);
      },
    });
    // Header: strip tab sumber kamus (dapat digulir mendatar) + status singkat + tombol tutup.
    const header = el('div', {
      className: 'panel__header',
      children: [
        this.#tabs,
        el('div', { className: 'panel__toolbar', children: [this.#status, closeButton] }),
      ],
    });

    const resizeHandle = el('div', {
      className: 'panel__resize',
      attrs: { title: t('results.resize'), 'data-role': 'resize-handle' },
    });
    this.#bindResize(resizeHandle);

    this.#panel.append(header, this.#body, resizeHandle);
    this.#shadow.append(style, this.#panel);

    this.#options = options;
    this.configure(options);
  }

  /**
   * Pegangan ubah ukuran di sudut kanan bawah (pola `gsm-hoshidicts-resize-handle`):
   * lebar mengikuti tarikan langsung, lalu disimpan ke preferensi lebar popup.
   */
  #bindResize(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const startWidth = this.#panel.getBoundingClientRect().width;
      const startX = event.clientX;
      handle.setPointerCapture(event.pointerId);
      const onMove = (move: PointerEvent): void => {
        const width = Math.min(
          RESIZE_MAX_WIDTH,
          Math.max(RESIZE_MIN_WIDTH, Math.round(startWidth + (move.clientX - startX))),
        );
        this.#panel.style.width = `${width}px`;
        if (this.#open) {
          this.#place();
        }
      };
      const onUp = (up: PointerEvent): void => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        const width = Math.round(this.#panel.getBoundingClientRect().width);
        this.#options = { ...this.#options, width };
        this.#options.onResize?.(width);
        handle.releasePointerCapture(up.pointerId);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /**
   * Atur apakah popup menerima event pointer.
   *
   * Saat pemindaian aktif (modifier ditahan) popup dibuat transparan terhadap pointer:
   * hit-test halaman melihat teks di bawahnya lagi, sehingga menyapu kursor dengan
   * modifier tidak pernah "tertutup" oleh popup — masalah yang sama juga dihadapi
   * Yomitan/Hachidori, dan ini solusi tanpa memindahkan popup. Setelah modifier dilepas,
   * popup kembali interaktif supaya dapat dibaca, digulir, dan diklik.
   */
  setPointerInteractive(interactive: boolean): void {
    this.host.style.pointerEvents = interactive ? 'auto' : 'none';
  }

  /** Benar bila event berasal dari dalam popup (untuk deteksi klik di luar). */
  ownsTarget(target: EventTarget | null): boolean {
    return target === this.host;
  }

  configure(options: PopupOptions): void {
    this.#options = { ...this.#options, ...options };
    this.#panel.style.width = `${options.width}px`;
    this.#baseMaxHeight = `${options.maxHeight}px`;
    this.#panel.style.maxHeight = this.#baseMaxHeight;
    this.#removeThemeListener();
    this.#removeThemeListener = applyThemeWithListener(options.theme, this.#panel);
    if (this.#open) {
      this.#place();
    }
  }

  onClose(callback: () => void): void {
    this.#onClose = callback;
  }

  /** Tampilkan hasil lookup dan posisikan popup dekat rentang teks sumber. */
  show(view: PopupView, anchor: PopupAnchor): void {
    this.#view = view;
    this.#anchor = anchor;
    this.#status.textContent = SOURCE_LABELS[view.source];
    this.#matches = view.result?.matches ?? [];
    this.#selectedIndex = 0;
    this.#open = true;
    this.host.hidden = false;
    // Status yang dapat dibaca dari luar shadow root tertutup (pengujian & observasi),
    // menggantikan dugaan berdasarkan tinggi popup.
    const kanjiCount = view.result?.kanji.length ?? 0;
    this.host.dataset['state'] = view.loading === true
      ? 'loading'
      : view.status !== undefined
        ? 'error'
        : this.#matches.length > 0 || kanjiCount > 0
          ? 'ready'
          : 'empty';
    this.#render();
  }

  /**
   * Pindahkan popup mengikuti rentang teks sumber (scroll/resize) tanpa merender ulang.
   * Rendering ulang akan menghapus pilihan entri saat ini.
   */
  reposition(anchor: PopupAnchor): void {
    this.#anchor = anchor;
    if (this.#open) {
      this.#place();
    }
  }

  /** Tampilkan pesan status tanpa hasil (mis. sedang memuat atau gagal). */
  showStatus(query: string, status: string, anchor: PopupAnchor): void {
    this.show({ query, source: 'hover', result: null, status }, anchor);
  }

  close(): void {
    if (!this.#open) {
      return;
    }
    this.#open = false;
    this.host.hidden = true;
    this.#results.clear();
    resetMediaCache();
    this.#matches = [];
    this.#view = null;
    delete this.host.dataset['state'];
    this.#onClose?.();
  }

  /** Tangani tombol keyboard popup; mengembalikan true bila event dikonsumsi. */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.#open) {
      return false;
    }
    if (event.key === 'Escape') {
      this.close();
      return true;
    }
    if (this.#view?.status !== undefined || this.#matches.length === 0) {
      return false;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.#select(this.#selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
      return true;
    }
    return false;
  }

  #render(): void {
    const view = this.#view;
    if (view === null) {
      return;
    }

    if (view.status !== undefined) {
      this.#results.showMessage(view.status);
    } else {
      // Panel bersama menangani tab sumber kamus, kartu entri, dan catatan hasil.
      this.#results.show(view.result);
      this.#select(0);
    }

    this.#place();
  }

  #select(index: number): void {
    if (this.#matches.length === 0) {
      return;
    }
    this.#selectedIndex = index;
    this.#results.selectEntry(index);
  }

  /**
   * Tempatkan popup dengan aturan yang sama seperti Yomitan (`popup.js`
   * `_getPositionForHorizontalText` + `_getConstrainedPositionBinary`):
   *
   * 1. Sisi dipilih sekali per posisi kursor: default **di bawah** teks; hanya berpindah
   *    ke atas bila ruang di bawah lebih sempit daripada ruang di atas.
   * 2. Popup tidak pernah keluar dari viewport: tingginya dipangkas ke ruang yang
   *    tersedia pada sisi terpilih (isi dapat digulir), bukan digeser ke sisi lain.
   * 3. Sumbu horizontal selalu mulai 10 px di kanan posisi kursor, lalu digeser ke kiri
   *    seperlunya agar tidak melewati tepi kanan.
   *
   * Hasilnya deterministik terhadap satu posisi kursor: menyapu kursor di dalam satu
   * kata tidak membuat popup meloncat ke sisi lain.
   */
  #place(): void {
    const anchor = this.#anchor;
    if (anchor === null) {
      return;
    }
    // Selalu ukur pada batas tinggi normal dulu supaya pemangkasan sebelumnya tidak
    // membuat tinggi terukur menyusut terus (ratchet).
    this.#panel.style.maxHeight = this.#baseMaxHeight;
    const width = this.#panel.offsetWidth;
    const height = this.#panel.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    let left = Math.max(0, anchor.left + PLACEMENT_MARGIN);
    left -= Math.max(0, left + width - viewportWidth);

    const overflowBelow = anchor.bottom + PLACEMENT_MARGIN + height - viewportHeight;
    const overflowAbove = -(anchor.top - PLACEMENT_MARGIN - height);
    const below =
      overflowBelow > 0 || overflowAbove > 0 ? overflowBelow < overflowAbove : PLACEMENT_PREFER_BELOW;

    let top: number;
    let available: number;
    if (below) {
      available = height - Math.max(0, overflowBelow);
      top = Math.max(0, anchor.bottom + PLACEMENT_MARGIN);
    } else {
      available = height - Math.max(0, overflowAbove);
      top = Math.min(viewportHeight, anchor.top - PLACEMENT_MARGIN) - available;
    }
    if (available < height) {
      this.#panel.style.maxHeight = `${Math.max(Math.round(available), 1)}px`;
    }
    this.host.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(0, top))}px)`;
  }
}
