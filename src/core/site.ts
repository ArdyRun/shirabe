/**
 * Helper origin / match pattern.
 *
 * Pemindaian berjalan di semua origin http/https lewat content script statis
 * (model Yomitan/Hachidori), jadi helper di sini hanya dipakai untuk memetakan URL
 * halaman ke origin dan untuk query tab pada origin tertentu.
 */

/** Origin dari URL halaman, atau `null` bila URL tidak dapat dipindai. */
export function originFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  return parsed.origin;
}

/** Match pattern yang hanya mencakup satu origin. */
export function originToMatchPattern(origin: string): string {
  return `${origin}/*`;
}

/** Benar bila halaman boleh dipindai (http/https, bukan halaman browser internal). */
export function isScannableUrl(url: string | undefined): boolean {
  return originFromUrl(url) !== null;
}
