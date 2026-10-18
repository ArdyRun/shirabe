/**
 * Penerapan tema pada elemen target (PRD 3.1, 5.4).
 *
 * Mengikuti pola Hachidori/GSM: preferensi tema (`auto` = ikut sistem, atau id tema dari
 * katalog `src/core/themes.ts`) diselesaikan menjadi satu palet, lalu palet itu dipasang
 * sebagai variabel CSS `--pal-*` **inline** pada elemen target. Atribut `data-theme`
 * menyimpan skema (`light`/`dark`, dipakai CSS bawaan) dan `data-theme-name` menyimpan
 * id tema (untuk diagnostik dan pengujian).
 *
 * Karena palet punya nilai bawaan di `tokens.css`, tampilan sudah benar sebelum
 * JavaScript berjalan; atribut `data-theme-pending` menyembunyikan antarmuka selama
 * pembacaan preferensi supaya tidak berkedip (pola referensi).
 */

import {
  AUTO_THEME_ID,
  PALETTE_VARIABLES,
  paletteFor,
  resolveThemeId,
  type ThemePalette,
} from '../core/themes.js';
import type { ThemePreference } from '../core/preferences.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Tema mengikuti sistem; `system` adalah nilai lama yang tetap diterima. */
function followsSystem(preference: ThemePreference): boolean {
  return preference === AUTO_THEME_ID || preference === 'system';
}

/** Pasang palet + atribut skema pada elemen target. */
export function applyPalette(target: HTMLElement, palette: ThemePalette, id: string): void {
  for (const [key, variable] of PALETTE_VARIABLES) {
    target.style.setProperty(variable, palette[key]);
  }
  target.dataset['theme'] = palette.scheme;
  target.dataset['themeName'] = id;
}

/** Tema konkret (id + palet) untuk sebuah preferensi dan preferensi sistem saat ini. */
export function themeFor(
  preference: ThemePreference,
  prefersDark: boolean,
): { id: string; palette: ThemePalette } {
  return { id: resolveThemeId(preference, prefersDark), palette: paletteFor(preference, prefersDark) };
}

export function applyTheme(preference: ThemePreference, target?: HTMLElement): void {
  const root = target ?? document.documentElement;
  const media = window.matchMedia(DARK_QUERY);
  const { id, palette } = themeFor(preference, media.matches);
  applyPalette(root, palette, id);
}

/** Terapkan tema dan ikuti perubahan tema sistem selama elemen masih terpasang. */
export function applyThemeWithListener(
  preference: ThemePreference,
  target?: HTMLElement,
): () => void {
  const root = target ?? document.documentElement;
  const media = window.matchMedia(DARK_QUERY);
  const update = (): void => {
    const { id, palette } = themeFor(preference, media.matches);
    applyPalette(root, palette, id);
  };
  update();
  if (!followsSystem(preference)) {
    return () => undefined;
  }
  media.addEventListener('change', update);
  return () => {
    media.removeEventListener('change', update);
  };
}

/** Sembunyikan antarmuka selama tema tersimpan belum dibaca (tidak berkedip). */
export function markThemePending(target?: HTMLElement): void {
  (target ?? document.documentElement).dataset['themePending'] = '';
}

/** Tampilkan kembali antarmuka setelah tema diterapkan atau pembacaan gagal. */
export function clearThemePending(target?: HTMLElement): void {
  delete (target ?? document.documentElement).dataset['themePending'];
}
