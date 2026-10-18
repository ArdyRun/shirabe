// @vitest-environment happy-dom
/**
 * Penerapan tema pada elemen target: variabel palet inline, atribut skema, mengikuti
 * tema sistem saat preferensi `auto`, dan atribut penahan anti-kedip.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_THEME_IDS, themeOption } from '../../src/core/themes.js';
import {
  applyTheme,
  applyThemeWithListener,
  clearThemePending,
  markThemePending,
  themeFor,
} from '../../src/ui/theme.js';

let dark = true;
const listeners = new Set<() => void>();

function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    media: query,
    // Getter supaya nilai mengikuti perubahan, seperti MediaQueryList asli.
    get matches(): boolean {
      return query.includes('dark') ? dark : false;
    },
    onchange: null,
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'change') {
        listeners.add(listener);
      }
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  dark = true;
  listeners.clear();
  stubMatchMedia();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-name');
  document.documentElement.removeAttribute('data-theme-pending');
  document.documentElement.removeAttribute('style');
});

describe('applyTheme', () => {
  it('memasang palet tema terpilih sebagai variabel inline dan atribut skema', () => {
    applyTheme('miku');
    const root = document.documentElement;
    const palette = themeOption('miku')?.palette;
    expect(palette).toBeDefined();
    expect(root.dataset['theme']).toBe('dark');
    expect(root.dataset['themeName']).toBe('miku');
    expect(root.style.getPropertyValue('--pal-primary')).toBe(palette?.primary);
    expect(root.style.getPropertyValue('--pal-base-100')).toBe(palette?.base100);
    expect(root.style.getPropertyValue('--pal-scheme')).toBe('dark');
  });

  it('mengikuti tema sistem saat preferensi auto dan saat tema sistem berubah', () => {
    const dispose = applyThemeWithListener('auto');
    expect(document.documentElement.dataset['themeName']).toBe(AUTO_THEME_IDS.dark);
    expect(document.documentElement.dataset['theme']).toBe('dark');

    dark = false;
    for (const listener of listeners) {
      listener();
    }
    expect(document.documentElement.dataset['themeName']).toBe(AUTO_THEME_IDS.light);
    expect(document.documentElement.dataset['theme']).toBe('light');

    dispose();
    expect(listeners.size).toBe(0);
  });

  it('tidak memasang pendengar saat tema dipilih eksplisit', () => {
    const dispose = applyThemeWithListener('autumn');
    expect(document.documentElement.dataset['themeName']).toBe('autumn');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(listeners.size).toBe(0);
    dispose();
  });

  it('menerima preferensi lama tanpa mengubah tampilan', () => {
    applyTheme('light');
    expect(document.documentElement.dataset['themeName']).toBe(AUTO_THEME_IDS.light);
    applyTheme('system');
    expect(document.documentElement.dataset['themeName']).toBe(AUTO_THEME_IDS.dark);
  });

  it('menghitung tema konkret tanpa menyentuh DOM', () => {
    expect(themeFor('auto', true)).toEqual({
      id: AUTO_THEME_IDS.dark,
      palette: themeOption(AUTO_THEME_IDS.dark)?.palette,
    });
  });
});

describe('atribut penahan anti-kedip', () => {
  it('menandai dan melepas atribut pada elemen target', () => {
    const element = document.createElement('div');
    markThemePending(element);
    expect(element.hasAttribute('data-theme-pending')).toBe(true);
    clearThemePending(element);
    expect(element.hasAttribute('data-theme-pending')).toBe(false);
  });
});

describe('stub matchMedia dipakai oleh applyTheme', () => {
  it('applyTheme memakai nilai matchMedia saat ini', () => {
    dark = false;
    applyTheme('auto');
    expect(document.documentElement.dataset['theme']).toBe('light');
    vi.restoreAllMocks();
  });
});
