/**
 * Cache data URL gambar kamus untuk definisi berstruktur (tag `img`).
 *
 * Byte gambar tidak pernah diambil dari URL dataset: jalur media dikirim ke service
 * worker lewat pesan `GET_MEDIA`, dan balasannya (data URL) disimpan di sini supaya
 * popup yang dibuka-tutup tidak meminta berkas yang sama berulang kali. Cache dibatasi
 * jumlahnya agar memori popup tetap ringan.
 */

import { buildMessage, isResponseEnvelope, type ResponseData } from '../messaging/protocol.js';

/** Data URL terakhir yang disimpan; entri paling lama dibuang lebih dahulu. */
const MAX_CACHED_IMAGES = 48;

/** Data URL terakhir yang disimpan per kamus + jalur; entri paling lama dibuang dulu. */
const cache = new Map<string, string>();

/** Kosongkan cache: dipanggil saat popup ditutup atau daftar hasil diganti. */
export function resetMediaCache(): void {
  cache.clear();
}

function remember(key: string, dataUrl: string): void {
  cache.set(key, dataUrl);
  while (cache.size > MAX_CACHED_IMAGES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    cache.delete(oldest);
  }
}

/**
 * Tampilkan gambar kamus pada `image`: dari cache bila ada, kalau tidak diminta ke
 * service worker lalu dipasang saat balasannya tiba. Balasan kosong atau gagal membuat
 * gambar dibuang dari DOM supaya tidak tersisa kotak rusak.
 */
export function attachMedia(image: HTMLImageElement, dictionaryId: string, path: string): void {
  const key = `${dictionaryId}\u0000${path}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    image.src = cached;
    return;
  }
  image.dataset['mediaPending'] = '1';
  // Halaman pengujian/halaman tanpa extension: tidak ada sumber gambar untuk diminta.
  if (typeof chrome === 'undefined') {
    return;
  }
  void chrome.runtime
    .sendMessage(buildMessage('GET_MEDIA', { dictionaryId, path }))
    .then((response: unknown) => {
      const dataUrl =
        isResponseEnvelope(response) && response.response.ok
          ? (response.response.data as ResponseData<'GET_MEDIA'>).dataUrl
          : null;
      if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
        image.remove();
        return;
      }
      remember(key, dataUrl);
      delete image.dataset['mediaPending'];
      image.src = dataUrl;
    })
    .catch(() => {
      image.remove();
    });
}
