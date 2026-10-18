import { describe, expect, it } from 'vitest';
import {
  AUTO_THEME_ID,
  AUTO_THEME_IDS,
  DEFAULT_THEME_PREFERENCE,
  PALETTE_VARIABLES,
  THEME_GROUPS,
  THEME_OPTIONS,
  normaliseThemePreference,
  paletteFor,
  resolveThemeId,
  themeOption,
  themesInGroup,
  type ThemePalette,
} from '../../src/core/themes.js';

const PALETTE_KEYS: readonly (keyof ThemePalette)[] = [
  'scheme',
  'base100',
  'base200',
  'base300',
  'content',
  'primary',
  'primaryContent',
  'secondary',
  'secondaryContent',
  'accent',
  'accentContent',
  'neutral',
  'neutralContent',
  'info',
  'infoContent',
  'success',
  'warning',
  'error',
];

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** Luminans relatif WCAG. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Campuran `color-mix(in srgb, A p%, B)` seperti blok token di `tokens.css`. */
function mixHex(first: string, second: string, portion: number): string {
  const [a, b] = [channels(first), channels(second)];
  const mixed = a.map((value, index) => value * portion + (b[index] as number) * (1 - portion));
  return `#${mixed.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

describe('katalog tema', () => {
  it('memuat tema katalog Hachidori dan tema Shirabe dengan id unik', () => {
    const ids = THEME_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(AUTO_THEME_ID);
    // Katalog referensi yang dipakai Hachidori ikut tersedia.
    for (const id of ['default', 'miku', 'catppuccin-mocha', 'dracula', 'autumn', 'high-contrast']) {
      expect(ids).toContain(id);
    }
    expect(THEME_OPTIONS.length).toBeGreaterThan(40);
  });

  it('hanya tema auto yang tidak punya palet, tema lain lengkap', () => {
    for (const option of THEME_OPTIONS) {
      if (option.id === AUTO_THEME_ID) {
        expect(option.palette).toBeUndefined();
        continue;
      }
      expect(option.palette, option.id).toBeDefined();
      for (const key of PALETTE_KEYS) {
        const value = option.palette?.[key];
        expect(typeof value, `${option.id}.${key}`).toBe('string');
        expect(String(value).length, `${option.id}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('setiap tema punya label (nama katalog atau kunci i18n)', () => {
    for (const option of THEME_OPTIONS) {
      expect(option.label !== undefined || option.labelKey !== undefined, option.id).toBe(true);
    }
  });

  it('mengelompokkan tema sesuai daftar grup', () => {
    const groupIds = THEME_GROUPS.map((group) => group.id);
    expect(groupIds).toEqual(['auto', 'dark', 'light', 'contrast']);
    for (const group of THEME_GROUPS) {
      for (const option of themesInGroup(group.id)) {
        expect(option.group).toBe(group.id);
      }
    }
    const total = THEME_GROUPS.reduce((sum, group) => sum + themesInGroup(group.id).length, 0);
    expect(total).toBe(THEME_OPTIONS.length);
  });

  it('memetakan setiap kunci palet ke variabel CSS', () => {
    expect(PALETTE_VARIABLES.map(([key]) => key).sort()).toEqual([...PALETTE_KEYS].sort());
    for (const [, variable] of PALETTE_VARIABLES) {
      expect(variable.startsWith('--pal-')).toBe(true);
    }
  });
});

describe('penyelesaian preferensi tema', () => {
  it('mengikuti tema sistem saat preferensi auto', () => {
    expect(resolveThemeId(AUTO_THEME_ID, true)).toBe(AUTO_THEME_IDS.dark);
    expect(resolveThemeId(AUTO_THEME_ID, false)).toBe(AUTO_THEME_IDS.light);
    expect(DEFAULT_THEME_PREFERENCE).toBe('dark');
  });

  it('mempertahankan tampilan untuk preferensi lama', () => {
    expect(resolveThemeId('system', true)).toBe(AUTO_THEME_IDS.dark);
    expect(resolveThemeId('dark', false)).toBe(AUTO_THEME_IDS.dark);
    expect(resolveThemeId('light', true)).toBe(AUTO_THEME_IDS.light);
  });

  it('meneruskan id tema katalog', () => {
    expect(resolveThemeId('miku', false)).toBe('miku');
    expect(paletteFor('miku', false).scheme).toBe('dark');
    expect(paletteFor('autumn', true).scheme).toBe('light');
  });

  it('selalu menghasilkan palet, juga untuk preferensi tak dikenal', () => {
    for (const preference of [AUTO_THEME_ID, 'system', 'light', 'dark', 'neon', '']) {
      const palette = paletteFor(preference, true);
      expect(palette.base100.length).toBeGreaterThan(0);
      // Palet yang dipakai harus palet tema yang benar-benar diselesaikan.
      expect(palette).toEqual(paletteFor(resolveThemeId(preference, true), true));
    }
  });

  it('menormalisasi preferensi tersimpan', () => {
    expect(normaliseThemePreference('system')).toBe(AUTO_THEME_ID);
    expect(normaliseThemePreference('miku')).toBe('miku');
    expect(normaliseThemePreference('dark')).toBe('dark');
    expect(normaliseThemePreference('neon')).toBe(DEFAULT_THEME_PREFERENCE);
    expect(normaliseThemePreference(42)).toBe(DEFAULT_THEME_PREFERENCE);
    expect(themeOption('miku')?.label).toBe('Miku');
  });

  it('palet Shirabe tetap memenuhi kontras teks WCAG AA', () => {
    for (const id of [AUTO_THEME_IDS.dark, AUTO_THEME_IDS.light]) {
      const palette = themeOption(id)?.palette;
      expect(palette).toBeDefined();
      if (palette === undefined) {
        continue;
      }
      expect(palette.base100.startsWith('#'), id).toBe(true);
      expect(contrast(palette.content, palette.base100), `${id} teks/base-100`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.content, palette.base200), `${id} teks/base-200`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * Tema pembaca monokrom memakai `content` yang lebih pekat supaya token turunan
   * `tokens.css` (teks redup 76%, samar 56%) tetap lolos AA, karena rasio 56% inilah yang
   * paling rawan jatuh di bawah 4.5:1 pada palet terang.
   */
  it('tema pembaca monokrom memenuhi kontras token turunan WCAG AA', () => {
    for (const id of ['ereader-light', 'ereader-dark']) {
      const palette = themeOption(id)?.palette;
      expect(palette, id).toBeDefined();
      if (palette === undefined) {
        continue;
      }
      const surfaces: Record<string, string> = {
        'base-100': palette.base100,
        kartu: mixHex(palette.base100, palette.base200, 0.72),
        'bg-elevated': mixHex(palette.base100, palette.base300, 0.88),
      };
      for (const [surfaceName, surface] of Object.entries(surfaces)) {
        for (const [token, portion] of [['muted', 0.76], ['faint', 0.56]] as const) {
          const text = mixHex(palette.content, palette.base100, portion);
          expect(contrast(text, surface), `${id} ${token} @${surfaceName}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(palette.primaryContent, palette.primary), `${id} tab aktif`).toBeGreaterThanOrEqual(4.5);
      for (const key of ['info', 'success', 'warning', 'error'] as const) {
        expect(contrast(palette[key], surfaces['kartu'] ?? ''), `${id} ${key}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
