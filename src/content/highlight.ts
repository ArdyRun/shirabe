/**
 * Sorotan kata yang sedang di-lookup pada halaman (pola Hachidori `::highlight`).
 *
 * Memakai CSS Custom Highlight API: rentang yang sudah dipindai didaftarkan ke
 * `CSS.highlights`, sehingga browser yang melukis sorotannya. Tidak ada elemen/kelas
 * yang ditambahkan ke DOM halaman — halaman tidak pernah melihat perubahan struktur,
 * dan sorotan otomatis mengikuti teks saat halaman digulir/di-zoom (rentangnya hidup).
 *
 * Aturan `::highlight()` hanya berlaku pada dokumen tempat rentangnya berada, jadi gaya
 * ditulis ke satu `<style>` milik kita di dokumen (bukan ke shadow root popup).
 * Bila API tidak tersedia, sorotan dilewati tanpa mengubah perilaku lain.
 */

import { themeFor } from '../ui/theme.js';
import type { ThemePalette } from '../core/themes.js';
import type { ThemePreference } from '../core/preferences.js';

/** Nama highlight; hanya dipakai oleh Shirabe (halaman lain dapat memakai nama sendiri). */
export const HIGHLIGHT_NAME = 'shirabe-match';

/**
 * Porsi aksen palet pada latar sorotan. Nilai mengikuti referensi (primary 34%, dan
 * 56% pada tema kontras tinggi) supaya sorotan tetap terbaca di semua tema.
 */
const HIGHLIGHT_MIX = 34;
const HIGHLIGHT_MIX_CONTRAST = 56;
const CONTRAST_THEME_ID = 'high-contrast';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Rentang masih terpasang di dokumen (node awalnya belum dilepas halaman). */
function isConnected(range: Range): boolean {
  const container = range.startContainer;
  return container.parentNode !== null || container === document.documentElement;
}

function supportsHighlightApi(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof Highlight === 'function' &&
    typeof Range !== 'undefined'
  );
}

export class SourceHighlight {
  #style: HTMLStyleElement | null = null;
  #palette: ThemePalette | null = null;
  #contrast = false;
  #shown: Range | null = null;
  #removeListener: () => void = () => undefined;

  constructor(theme: ThemePreference) {
    this.#applyTheme(theme);
  }

  /** Ikuti preferensi tema popup (termasuk perubahan tema sistem). */
  setThemePreference(preference: ThemePreference): void {
    this.#removeListener();
    this.#removeListener = () => undefined;
    this.#applyTheme(preference);
  }

  /**
   * Sorot rentang kata yang sedang di-lookup; `null` menghapus sorotan.
   *
   * Rentang yang tidak lagi terpasang di dokumen (mis. blok DOM diganti oleh halaman)
   * diabaikan, sehingga tidak ada rentang basi yang tersisa di `CSS.highlights`.
   */
  show(range: Range | null): void {
    this.clear();
    if (range === null || !supportsHighlightApi() || !isConnected(range)) {
      return;
    }
    try {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
      this.#shown = range;
    } catch {
      // Rentang tidak valid (mis. node dilepas saat pemindaian): biarkan tanpa sorotan.
      this.#shown = null;
    }
  }

  /** Hapus sorotan; aman dipanggil berkali-kali. */
  clear(): void {
    if (this.#shown === null) {
      return;
    }
    this.#shown = null;
    if (supportsHighlightApi()) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }
  }

  /** Lepas gaya dan pendengar tema (dipakai saat pemindaian dihentikan). */
  dispose(): void {
    this.clear();
    this.#removeListener();
    this.#removeListener = () => undefined;
    this.#style?.remove();
    this.#style = null;
  }

  #applyTheme(preference: ThemePreference): void {
    const media = window.matchMedia(DARK_QUERY);
    const update = (): void => {
      const { id, palette } = themeFor(preference, media.matches);
      this.#palette = palette;
      this.#contrast = id === CONTRAST_THEME_ID;
      this.#writeStyle();
    };
    update();
    if (preference !== 'auto' && preference !== 'system') {
      return;
    }
    media.addEventListener('change', update);
    this.#removeListener = () => {
      media.removeEventListener('change', update);
    };
  }

  #writeStyle(): void {
    if (!supportsHighlightApi()) {
      return;
    }
    if (this.#style === null || !this.#style.isConnected) {
      this.#style = document.createElement('style');
      this.#style.setAttribute('data-shirabe', 'highlight');
      // Dokumen halaman dapat membatasi <head>; documentElement selalu ada.
      document.documentElement.append(this.#style);
    }
    // `color: inherit` menjaga warna teks asli halaman; hanya latar yang disorot, dan
    // warnanya mengikuti aksen palet tema aktif (nilai mentah palet, termasuk oklch).
    const palette = this.#palette;
    if (palette === null) {
      return;
    }
    const mix = this.#contrast ? HIGHLIGHT_MIX_CONTRAST : HIGHLIGHT_MIX;
    this.#style.textContent =
      `::highlight(${HIGHLIGHT_NAME}) { color: inherit;` +
      ` background-color: color-mix(in srgb, ${palette.primary} ${mix}%, transparent); }`;
  }
}
