/**
 * Renderer *structured content* (schema v2) untuk definisi kamus.
 *
 * Kontrak keamanan (PRD 4.3, 10, 13):
 * - Tidak ada `innerHTML`. Seluruh teks masuk sebagai text node.
 * - Tag dibuat hanya bila ada di daftar putih `ALLOWED_STRUCTURED_TAGS`; tag lain
 *   dirender sebagai teks isinya (dan tag media/script dibuang bersama isinya).
 * - Properti `style` disaring lagi di sini lewat `structuredStyleEntries`, jadi data
 *   lama atau yang dimodifikasi manual tidak dapat menyuntikkan CSS sembarang.
 * - Tidak ada elemen yang memuat jaringan (`img`, `iframe`, `link`, `a` dengan href).
 *
 * Dibungkus oleh `glosses__item`/`definitions__item` di `results.ts`, sehingga tabel
 * tampil di dalam satu sense persis seperti Hachidori (`gloss-sc-table-container`).
 */

import {
  ALLOWED_STRUCTURED_TAGS,
  IGNORED_STRUCTURED_TAGS,
  isStructuredNode,
  structuredStyleEntries,
  structuredText,
  type DefinitionItem,
  type StructuredContent,
  type StructuredNode,
} from '../core/structured.js';
import { el } from './dom.js';
import { attachMedia } from './media.js';

const MAX_SPAN = 32;
/** Satuan bawaan ukuran gambar bila simpul tidak menyebutkannya. */
const DEFAULT_SIZE_UNITS = 'em';

function appendContent(
  parent: Element,
  content: StructuredContent | undefined,
  dictionaryId: string | undefined,
): void {
  if (content === undefined) {
    return;
  }
  if (typeof content === 'string') {
    parent.append(document.createTextNode(content));
    return;
  }
  if (Array.isArray(content)) {
    for (const child of content as readonly StructuredContent[]) {
      appendContent(parent, child, dictionaryId);
    }
    return;
  }
  parent.append(buildNode(content as StructuredNode, dictionaryId));
}

/**
 * Gambar kamus: atribut tampil diterjemahkan menjadi gaya, lalu byte-nya diminta ke
 * store `media` kamus pemilik (`attachMedia`). `src` tidak pernah berasal dari dataset,
 * dan simpul tanpa jalur media tidak menjadi elemen sama sekali.
 */
function mediaElement(
  element: HTMLElement,
  node: StructuredNode,
  dictionaryId: string | undefined,
): Node {
  const path = node.path;
  if (typeof path !== 'string' || path.length === 0 || dictionaryId === undefined) {
    return document.createTextNode('');
  }
  element.setAttribute('data-media-path', path);
  element.setAttribute('alt', node.alt ?? '');
  element.setAttribute('loading', 'lazy');
  element.setAttribute('decoding', 'async');
  const units = node.sizeUnits ?? DEFAULT_SIZE_UNITS;
  if (typeof node.width === 'number' && Number.isFinite(node.width)) {
    element.style.setProperty('width', `${node.width}${units}`);
  }
  if (typeof node.height === 'number' && Number.isFinite(node.height)) {
    element.style.setProperty('height', `${node.height}${units}`);
  }
  if (typeof node.verticalAlign === 'string') {
    element.style.setProperty('vertical-align', node.verticalAlign);
  }
  if (node.pixelated === true) {
    element.style.setProperty('image-rendering', 'pixelated');
  }
  if (node.appearance === 'monochrome') {
    element.classList.add('sc-img--monochrome');
  }
  attachMedia(element as HTMLImageElement, dictionaryId, path);
  return element;
}

function buildNode(node: StructuredNode, dictionaryId: string | undefined): Node {
  const tag = node.tag.toLowerCase();
  if (!Object.hasOwn(ALLOWED_STRUCTURED_TAGS, tag)) {
    // Data di luar daftar putih (mis. media) tidak pernah menjadi elemen; isi media
    // dibuang, tag tak dikenal lain ditampilkan sebagai teksnya agar informasi tidak hilang.
    return document.createTextNode(
      Object.hasOwn(IGNORED_STRUCTURED_TAGS, tag) ? '' : structuredText(node),
    );
  }
  const element = el(tag as keyof HTMLElementTagNameMap);
  element.classList.add(`sc-${tag}`);
  for (const [property, value] of structuredStyleEntries(node.style ?? {})) {
    element.style.setProperty(property, value);
  }
  const role = node.data?.content;
  if (typeof role === 'string') {
    element.setAttribute('data-content', role);
  }
  if (typeof node.lang === 'string') {
    element.setAttribute('lang', node.lang);
  }
  if (typeof node.title === 'string') {
    element.title = node.title;
  }
  if (tag === 'td' || tag === 'th') {
    const colSpan = node.colSpan;
    const rowSpan = node.rowSpan;
    if (typeof colSpan === 'number' && colSpan >= 1 && colSpan <= MAX_SPAN) {
      element.setAttribute('colspan', String(colSpan));
    }
    if (typeof rowSpan === 'number' && rowSpan >= 1 && rowSpan <= MAX_SPAN) {
      element.setAttribute('rowspan', String(rowSpan));
    }
  }
  if (tag === 'img') {
    return mediaElement(element, node, dictionaryId);
  }
  if (tag !== 'br') {
    appendContent(element, node.content, dictionaryId);
  }
  if (tag === 'table') {
    // Tabel panjang dapat melebihi lebar popup; gulir horizontal di wadahnya.
    return el('div', { className: 'sc-table-wrap', children: [element] });
  }
  return element;
}

/**
 * Ubah satu definisi menjadi node DOM.
 *
 * String tetap menjadi text node (jalur cepat untuk dataset plain text v1).
 * `dictionaryId` adalah kamus pemilik definisi: gambar (`img`) memakai byte dari store
 * `media` kamus itu, jadi tanpanya simpul gambar tidak dirender.
 */
export function structuredDefinitionDom(item: DefinitionItem, dictionaryId?: string): Node {
  if (!isStructuredNode(item)) {
    return document.createTextNode(item);
  }
  return buildNode(item, dictionaryId);
}
