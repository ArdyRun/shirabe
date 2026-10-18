/**
 * Validasi pesan service worker (PRD 6.2, 12.1).
 *
 * Fungsi-fungsi ini murni terhadap objek sender/pesan, sehingga dapat diuji tanpa
 * menjalankan browser.
 */

import { describe, expect, it } from 'vitest';
import {
  MESSAGE_TYPES,
  buildMessage,
  isContentScriptMessageType,
  isExtensionContextInvalidated,
  validateEnvelope,
} from '../../src/messaging/protocol.js';
import { assertSenderAllowed, isContentScriptSender } from '../../src/background/handlers.js';
import type { MessageContext } from '../../src/background/handlers.js';

/** Stub tab minimal untuk pengujian: hanya field yang dipakai klasifikasi sender. */
function fakeTab(id: number, url: string): chrome.tabs.Tab {
  return { id, url } as unknown as chrome.tabs.Tab;
}

function sender(overrides: Partial<chrome.runtime.MessageSender>): chrome.runtime.MessageSender {
  return { id: 'shirabe', ...overrides };
}

function context(overrides: Partial<MessageContext>): MessageContext {
  return {
    sender: sender({}),
    isContentScript: false,
    tabOrigin: null,
    ...overrides,
  };
}

describe('isContentScriptSender', () => {
  it('mengenali content script pada halaman web', () => {
    expect(
      isContentScriptSender(
        sender({ tab: fakeTab(1, 'https://example.com'), url: 'https://example.com/halaman' }),
      ),
    ).toBe(true);
  });

  it('tidak menganggap pesan dari service worker sebagai content script', () => {
    expect(isContentScriptSender(sender({}))).toBe(false);
  });

  it('tidak menganggap halaman extension yang dibuka di tab sebagai content script', () => {
    expect(
      isContentScriptSender(
        sender({
          tab: fakeTab(2, 'chrome-extension://abc/settings.html'),
          url: 'chrome-extension://abc/settings.html',
        }),
      ),
    ).toBe(false);
  });
});

describe('assertSenderAllowed', () => {
  it('mengizinkan LOOKUP dari frame utama content script', () => {
    expect(() =>
      assertSenderAllowed('LOOKUP', context({ isContentScript: true, sender: sender({ frameId: 0 }) })),
    ).not.toThrow();
  });

  it('menolak operasi pengelolaan kamus dari content script', () => {
    expect(() =>
      assertSenderAllowed(
        'DICTIONARY_DELETE',
        context({ isContentScript: true, sender: sender({ frameId: 0 }) }),
      ),
    ).toThrowError(/tidak boleh/i);
  });

  it('mengizinkan lookup dari iframe web yang memiliki content script statis', () => {
    expect(() =>
      assertSenderAllowed('LOOKUP', context({ isContentScript: true, sender: sender({ frameId: 4 }) })),
    ).not.toThrow();
  });

  it('mengizinkan seluruh tipe pesan dari halaman extension', () => {
    expect(() => assertSenderAllowed('DICTIONARY_DELETE', context({}))).not.toThrow();
  });
});

describe('validateEnvelope', () => {
  it('menerima pesan yang dibangun oleh helper', () => {
    const message = buildMessage('PING', {});
    expect(validateEnvelope(message).ok).toBe(true);
  });

  it('menolak versi skema pesan yang tidak didukung', () => {
    const result = validateEnvelope({ v: 99, id: 'x', type: 'PING', payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_MESSAGE');
    }
  });

  it('menolak tipe pesan yang tidak dikenal', () => {
    const result = validateEnvelope({ v: 1, id: 'x', type: 'HAPUS_SEMUA', payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNKNOWN_TYPE');
    }
  });

  it('menolak payload yang bukan objek', () => {
    const result = validateEnvelope({ v: 1, id: 'x', type: 'PING', payload: '<html>' });
    expect(result.ok).toBe(false);
  });

  it('menolak pesan yang terlalu besar', () => {
    const result = validateEnvelope({
      v: 1,
      id: 'x',
      type: 'PING',
      payload: { data: 'a'.repeat(5 * 1024 * 1024) },
    });
    expect(result.ok).toBe(false);
  });

  it('membatasi content script pada pesan lookup dan permintaan gambar kamus', () => {
    // Content script hanya boleh meminta hasil lookup dan byte gambar milik kamus;
    // pengelolaan kamus, impor, dan preferensi hanya dari halaman extension.
    const allowed = new Set(['LOOKUP', 'GET_MEDIA']);
    for (const type of MESSAGE_TYPES) {
      expect(isContentScriptMessageType(type), type).toBe(allowed.has(type));
    }
  });
});

describe('isExtensionContextInvalidated', () => {
  it('mengenali halaman lama setelah extension dimuat ulang', () => {
    expect(isExtensionContextInvalidated(new Error('Extension context invalidated.'))).toBe(true);
  });

  it('mengenali service worker yang tidak menerima pesan', () => {
    expect(
      isExtensionContextInvalidated(
        new Error('Could not establish connection. Receiving end does not exist.'),
      ),
    ).toBe(true);
  });

  it('tidak menandai kesalahan lain sebagai konteks yang mati', () => {
    expect(isExtensionContextInvalidated(new Error('Quota exceeded'))).toBe(false);
    expect(isExtensionContextInvalidated('bukan error')).toBe(false);
  });
});
