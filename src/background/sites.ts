/**
 * Status pemindaian situs.
 *
 * Model izin mengikuti Yomitan/Hachidori: content script didaftarkan **statis di manifest**
 * untuk semua origin http dan https, sehingga pemindaian langsung bekerja di semua situs
 * begitu extension aktif. Pengguna mengendalikan pemindaian lewat:
 * - `scanAllSites` (default aktif) untuk mematikan pemindaian di semua situs sekaligus, dan
 * - daftar pengecualian per origin (`sites[origin].enabled === false`).
 *
 * Karena tidak ada lagi izin host opsional, tidak ada permintaan izin, pendaftaran content
 * script dinamis, maupun injeksi ke tab yang sudah terbuka: halaman baru otomatis
 * mendapat content script dari manifest.
 */

import { originFromUrl, originToMatchPattern } from '../core/site.js';
import { ProtocolError } from '../messaging/protocol.js';
import { getPreferences, updateSitePreference } from './settings.js';

function assertOrigin(origin: string): string {
  if (originFromUrl(`${origin}/`) !== origin) {
    throw new ProtocolError('INVALID_PAYLOAD', 'Origin situs tidak valid.');
  }
  return origin;
}

/** Aktifkan pemindaian pada sebuah origin (hapus dari daftar pengecualian). */
export async function enableSiteScan(origin: string): Promise<void> {
  await updateSitePreference(assertOrigin(origin), true);
}

/** Nonaktifkan pemindaian pada sebuah origin (tambahkan ke daftar pengecualian). */
export async function disableSiteScan(origin: string): Promise<void> {
  await updateSitePreference(assertOrigin(origin), false);
}

/** Origin yang pemindaiannya dimatikan secara eksplisit. */
export async function listDisabledOrigins(): Promise<string[]> {
  const preferences = await getPreferences();
  return Object.entries(preferences.sites)
    .filter(([, site]) => !site.enabled)
    .map(([origin]) => origin)
    .sort();
}

/** Tab yang sedang terbuka pada sebuah origin (dipakai untuk aksi menu konteks). */
export async function tabsForOrigin(origin: string): Promise<chrome.tabs.Tab[]> {
  return chrome.tabs.query({ url: originToMatchPattern(origin) });
}
