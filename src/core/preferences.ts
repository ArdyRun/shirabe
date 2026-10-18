/**
 * Preferensi pengguna (PRD 9.3).
 *
 * Preferensi kecil disimpan di `chrome.storage.local` supaya dapat dibaca dari
 * semua execution context (content script, service worker, halaman extension)
 * tanpa membuka IndexedDB, dan tetap tersedia setelah browser dimulai ulang.
 * Data kamus besar tetap berada di IndexedDB (PRD 6.1).
 */

import { DEFAULT_THEME_PREFERENCE, normaliseThemePreference } from './themes.js';

/** Kunci tunggal penyimpanan preferensi di `chrome.storage.local`. */
export const SETTINGS_STORAGE_KEY = 'preferences';

export type UiLanguage = 'id' | 'en';
/**
 * Preferensi tema: `auto` (ikut tema sistem) atau id tema dari katalog
 * (`src/core/themes.ts`). Nilai lama `system`/`light`/`dark` tetap diterima dan
 * dinormalisasi saat preferensi dibaca.
 */
export type ThemePreference = string;
/** Tombol modifier scan. `Alt` adalah default PRD 4.1. */
export type ScanModifier = 'Alt' | 'Control' | 'Shift' | 'Meta';

/**
 * Penyetelan pemindaian per origin.
 *
 * `enabled: false` berarti origin ini adalah pengecualian (pemindaian dimatikan),
 * sementara origin lain dipindai selama `scanAllSites` aktif.
 */
export interface SitePreference {
  enabled: boolean;
  addedAt: number;
}

export interface Preferences {
  /** Pindai semua situs http/https (default aktif, seperti Yomitan/Hachidori). */
  scanAllSites: boolean;
  uiLanguage: UiLanguage;
  theme: ThemePreference;
  scanModifier: ScanModifier;
  popupWidth: number;
  popupMaxHeight: number;
  popupHideDelayMs: number;
  /** Pencarian kana terhadap reading (PRD 8.2). */
  readingSearch: boolean;
  /** Jumlah maksimum hasil per kueri (PRD 4.2: maksimal 30). */
  maxResults: number;
  sites: Record<string, SitePreference>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  scanAllSites: true,
  uiLanguage: 'id',
  theme: DEFAULT_THEME_PREFERENCE,
  scanModifier: 'Alt',
  popupWidth: 420,
  popupMaxHeight: 420,
  popupHideDelayMs: 250,
  readingSearch: true,
  maxResults: 30,
  sites: {},
};

export const SCAN_MODIFIERS: readonly ScanModifier[] = ['Alt', 'Control', 'Shift', 'Meta'];
export const UI_LANGUAGES: readonly UiLanguage[] = ['id', 'en'];
export const POPUP_WIDTH_RANGE = { min: 280, max: 720 } as const;
export const POPUP_MAX_HEIGHT_RANGE = { min: 200, max: 900 } as const;
export const POPUP_HIDE_DELAY_RANGE = { min: 0, max: 2000 } as const;
export const MAX_RESULTS_RANGE = { min: 5, max: 30 } as const;

/** Kunci preferensi yang boleh disetel lewat pesan `SETTINGS_SET`. */
export const PREFERENCE_KEYS = [
  'scanAllSites',
  'uiLanguage',
  'theme',
  'scanModifier',
  'popupWidth',
  'popupMaxHeight',
  'popupHideDelayMs',
  'readingSearch',
  'maxResults',
] as const;

export type WritablePreferenceKey = (typeof PREFERENCE_KEYS)[number];

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function asString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function sanitizeSites(value: unknown): Record<string, SitePreference> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const sites: Record<string, SitePreference> = {};
  for (const [origin, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof origin !== 'string' || !/^https?:\/\/[^/\s]+$/.test(origin)) {
      continue;
    }
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const candidate = raw as Partial<SitePreference>;
    sites[origin] = {
      enabled: candidate.enabled === true,
      addedAt: typeof candidate.addedAt === 'number' ? candidate.addedAt : 0,
    };
  }
  return sites;
}

/**
 * Validasi + normalisasi preferensi yang datang dari storage atau pesan.
 * Nilai yang tidak dikenal dibuang, bukan disimpan mentah.
 */
export function sanitizePreferences(value: unknown): Preferences {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    scanAllSites: raw['scanAllSites'] !== false,
    uiLanguage: asString<UiLanguage>(raw['uiLanguage'], UI_LANGUAGES, DEFAULT_PREFERENCES.uiLanguage),
    theme: normaliseThemePreference(raw['theme']),
    scanModifier: asString<ScanModifier>(
      raw['scanModifier'],
      SCAN_MODIFIERS,
      DEFAULT_PREFERENCES.scanModifier,
    ),
    popupWidth: clampNumber(
      raw['popupWidth'],
      DEFAULT_PREFERENCES.popupWidth,
      POPUP_WIDTH_RANGE.min,
      POPUP_WIDTH_RANGE.max,
    ),
    popupMaxHeight: clampNumber(
      raw['popupMaxHeight'],
      DEFAULT_PREFERENCES.popupMaxHeight,
      POPUP_MAX_HEIGHT_RANGE.min,
      POPUP_MAX_HEIGHT_RANGE.max,
    ),
    popupHideDelayMs: clampNumber(
      raw['popupHideDelayMs'],
      DEFAULT_PREFERENCES.popupHideDelayMs,
      POPUP_HIDE_DELAY_RANGE.min,
      POPUP_HIDE_DELAY_RANGE.max,
    ),
    readingSearch: raw['readingSearch'] !== false,
    maxResults: clampNumber(
      raw['maxResults'],
      DEFAULT_PREFERENCES.maxResults,
      MAX_RESULTS_RANGE.min,
      MAX_RESULTS_RANGE.max,
    ),
    sites: sanitizeSites(raw['sites']),
  };
}
