/**
 * Penyimpanan preferensi: satu objek `preferences` di `chrome.storage.local`
 * (PRD 9.3). Semua tulisan melewati `sanitizePreferences`, sehingga nilai asing
 * atau rusak tidak pernah masuk ke storage.
 */

import {
  DEFAULT_PREFERENCES,
  SETTINGS_STORAGE_KEY,
  sanitizePreferences,
  type Preferences,
} from '../core/preferences.js';

async function readRaw(): Promise<unknown> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  return stored[SETTINGS_STORAGE_KEY];
}

export async function getPreferences(): Promise<Preferences> {
  try {
    return sanitizePreferences(await readRaw());
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Terapkan perubahan preferensi yang diizinkan dan simpan hasil yang sudah divalidasi. */
export async function updatePreferences(changes: Record<string, unknown>): Promise<Preferences> {
  const current = await getPreferences();
  const next = sanitizePreferences({ ...current, ...changes });
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}

/**
 * Ubah preferensi situs (dipakai saat pemindaian di sebuah situs dinyalakan/dimatikan).
 *
 * Default Shirabe adalah memindai semua situs, jadi mematikan sebuah situs selalu menulis
 * entri pengecualian `enabled: false` — termasuk untuk origin yang belum pernah tercatat.
 */
export async function updateSitePreference(
  origin: string,
  enabled: boolean,
): Promise<Preferences> {
  const current = await getPreferences();
  const sites = { ...current.sites };
  sites[origin] = { enabled, addedAt: sites[origin]?.addedAt ?? Date.now() };
  const next = sanitizePreferences({ ...current, sites });
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}
