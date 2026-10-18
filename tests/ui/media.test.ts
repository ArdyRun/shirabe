// @vitest-environment happy-dom
/**
 * Pengujian cache data URL gambar kamus (`src/ui/media.ts`).
 *
 * Dua hal yang dijaga: `src` hanya dipasang dari balasan service worker (tidak pernah
 * dari dataset), dan cache dibatasi supaya popup tidak menahan data URL tanpa batas.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { okResponse, type ExtensionMessage } from '../../src/messaging/protocol.js';
import { attachMedia, resetMediaCache } from '../../src/ui/media.js';

const DATA_URL = 'data:image/png;base64,AAAA';

function image(): HTMLImageElement {
  const element = document.createElement('img');
  document.body.append(element);
  return element;
}

/** Balasan service worker palsu yang hanya melayani `GET_MEDIA`. */
function stubRuntime(dataUrl: string | null): Mock {
  const sendMessage = vi.fn((message: ExtensionMessage) => {
    if (message.type !== 'GET_MEDIA') {
      throw new Error(`Tipe pesan tak terduga: ${message.type}`);
    }
    return Promise.resolve(okResponse<'GET_MEDIA'>(message.id, { dataUrl }));
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  return sendMessage;
}

/** Biarkan rantai promise balasan pesan selesai; tanpa timer agar deterministik. */
async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  resetMediaCache();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attachMedia', () => {
  it('menandai gambar tertunda dan tidak memasang src tanpa chrome.runtime', () => {
    vi.stubGlobal('chrome', undefined);
    const target = image();
    attachMedia(target, 'demo', 'gambar/irori.png');
    expect(target.dataset['mediaPending']).toBe('1');
    expect(target.getAttribute('src')).toBeNull();
  });

  it('memasang src dari balasan service worker lalu memakai cache untuk gambar berikutnya', async () => {
    const sendMessage = stubRuntime(DATA_URL);
    const first = image();
    attachMedia(first, 'demo', 'gambar/irori.png');
    await settle();

    expect(first.src).toBe(DATA_URL);
    expect(first.dataset['mediaPending']).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const second = image();
    attachMedia(second, 'demo', 'gambar/irori.png');
    expect(second.src).toBe(DATA_URL);
    // Kamus lain dengan jalur sama bukan berkas yang sama.
    attachMedia(image(), 'lain', 'gambar/irori.png');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('membuang gambar bila media tidak ada atau permintaan gagal', async () => {
    stubRuntime(null);
    const missing = image();
    attachMedia(missing, 'demo', 'hilang.png');
    await settle();
    expect(missing.isConnected).toBe(false);

    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn(() => Promise.reject(new Error('konteks mati'))) },
    });
    const failed = image();
    attachMedia(failed, 'demo', 'gagal.png');
    await settle();
    expect(failed.isConnected).toBe(false);
  });

  it('meminta ulang setelah cache dikosongkan', async () => {
    const sendMessage = stubRuntime(DATA_URL);
    attachMedia(image(), 'demo', 'a.png');
    await settle();
    resetMediaCache();
    attachMedia(image(), 'demo', 'a.png');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('membatasi jumlah data URL yang disimpan', async () => {
    const sendMessage = stubRuntime(DATA_URL);
    for (let index = 0; index < 49; index += 1) {
      attachMedia(image(), 'demo', `berkas-${index}.png`);
    }
    await settle();
    expect(sendMessage).toHaveBeenCalledTimes(49);

    // Entri paling lama sudah dibuang, entri berikutnya masih tersimpan.
    attachMedia(image(), 'demo', 'berkas-0.png');
    expect(sendMessage).toHaveBeenCalledTimes(50);
    attachMedia(image(), 'demo', 'berkas-1.png');
    expect(sendMessage).toHaveBeenCalledTimes(50);
  });
});
