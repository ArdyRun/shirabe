/**
 * Invarian berkas token: setiap blok yang mendefinisikan token harus punya selektor yang
 * juga cocok di dalam shadow DOM.
 *
 * Popup dirender di shadow DOM tertutup, dan `:root` **tidak cocok** di dalam shadow tree.
 * Tema diterapkan sebagai atribut `data-theme` pada `html` (halaman extension) atau pada
 * `.panel` (popup). Tanpa selektor atribut seperti `[data-theme]`, token tidak terpasang
 * pada panel popup: latar transparan dan warna teks ikut halaman. Regresi itu pernah
 * terjadi (§4.20 audit), jadi diuji di sini.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');

interface CssRule {
  selectors: string[];
  body: string;
}

/** Parse blok gaya sederhana (tanpa nested at-rule) dari sebuah berkas CSS. */
function rules(source: string): CssRule[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, '');
  const found: CssRule[] = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selectors = (match[1] ?? '')
      .split(',')
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0);
    found.push({ selectors, body: match[2] ?? '' });
  }
  return found;
}

const parsed = rules(css);

/** Selektor yang juga cocok pada elemen bertema di dalam shadow DOM popup. */
function matchesInShadowTree(selector: string): boolean {
  return /\[data-theme/u.test(selector) || selector.includes(':host');
}

/** Token yang wajib tersedia di dalam shadow DOM popup. */
const REQUIRED_IN_POPUP = [
  '--bg',
  '--bg-elevated',
  '--surface',
  '--card',
  '--card-hover',
  '--raised',
  '--border',
  '--border-strong',
  '--fg',
  '--muted',
  '--faint',
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--accent-fg',
  '--success',
  '--warning',
  '--danger',
  '--info',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
  '--s1',
  '--s6',
  '--r-sm',
  '--r-pill',
  '--fs-headword',
  '--fs-gloss',
  '--fs-body',
  '--fs-label',
  '--fs-tiny',
  '--lh-gloss',
];

function definedIn(selectorPredicate: (selector: string) => boolean): Set<string> {
  const names = new Set<string>();
  for (const rule of parsed) {
    if (!rule.selectors.some(selectorPredicate)) {
      continue;
    }
    for (const match of rule.body.matchAll(/(--[a-z0-9-]+)\s*:/gu)) {
      names.add(match[1] ?? '');
    }
  }
  return names;
}

describe('invarian token CSS', () => {
  it('tidak ada blok token yang hanya memakai selektor :root', () => {
    const offenders = parsed
      .filter((rule) => /--[a-z0-9-]+\s*:/u.test(rule.body))
      .filter((rule) => rule.selectors.every((selector) => !matchesInShadowTree(selector)))
      .map((rule) => rule.selectors.join(', '));
    expect(offenders).toEqual([]);
  });

  it('palet mentah tersedia lewat selektor atribut untuk kedua skema', () => {
    for (const scheme of ['light', 'dark']) {
      const selectors = parsed
        .filter((rule) => /--pal-base-100\s*:/u.test(rule.body))
        .flatMap((rule) => rule.selectors)
        .filter((selector) => selector.includes(`data-theme='${scheme}'`));
      expect(selectors.length, `palet ${scheme}`).toBeGreaterThan(0);
      const palette = definedIn((selector) => selector.includes(`data-theme='${scheme}'`));
      for (const token of ['--pal-scheme', '--pal-base-100', '--pal-content', '--pal-primary']) {
        expect(palette.has(token), `${scheme} ${token}`).toBe(true);
      }
    }
  });

  it('seluruh token yang dipakai popup tersedia di dalam shadow DOM', () => {
    const inShadow = definedIn(matchesInShadowTree);
    const missing = REQUIRED_IN_POPUP.filter((token) => !inShadow.has(token));
    expect(missing).toEqual([]);
  });

  it('token semantik diturunkan dari palet, bukan nilai tetap', () => {
    // Bloknya harus berada pada selektor yang cocok di shadow DOM (diuji di atas).
    const semantic = ['--bg', '--fg', '--muted', '--border', '--accent', '--card'];
    for (const token of semantic) {
      const definitions = parsed
        .filter((rule) => new RegExp(`${token}\\s*:`, 'u').test(rule.body))
        .map((rule) => rule.body.match(new RegExp(`${token}\\s*:\\s*([^;]+)`, 'u'))?.[1] ?? '');
      expect(definitions.length, token).toBeGreaterThan(0);
      expect(definitions.every((value) => value.includes('--pal-')), token).toBe(true);
    }
  });
});
