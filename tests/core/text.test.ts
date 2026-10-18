import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  POPUP_WIDTH_RANGE,
  sanitizePreferences,
} from '../../src/core/preferences.js';
import {
  isScannableUrl,
  originFromUrl,
  originToMatchPattern,
} from '../../src/core/site.js';
import {
  codePointLength,
  isJapaneseCodePoint,
  isKanaOnly,
  isWordCodePoint,
  normalizeQuery,
  sliceCodePoints,
  toCodePoints,
} from '../../src/core/text.js';

describe('sanitizePreferences', () => {
  it('memakai default untuk storage kosong', () => {
    expect(sanitizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences({})).toEqual(DEFAULT_PREFERENCES);
  });

  it('menjepit angka pada rentang yang diizinkan', () => {
    const result = sanitizePreferences({ popupWidth: 10_000, maxResults: 1_000 });
    expect(result.popupWidth).toBe(POPUP_WIDTH_RANGE.max);
    expect(result.maxResults).toBe(30);
  });

  it('memindai semua situs secara default dan hanya mematikan bila eksplisit false', () => {
    expect(sanitizePreferences({}).scanAllSites).toBe(true);
    expect(sanitizePreferences({ scanAllSites: 'ya' }).scanAllSites).toBe(true);
    expect(sanitizePreferences({ scanAllSites: false }).scanAllSites).toBe(false);
  });

  it('membuang nilai enum yang tidak dikenal', () => {
    const result = sanitizePreferences({ theme: 'neon', scanModifier: 'Hyper', uiLanguage: 'jp' });
    // Tema default adalah gelap (tema utama desain); nilai tak dikenal kembali ke default.
    expect(result.theme).toBe('dark');
    expect(result.scanModifier).toBe('Alt');
    expect(result.uiLanguage).toBe('id');
  });

  it('membuang preferensi situs yang tidak valid', () => {
    const result = sanitizePreferences({
      sites: {
        'https://example.com': { enabled: true, addedAt: 5 },
        'chrome://settings': { enabled: true, addedAt: 1 },
        'https://lain.test': 'bukan objek',
      },
    });
    expect(Object.keys(result.sites)).toEqual(['https://example.com']);
    expect(result.sites['https://example.com']?.enabled).toBe(true);
  });
});

describe('site helper', () => {
  it('mengambil origin hanya untuk http/https', () => {
    expect(originFromUrl('https://example.com/halaman?x=1')).toBe('https://example.com');
    expect(originFromUrl('http://localhost:8080/')).toBe('http://localhost:8080');
    expect(originFromUrl('chrome://settings')).toBeNull();
    expect(originFromUrl('file:///tmp/a.html')).toBeNull();
    expect(originFromUrl(undefined)).toBeNull();
    expect(originFromUrl('bukan url')).toBeNull();
  });

  it('membuat match pattern per origin', () => {
    expect(originToMatchPattern('https://example.com')).toBe('https://example.com/*');
  });

  it('menandai halaman yang boleh dipindai', () => {
    expect(isScannableUrl('https://example.com')).toBe(true);
    expect(isScannableUrl('chrome-extension://abc/action.html')).toBe(false);
  });
});

describe('text helper', () => {
  it('menghitung dan memotong berdasarkan code point', () => {
    const text = 'a\u{20000}い';
    expect(codePointLength(text)).toBe(3);
    expect(toCodePoints(text)).toHaveLength(3);
    expect(sliceCodePoints(text, 0, 2)).toBe('a\u{20000}');
    expect(sliceCodePoints(text, 1)).toBe('\u{20000}い');
  });

  it('mengenali karakter Jepang dan kana', () => {
    expect(isJapaneseCodePoint('漢')).toBe(true);
    expect(isJapaneseCodePoint('あ')).toBe(true);
    expect(isJapaneseCodePoint('ア')).toBe(true);
    expect(isJapaneseCodePoint('々')).toBe(true);
    expect(isJapaneseCodePoint('A')).toBe(false);
    expect(isKanaOnly('たべるー')).toBe(true);
    expect(isKanaOnly('食べる')).toBe(false);
    expect(isKanaOnly('')).toBe(false);
  });

  it('memisahkan karakter kata dari tanda baca', () => {
    expect(isWordCodePoint('食')).toBe(true);
    expect(isWordCodePoint('ー')).toBe(true);
    expect(isWordCodePoint('a')).toBe(true);
    expect(isWordCodePoint('3')).toBe(true);
    expect(isWordCodePoint('。')).toBe(false);
    expect(isWordCodePoint(' ')).toBe(false);
  });

  it('menormalisasi ke NFC', () => {
    const decomposed = 'がくせい'.normalize('NFD');
    expect(normalizeQuery(decomposed)).toBe('がくせい');
  });
});
