/**
 * Halaman pengaturan Shirabe (PRD 4.5, 4.6, 5.3).
 *
 * Mengelola kamus (impor, aktivasi, urutan, hapus, storage), preferensi membaca,
 * izin situs, privasi, dan bahasa/tema. Semua penulisan data besar dilakukan
 * service worker; halaman ini hanya memproses file dan menampilkan status.
 */

import { IMPORT_LIMITS } from '../core/limits.js';
import {
  MAX_RESULTS_RANGE,
  POPUP_HIDE_DELAY_RANGE,
  POPUP_MAX_HEIGHT_RANGE,
  POPUP_WIDTH_RANGE,
  SCAN_MODIFIERS,
  UI_LANGUAGES,
  type Preferences,
  type ScanModifier,
  type ThemePreference,
  type UiLanguage,
  type WritablePreferenceKey,
} from '../core/preferences.js';
import { SCHEMA_VERSION, SCHEMA_VERSION_LABEL } from '../core/jsonl.js';
import { THEME_GROUPS, themesInGroup } from '../core/themes.js';
import type { DictionarySummary, ImportPhase, StorageInfo } from '../data/schema.js';
import type { DictionariesData } from '../messaging/protocol.js';
import { el } from '../ui/dom.js';
import { formatBytes, formatDateTime, formatNumber } from '../ui/format.js';
import { initPage, localizeStatic, RequestFailedError, request } from '../ui/page.js';
import { errorMessage, setLanguage, t } from '../ui/strings.js';
import type { FileImportResult } from './importer.js';
import {
  batchPercent,
  importFilesParallel,
  setParallelRequestHandler,
  type ParallelFileState,
} from './import-pool.js';
import { reorderedIds } from './order.js';
import '../styles/base.css';
import './settings.css';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Elemen #${id} tidak ditemukan.`);
  }
  return element as T;
}

const tabButtons = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const panels = [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
const importHint = byId<HTMLParagraphElement>('import-hint');
const importInput = byId<HTMLInputElement>('import-input');
const importSelection = byId<HTMLSpanElement>('import-selection');
const importProgress = byId<HTMLDivElement>('import-progress');
const importProgressBar = byId<HTMLProgressElement>('import-progress-bar');
const importProgressText = byId<HTMLSpanElement>('import-progress-text');
const importFileList = byId<HTMLUListElement>('import-files');
const importCancel = byId<HTMLButtonElement>('import-cancel');
const importMessages = byId<HTMLDivElement>('import-messages');
const dictionaryList = byId<HTMLUListElement>('dictionary-list');
const dictionarySelectMode = byId<HTMLInputElement>('dictionary-select-mode');
const dictionaryBulk = byId<HTMLDivElement>('dictionary-bulk');
const dictionarySelectedCount = byId<HTMLSpanElement>('dictionary-selected-count');
const dictionarySelectAll = byId<HTMLButtonElement>('dictionary-select-all');
const dictionaryBulkEnable = byId<HTMLButtonElement>('dictionary-bulk-enable');
const dictionaryBulkDisable = byId<HTMLButtonElement>('dictionary-bulk-disable');
const dictionaryBulkDelete = byId<HTMLButtonElement>('dictionary-bulk-delete');
const dictionaryEmpty = byId<HTMLParagraphElement>('dictionary-empty');
const storageSummary = byId<HTMLParagraphElement>('storage-summary');
const limitsSummary = byId<HTMLParagraphElement>('limits-summary');
const globalStatus = byId<HTMLParagraphElement>('global-status');
const versionLabel = byId<HTMLSpanElement>('version');
const aboutComponents = byId<HTMLParagraphElement>('about-components');
const aboutVersion = byId<HTMLParagraphElement>('about-version');
const aboutSchema = byId<HTMLParagraphElement>('about-schema');
const sitesEmpty = byId<HTMLParagraphElement>('sites-empty');
const scanAllInput = byId<HTMLInputElement>('setting-scan-all');
const siteList = byId<HTMLUListElement>('site-list');
const modifierSelect = byId<HTMLSelectElement>('setting-modifier');
const popupWidthInput = byId<HTMLInputElement>('setting-popup-width');
const popupHeightInput = byId<HTMLInputElement>('setting-popup-height');
const hideDelayInput = byId<HTMLInputElement>('setting-hide-delay');
const maxResultsInput = byId<HTMLInputElement>('setting-max-results');
const readingSearchInput = byId<HTMLInputElement>('setting-reading-search');
const languageSelect = byId<HTMLSelectElement>('setting-language');
const themeSelect = byId<HTMLSelectElement>('setting-theme');
const confirmDialog = byId<HTMLDialogElement>('confirm-dialog');
const confirmTitle = byId<HTMLHeadingElement>('confirm-title');
const confirmBody = byId<HTMLParagraphElement>('confirm-body');
const confirmAccept = byId<HTMLButtonElement>('confirm-accept');

let preferences: Preferences | null = null;
let dictionaries: DictionarySummary[] = [];
/** ID kamus yang dicentang pada mode pilih. */
const selectedIds = new Set<string>();
let cancelRequested = false;

const PHASE_LABEL_KEYS: Record<ImportPhase, string> = {
  reading: 'settings.importPhaseReading',
  validating: 'settings.importPhaseValidating',
  writing: 'settings.importPhaseWriting',
  committing: 'settings.importPhaseCommitting',
  failed: 'settings.importPhaseFailed',
};

/** Durasi singkat untuk laporan impor: milidetik di bawah satu detik, lalu detik. */
function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.max(0, Math.round(milliseconds))} ms`;
  }
  const seconds = milliseconds / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} m ${Math.round(seconds % 60)} s`;
}

function describeError(error: unknown): string {
  if (error instanceof RequestFailedError) {
    return errorMessage(error.code, error.message);
  }
  return error instanceof Error ? error.message : t('error.INTERNAL');
}

function setStatus(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  globalStatus.textContent = message;
  globalStatus.className = kind === 'error' ? 'note import-message--error' : kind === 'ok' ? 'note import-message--ok' : 'note';
}

/** Dialog konfirmasi berbasis <dialog> modal; mengembalikan true bila diterima. */
/** Antrean dialog konfirmasi: hanya satu dialog dapat terbuka, termasuk saat impor paralel. */
let confirmChain: Promise<unknown> = Promise.resolve();

function askConfirm(options: {
  title: string;
  body: string;
  acceptLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  const next = confirmChain.then(() => showConfirm(options));
  confirmChain = next.catch(() => undefined);
  return next;
}

function showConfirm(options: {
  title: string;
  body: string;
  acceptLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  confirmTitle.textContent = options.title;
  confirmBody.textContent = options.body;
  confirmAccept.textContent = options.acceptLabel;
  confirmAccept.className = options.danger === false ? 'button' : 'button button--danger';
  const { promise, resolve } = Promise.withResolvers<boolean>();
  confirmDialog.addEventListener(
    'close',
    () => {
      resolve(confirmDialog.returnValue === 'accept');
    },
    { once: true },
  );
  confirmDialog.showModal();
  return promise;
}

function renderTabs(): void {
  const show = (target: string): void => {
    for (const button of tabButtons) {
      const active = button.getAttribute('aria-controls') === target;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const panel of panels) {
      panel.hidden = panel.id !== target;
    }
  };
  for (const button of tabButtons) {
    button.addEventListener('click', () => {
      const target = button.getAttribute('aria-controls');
      if (target !== null) {
        show(target);
      }
    });
  }
}

function renderStaticTexts(): void {
  importHint.textContent = t('settings.importHint', {
    schemaVersion: SCHEMA_VERSION_LABEL,
    fileSize: formatBytes(IMPORT_LIMITS.maxFileBytes),
    entries: formatNumber(IMPORT_LIMITS.maxEntries),
    line: formatNumber(IMPORT_LIMITS.maxLineCodePoints),
  });
  limitsSummary.textContent = `${t('settings.limitsTitle')}: ${formatBytes(IMPORT_LIMITS.maxFileBytes)} per file, ${formatNumber(IMPORT_LIMITS.maxEntries)} entry, ${formatNumber(IMPORT_LIMITS.maxLineCodePoints)} code point per baris (schema v${SCHEMA_VERSION_LABEL}).`;
  aboutVersion.textContent = t('settings.aboutVersion', { version: appVersion() });
  aboutSchema.textContent = t('settings.aboutSchema', { schemaVersion: SCHEMA_VERSION_LABEL });
}

/**
 * Tampilkan keadaan sibuk pada satu baris kamus.
 *
 * Dipakai untuk operasi yang tidak dapat melaporkan persentase (penghapusan versi kamus
 * berjalan sebagai satu transaksi IndexedDB): indikator tak-tentu supaya baris tidak
 * tampak diam, dan seluruh tombol baris dinonaktifkan agar tidak ada aksi ganda.
 */
function setDictionaryBusy(row: HTMLElement | null, busy: boolean): void {
  if (row === null) {
    return;
  }
  row.classList.toggle('dictionary--busy', busy);
  row.toggleAttribute('aria-busy', busy);
  for (const button of row.querySelectorAll('button')) {
    button.disabled = busy;
  }
  const status = row.querySelector<HTMLElement>('.dictionary__busy');
  if (busy && status === null) {
    row.append(
      el('div', {
        className: 'dictionary__busy note',
        attrs: { role: 'status' },
        children: [el('progress'), el('span', { text: t('settings.deleting') })],
      }),
    );
  } else if (!busy && status !== null) {
    status.remove();
  }
}

/**
 * Tandai satu kamus terpilih.
 *
 * Tidak menggambar ulang daftar: checkbox dan latar baris diperbarui langsung supaya fokus
 * keyboard tidak hilang saat pengguna mencentang beberapa baris berturut-turut.
 */
function setDictionarySelected(row: HTMLElement, id: string, selected: boolean): void {
  if (selected) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }
  row.dataset['selected'] = selected ? 'true' : 'false';
  renderBulkBar();
}

/** Perbarui jumlah terpilih, status tombol massal, dan status "Pilih semua". */
function renderBulkBar(): void {
  const count = selectedIds.size;
  dictionarySelectedCount.textContent = t('settings.selectionCount', { count: formatNumber(count) });
  const disable = count === 0;
  dictionaryBulkEnable.disabled = disable;
  dictionaryBulkDisable.disabled = disable;
  dictionaryBulkDelete.disabled = disable;
  const allSelected = dictionaries.length > 0 && count === dictionaries.length;
  dictionarySelectAll.setAttribute('aria-pressed', allSelected ? 'true' : 'false');
}

/** Nyala/matikan mode pilih; aksi per baris disembunyikan agar baris hanya soal memilih. */
function setSelectMode(enabled: boolean): void {
  dictionarySelectMode.checked = enabled;
  dictionaryBulk.hidden = !enabled;
  dictionaryList.dataset['selectMode'] = enabled ? 'true' : 'false';
  if (!enabled) {
    selectedIds.clear();
    for (const row of dictionaryList.querySelectorAll<HTMLElement>('li.dictionary')) {
      row.dataset['selected'] = 'false';
      const input = row.querySelector<HTMLInputElement>('.dictionary__select');
      if (input !== null) {
        input.checked = false;
      }
    }
  }
  renderBulkBar();
}

/** Terapkan aksi ke semua kamus terpilih, lalu segarkan daftar sekali. */
async function mutateSelected(
  action: (id: string) => Promise<DictionariesData>,
  message: (count: number) => string,
): Promise<void> {
  const ids = [...selectedIds];
  if (ids.length === 0) {
    return;
  }
  const buttons = [dictionarySelectAll, dictionaryBulkEnable, dictionaryBulkDisable, dictionaryBulkDelete];
  for (const button of buttons) {
    button.disabled = true;
  }
  try {
    let last: DictionariesData | null = null;
    for (const id of ids) {
      last = await action(id);
    }
    if (last !== null) {
      dictionaries = last.dictionaries;
      renderDictionaries(last.cleanedImports);
      renderStorage(last.storage);
    }
    selectedIds.clear();
    renderBulkBar();
    setStatus(message(ids.length), 'ok');
  } catch (error) {
    setStatus(describeError(error), 'error');
  } finally {
    for (const button of buttons) {
      button.disabled = false;
    }
    renderBulkBar();
  }
}

function renderDictionaries(cleanedImports: number): void {
  dictionaryList.replaceChildren();
  dictionaryEmpty.hidden = dictionaries.length > 0;
  if (cleanedImports > 0) {
    importMessages.append(
      el('p', {
        className: 'note',
        text: t('settings.importsCleaned', { count: formatNumber(cleanedImports) }),
      }),
    );
  }

  dictionaries.forEach((dictionary, index) => {
    const enabled = dictionary.status === 'active';
    // Tombol tanpa teks wajib punya nama aksesibel dan tooltip: `aria-label` untuk pembaca
    // layar, `title` untuk pengguna tetikus yang belum tahu arti glyph-nya. Glyph dipilih
    // yang benar-benar ter-render di sistem ini (`⏻` power), bukan emoji.
    const toggleLabel = enabled ? t('settings.disable') : t('settings.enable');
    const toggle = el('button', {
      className: 'button button--icon',
      text: '⏻',
      attrs: { type: 'button', 'aria-label': toggleLabel, title: toggleLabel },
    });
    toggle.addEventListener('click', () => {
      void mutate(() => request('DICTIONARY_ENABLE', { id: dictionary.id, enabled: !enabled }));
    });

    const moveUp = el('button', {
      className: 'button button--icon',
      text: '↑',
      attrs: { type: 'button', 'aria-label': t('settings.moveUp'), title: t('settings.moveUp') },
    });
    moveUp.disabled = index === 0;
    moveUp.addEventListener('click', () => {
      const order = dictionaries.map((item) => item.id);
      const previous = order[index - 1];
      const current = order[index];
      if (previous !== undefined && current !== undefined) {
        order[index - 1] = current;
        order[index] = previous;
        void mutate(() => request('DICTIONARY_REORDER', { ids: order }));
      }
    });

    const moveDown = el('button', {
      className: 'button button--icon',
      text: '↓',
      attrs: { type: 'button', 'aria-label': t('settings.moveDown'), title: t('settings.moveDown') },
    });
    moveDown.disabled = index === dictionaries.length - 1;
    moveDown.addEventListener('click', () => {
      const order = dictionaries.map((item) => item.id);
      const next = order[index + 1];
      const current = order[index];
      if (next !== undefined && current !== undefined) {
        order[index + 1] = current;
        order[index] = next;
        void mutate(() => request('DICTIONARY_REORDER', { ids: order }));
      }
    });

    const remove = el('button', {
      className: 'button button--icon button--danger',
      text: '✕',
      attrs: { type: 'button', 'aria-label': t('settings.delete'), title: t('settings.delete') },
    });
    remove.addEventListener('click', () => {
      void (async () => {
        const row = remove.closest<HTMLElement>('li.dictionary');
        const confirmed = await askConfirm({
          title: t('settings.delete'),
          body: t('settings.deleteConfirm', {
            name: dictionary.name,
            count: formatNumber(dictionary.entryCount),
            size: formatBytes(dictionary.approxSize),
          }),
          acceptLabel: t('settings.deleteConfirmButton'),
        });
        if (!confirmed) {
          return;
        }
        setDictionaryBusy(row, true);
        // Penghapusan berjalan sebagai transaksi IndexedDB di service worker, jadi durasinya
        // tidak dapat dilaporkan; yang penting baris tidak tampak diam. Daftar digambar ulang
        // oleh `mutate` saat berhasil, sehingga keadaan sibuk hilang dengan sendirinya.
        if (!(await mutate(() => request('DICTIONARY_DELETE', { id: dictionary.id })))) {
          setDictionaryBusy(row, false);
          return;
        }
        setStatus(t('settings.deleted', { name: dictionary.name }), 'ok');
      })();
    });

    // Ringkasan satu baris: hanya bagian yang tidak nol, supaya kamus istilah, kamus
    // kanji, dan kamus pitch sama-sama terbaca dalam satu baris pendek.
    const facts = [
      dictionary.entryCount > 0
        ? t('settings.factEntries', { count: formatNumber(dictionary.entryCount) })
        : null,
      dictionary.kanjiCount > 0
        ? t('settings.factKanji', { count: formatNumber(dictionary.kanjiCount) })
        : null,
      dictionary.metaCount > 0
        ? t('settings.factMeta', { count: formatNumber(dictionary.metaCount) })
        : null,
      dictionary.mediaCount > 0
        ? t('settings.factMedia', { count: formatNumber(dictionary.mediaCount) })
        : null,
      // Upgrade skema v4 menghapus data meta lama; kamus yang terkena ditandai agar
      // pengguna tahu bahwa bacaan/pitch/frekuensinya hilang sampai diimpor ulang.
      dictionary.metaStale ? t('settings.metaStale') : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' · ');

    const detail = el('div', {
      className: 'dictionary__detail',
      attrs: { hidden: '' },
      children: [
        el('p', {
          className: 'note',
          text: `${t('settings.importedAt', { date: formatDateTime(dictionary.importedAt) })} · ${formatBytes(dictionary.approxSize)} · ${dictionary.sourceFileName}`,
        }),
        ...(dictionary.kanjiCount > 0 || dictionary.metaCount > 0 || dictionary.mediaCount > 0
          ? [
              el('p', {
                className: 'note',
                // Kamus kanji/pitch tidak punya istilah sama sekali: tanpa baris ini
                // kamus yang berhasil diimpor terlihat seperti kamus kosong.
                text: t('settings.dictionaryContents', {
                  entries: formatNumber(dictionary.entryCount),
                  kanji: formatNumber(dictionary.kanjiCount),
                  meta: formatNumber(dictionary.metaCount),
                  media: `${formatNumber(dictionary.mediaCount)} (${formatBytes(dictionary.mediaBytes)})`,
                }),
              }),
            ]
          : []),
        el('p', {
          className: 'note',
          text:
            dictionary.license.length > 0
              ? t('settings.license', { value: dictionary.license })
              : t('settings.licenseUnknown'),
        }),
        dictionary.attribution.length > 0
          ? el('p', {
              className: 'note',
              text: t('settings.attribution', { value: dictionary.attribution }),
            })
          : null,
        el('div', {
          className: 'dictionary__actions',
          children: [toggle, moveUp, moveDown, remove],
        }),
      ],
    });

    const detailToggle = el('button', {
      className: 'button button--icon dictionary__detail-toggle',
      text: '▾',
      attrs: {
        type: 'button',
        'aria-label': t('settings.details'),
        title: t('settings.details'),
        'aria-expanded': 'false',
      },
    });
    const select = el('input', {
      className: 'dictionary__select',
      attrs: {
        type: 'checkbox',
        'aria-label': t('settings.selectRow', { name: dictionary.name }),
      },
    });
    select.checked = selectedIds.has(dictionary.id);
    select.addEventListener('change', () => {
      setDictionarySelected(item, dictionary.id, select.checked);
    });
    detailToggle.addEventListener('click', () => {
      const opening = detail.hidden;
      detail.hidden = !opening;
      detailToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });

    const item = el('li', {
      className: 'dictionary',
      attrs: {
        'data-dictionary': dictionary.id,
        'data-selected': selectedIds.has(dictionary.id) ? 'true' : 'false',
        draggable: 'true',
      },
      children: [
        el('div', {
          className: 'dictionary__head',
          children: [
            select,
            el('span', {
              className: 'dictionary__handle',
              text: '⠿',
              attrs: { title: t('settings.dragHandle'), 'aria-hidden': 'true' },
            }),
            el('h3', { text: dictionary.name }),
            el('span', {
              className: enabled ? 'status status--ok' : 'status',
              text: enabled ? t('settings.enabled') : t('settings.disabled'),
            }),
            facts.length > 0 ? el('span', { className: 'note dictionary__facts', text: facts }) : null,
            el('div', {
              className: 'dictionary__actions',
              children: [moveUp, moveDown, toggle, remove, detailToggle],
            }),
          ],
        }),
        detail,
      ],
    });
    dictionaryList.append(item);
  });
  renderBulkBar();
}

/**
 * Baris kamus dari sebuah event target (null bila bukan baris kamus).
 *
 * Listener dipasang pada `<ul>` (bukan per baris) karena daftar dirender ulang setiap kali
 * urutan atau status kamus berubah.
 */
function dictionaryRowFrom(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('li.dictionary') : null;
}

/**
 * Ubah urutan kamus dengan menyeret baris.
 *
 * Tombol ↑/↓ di panel detail tetap menjadi jalur keyboard: seret tidak dapat dilakukan
 * tanpa pointer, dan urutan yang dikirim selalu dihitung `reorderedIds` supaya hasilnya
 * sama untuk kedua jalur.
 */
function setupDictionaryDragAndDrop(): void {
  let draggedId: string | null = null;

  const clearMarks = (): void => {
    for (const row of dictionaryList.querySelectorAll<HTMLElement>('li.dictionary')) {
      delete row.dataset['drop'];
      row.classList.remove('dictionary--dragging');
    }
  };

  dictionaryList.addEventListener('dragstart', (event) => {
    const row = dictionaryRowFrom(event.target);
    if (row === null) {
      return;
    }
    draggedId = row.dataset['dictionary'] ?? null;
    row.classList.add('dictionary--dragging');
    // Sebagian browser membatalkan drag tanpa data; isinya tidak dipakai.
    event.dataTransfer?.setData('text/plain', draggedId ?? '');
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = 'move';
    }
  });

  dictionaryList.addEventListener('dragover', (event) => {
    const row = dictionaryRowFrom(event.target);
    if (row === null || draggedId === null) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = 'move';
    }
    const rect = row.getBoundingClientRect();
    const side = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    for (const other of dictionaryList.querySelectorAll<HTMLElement>('li.dictionary')) {
      if (other !== row) {
        delete other.dataset['drop'];
      }
    }
    row.dataset['drop'] = side;
  });

  dictionaryList.addEventListener('drop', (event) => {
    const row = dictionaryRowFrom(event.target);
    const targetId = row?.dataset['dictionary'];
    const side = row?.dataset['drop'] === 'after' ? 'after' : 'before';
    if (row === null || targetId === undefined || draggedId === null) {
      return;
    }
    event.preventDefault();
    const dragged = draggedId;
    draggedId = null;
    clearMarks();
    const ids = reorderedIds(
      dictionaries.map((item) => item.id),
      dragged,
      targetId,
      side,
    );
    void mutate(() => request('DICTIONARY_REORDER', { ids }));
  });

  dictionaryList.addEventListener('dragend', () => {
    draggedId = null;
    clearMarks();
  });
}

function renderStorage(storage: StorageInfo): void {
  storageSummary.textContent =
    storage.quota > 0
      ? `${t('settings.storageUsage', {
          usage: formatBytes(storage.usage),
          quota: formatBytes(storage.quota),
        })} · ${formatNumber(storage.entryCount)} entry · ${formatNumber(storage.dictionaryCount)} kamus`
      : t('settings.storageUnavailable');
}

async function renderSites(): Promise<void> {
  const payload = await request('SITES_GET', {});
  scanAllInput.checked = payload.scanAllSites;
  const origins = payload.disabledOrigins;
  siteList.replaceChildren();
  sitesEmpty.hidden = origins.length > 0;

  for (const origin of origins) {
    const button = el('button', {
      className: 'button button--icon',
      text: t('settings.siteEnable'),
      attrs: { type: 'button' },
    });
    button.addEventListener('click', () => {
      void (async () => {
        try {
          await request('SITE_SCAN_ENABLE', { origin });
          await renderSites();
        } catch (error) {
          setStatus(describeError(error), 'error');
        }
      })();
    });

    siteList.append(
      el('li', {
        className: 'site',
        children: [
          el('div', {
            className: 'row row--between',
            children: [
              el('div', {
                children: [
                  el('strong', { text: origin }),
                  el('p', { className: 'note', text: t('settings.siteDisable') }),
                ],
              }),
              el('div', {
                className: 'row',
                children: [
                  el('span', { className: 'status status--warn', text: t('action.scanOff') }),
                  button,
                ],
              }),
            ],
          }),
        ],
      }),
    );
  }
}

function renderPreferenceControls(prefs: Preferences): void {
  scanAllInput.checked = prefs.scanAllSites;
  modifierSelect.value = prefs.scanModifier;
  popupWidthInput.value = String(prefs.popupWidth);
  popupHeightInput.value = String(prefs.popupMaxHeight);
  hideDelayInput.value = String(prefs.popupHideDelayMs);
  maxResultsInput.value = String(prefs.maxResults);
  readingSearchInput.checked = prefs.readingSearch;
  languageSelect.value = prefs.uiLanguage;
  themeSelect.value = prefs.theme;
}

/** Jalankan operasi kamus lalu gambar ulang daftar; false berarti operasi gagal. */
async function mutate(action: () => Promise<DictionariesData>): Promise<boolean> {
  try {
    const payload = await action();
    dictionaries = payload.dictionaries;
    renderDictionaries(payload.cleanedImports);
    renderStorage(payload.storage);
    return true;
  } catch (error) {
    setStatus(describeError(error), 'error');
    return false;
  }
}

async function refreshDictionaries(): Promise<void> {
  await mutate(() => request('DICTIONARIES_GET', {}));
}

async function savePreferences(
  changes: Partial<Record<WritablePreferenceKey, unknown>>,
): Promise<void> {
  try {
    const payload = await request('SETTINGS_SET', { changes });
    preferences = payload.preferences;
    setLanguage(preferences.uiLanguage);
    localizeStatic(document);
    renderStaticTexts();
    renderPreferenceControls(preferences);
    renderDictionaries(0);
    await renderSites();
  } catch (error) {
    setStatus(t('settings.saveFailed', { message: describeError(error) }), 'error');
  }
}

function reportImportResults(results: readonly FileImportResult[]): void {
  for (const result of results) {
    if (result.status !== 'ok') {
      const message =
        result.status === 'skipped'
          ? t('settings.importAborted')
          : t('settings.importFailed', { reason: result.reason ?? '' });
      importMessages.append(
        el('p', {
          className: result.status === 'skipped' ? 'note' : 'note import-message--error',
          text: message,
        }),
      );
      continue;
    }

    const entries = result.entries ?? 0;
    const totalMs = (result.parseMs ?? 0) + (result.writeMs ?? 0);
    const rate = totalMs > 0 ? Math.round(entries / (totalMs / 1000)) : 0;
    importMessages.append(
      el('p', {
        className: 'note import-message--ok',
        text: t('settings.importDoneFormat', {
          format:
            result.format === 'zip'
              ? t('settings.importFormatZip')
              : t('settings.importFormatJsonl'),
          name: result.dictionaryName ?? result.fileName,
          count: formatNumber(entries),
          duration: formatDuration(totalMs),
          rate: formatNumber(rate),
          parseDuration: formatDuration(result.parseMs ?? 0),
          writeDuration: formatDuration(result.writeMs ?? 0),
        }),
      }),
    );
    if (result.ignoredComponents !== undefined && result.ignoredComponents.length > 0) {
      importMessages.append(
        el('p', {
          className: 'note',
          text: t('settings.importIgnored', { list: result.ignoredComponents.join(', ') }),
        }),
      );
    }
    if (result.skippedEntries !== undefined) {
      const skipped = result.skippedEntries;
      importMessages.append(
        el('p', {
          className: 'note',
          text:
            skipped.example !== null && skipped.reason !== null
              ? t('settings.importSkipped', {
                  count: formatNumber(skipped.count),
                  example: skipped.example,
                  reason: skipped.reason,
                })
              : t('settings.importSkippedUnknown', {
                  count: formatNumber(skipped.count),
                  reason: skipped.reason ?? '',
                }),
        }),
      );
    }
    if (result.kanji !== undefined || result.meta !== undefined || result.media !== undefined) {
      importMessages.append(
        el('p', {
          className: 'note',
          text: t('settings.importAux', {
            kanji: formatNumber(result.kanji ?? 0),
            meta: formatNumber(result.meta ?? 0),
            media: formatNumber(result.media ?? 0),
            size: formatBytes(result.mediaBytes ?? 0),
          }),
        }),
      );
    }
    if (result.mediaSkipped !== undefined) {
      importMessages.append(
        el('p', {
          className: 'note',
          text: t('settings.importMediaSkipped', { count: formatNumber(result.mediaSkipped) }),
        }),
      );
    }
    if (result.unsupportedParts !== undefined && result.unsupportedParts.length > 0) {
      importMessages.append(
        el('p', {
          className: 'note',
          text: t('settings.importUnsupported', { list: result.unsupportedParts.join(', ') }),
        }),
      );
    }
    if (result.truncatedDefinitions !== undefined) {
      importMessages.append(
        el('p', {
          className: 'note',
          text: t('settings.importTruncatedDefinitions', {
            count: formatNumber(result.truncatedDefinitions),
          }),
        }),
      );
    }
  }
}

/**
 * Mode pilih dan aksi massal: hapus, aktifkan/nonaktifkan, pilih semua.
 *
 * Mode pilih eksplisit (bukan checkbox yang selalu tampil) karena aksi massal bersifat
 * merusak: baris hanya menampilkan checkbox saat pengguna memang hendak memilih, sehingga
 * klik tidak sengaja pada Hapus tidak mungkin terjadi.
 */
function setupDictionaryBulk(): void {
  dictionarySelectMode.addEventListener('change', () => {
    setSelectMode(dictionarySelectMode.checked);
  });

  dictionarySelectAll.addEventListener('click', () => {
    const all = selectedIds.size === dictionaries.length && dictionaries.length > 0;
    selectedIds.clear();
    if (!all) {
      for (const dictionary of dictionaries) {
        selectedIds.add(dictionary.id);
      }
    }
    for (const row of dictionaryList.querySelectorAll<HTMLElement>('li.dictionary')) {
      const id = row.dataset['dictionary'] ?? '';
      const input = row.querySelector<HTMLInputElement>('.dictionary__select');
      if (input !== null) {
        input.checked = !all && selectedIds.has(id);
      }
      row.dataset['selected'] = !all && selectedIds.has(id) ? 'true' : 'false';
    }
    renderBulkBar();
  });

  dictionaryBulkEnable.addEventListener('click', () => {
    void mutateSelected(
      (id) => request('DICTIONARY_ENABLE', { id, enabled: true }),
      (count) => t('settings.bulkEnabled', { count: formatNumber(count) }),
    );
  });

  dictionaryBulkDisable.addEventListener('click', () => {
    void mutateSelected(
      (id) => request('DICTIONARY_ENABLE', { id, enabled: false }),
      (count) => t('settings.bulkDisabled', { count: formatNumber(count) }),
    );
  });

  dictionaryBulkDelete.addEventListener('click', () => {
    void (async () => {
      const selected = dictionaries.filter((dictionary) => selectedIds.has(dictionary.id));
      if (selected.length === 0) {
        return;
      }
      const names = selected
        .slice(0, 3)
        .map((dictionary) => dictionary.name)
        .join(', ');
      const confirmed = await askConfirm({
        title: t('settings.delete'),
        body: t('settings.bulkDeleteConfirm', {
          count: formatNumber(selected.length),
          names: selected.length > 3 ? `${names}…` : names,
        }),
        acceptLabel: t('settings.deleteConfirmButton'),
      });
      if (!confirmed) {
        return;
      }
      for (const row of dictionaryList.querySelectorAll<HTMLElement>('li.dictionary')) {
        if (selectedIds.has(row.dataset['dictionary'] ?? '')) {
          setDictionaryBusy(row, true);
        }
      }
      await mutateSelected(
        (id) => request('DICTIONARY_DELETE', { id }),
        (count) => t('settings.bulkDeleted', { count: formatNumber(count) }),
      );
    })();
  });
}

function setupImport(): void {
  importInput.addEventListener('change', () => {
    void (async () => {
      const files = [...(importInput.files ?? [])];
      if (files.length === 0) {
        return;
      }
      importSelection.textContent = t('settings.importFileCount', { count: files.length });
      importMessages.replaceChildren();
      cancelRequested = false;
      importCancel.disabled = false;
      importProgress.hidden = false;
      importProgressBar.value = 0;
      importFileList.replaceChildren();
      setStatus(t('settings.importProgress'));

      const run = importFilesParallel(
        files,
        {
          isCancelled: () => cancelRequested,
          confirmReplace: (existing, fileName) =>
            askConfirm({
              title: t('settings.importReplace'),
              body: `${t('settings.importReplaceBody', {
                name: existing.name,
                count: formatNumber(existing.entryCount),
              })} (${fileName})`,
              acceptLabel: t('settings.importReplaceConfirm'),
            }),
          onFiles: (states) => {
            renderImportFiles(states, files.length);
            importProgressBar.value = batchPercent(states);
          },
        },
        { language: preferences?.uiLanguage ?? 'id' },
      );
      importCancel.onclick = () => run.cancel();
      const results = await run.results;

      importProgress.hidden = true;
      importFileList.replaceChildren();
      importInput.value = '';
      importSelection.textContent = '';
      reportImportResults(results);
      await refreshDictionaries();
      const succeeded = results.filter((result) => result.status === 'ok').length;
      if (succeeded === results.length) {
        setStatus(t('settings.importBatchDone', { count: formatNumber(succeeded) }), 'ok');
      } else {
        setStatus('');
      }
    })();
  });

  importCancel.addEventListener('click', () => {
    cancelRequested = true;
    importCancel.disabled = true;
  });
}

/**
 * Render satu baris status per berkas impor.
 *
 * Impor berjalan paralel (worker pool), jadi "satu bilah progres" tidak lagi cukup:
 * pengguna perlu melihat berkas mana yang sedang berjalan, mana yang menunggu, dan berapa
 * yang sudah selesai.
 */
function renderImportFiles(states: readonly ParallelFileState[], total: number): void {
  importFileList.replaceChildren(
    ...states.map((state) =>
      el('li', {
        className: 'import-file',
        attrs: { 'data-state': state.status },
        children: [
          el('span', { className: 'import-file__name', text: state.fileName }),
          el('span', {
            className: 'import-file__status',
            text:
              state.status === 'queued'
                ? t('settings.importFileQueued')
                : state.phase === null
                  ? t('settings.importFileDone')
                  : t('settings.importFileRow', {
                      phase: t(PHASE_LABEL_KEYS[state.phase]),
                      percent: formatNumber(state.percent),
                      lines: formatNumber(state.lines),
                      entries: formatNumber(state.entries),
                    }),
          }),
        ],
      }),
    ),
  );
  const done = states.filter((state) => state.status === 'done' || state.status === 'failed' || state.status === 'skipped').length;
  const running = states.filter((state) => state.status === 'running').length;
  importProgressText.textContent = t('settings.importBatchProgress', {
    done: formatNumber(done),
    total: formatNumber(total),
    running: formatNumber(running),
  });
}

function setupPreferenceControls(): void {
  for (const modifier of SCAN_MODIFIERS) {
    modifierSelect.append(el('option', { text: modifier, attrs: { value: modifier } }));
  }
  for (const language of UI_LANGUAGES) {
    languageSelect.append(
      el('option', {
        text: language === 'id' ? t('settings.languageId') : t('settings.languageEn'),
        attrs: { value: language },
      }),
    );
  }
  // Pemilih tema mengikuti katalog `src/core/themes.ts`: satu optgroup per grup, label
  // tema dari katalog (nama diri) atau kunci i18n untuk tema milik Shirabe.
  for (const group of THEME_GROUPS) {
    const options = themesInGroup(group.id);
    if (options.length === 0) {
      continue;
    }
    const optgroup = el('optgroup', { attrs: { label: t(group.labelKey) } });
    for (const option of options) {
      optgroup.append(
        el('option', {
          text: option.labelKey === undefined ? option.label ?? option.id : t(option.labelKey),
          attrs: { value: option.id },
        }),
      );
    }
    themeSelect.append(optgroup);
  }

  popupWidthInput.min = String(POPUP_WIDTH_RANGE.min);
  popupWidthInput.max = String(POPUP_WIDTH_RANGE.max);
  popupHeightInput.min = String(POPUP_MAX_HEIGHT_RANGE.min);
  popupHeightInput.max = String(POPUP_MAX_HEIGHT_RANGE.max);
  hideDelayInput.min = String(POPUP_HIDE_DELAY_RANGE.min);
  hideDelayInput.max = String(POPUP_HIDE_DELAY_RANGE.max);
  maxResultsInput.min = String(MAX_RESULTS_RANGE.min);
  maxResultsInput.max = String(MAX_RESULTS_RANGE.max);

  modifierSelect.addEventListener('change', () => {
    void savePreferences({ scanModifier: modifierSelect.value as ScanModifier });
  });
  languageSelect.addEventListener('change', () => {
    void savePreferences({ uiLanguage: languageSelect.value as UiLanguage });
  });
  themeSelect.addEventListener('change', () => {
    void savePreferences({ theme: themeSelect.value as ThemePreference });
  });
  popupWidthInput.addEventListener('change', () => {
    void savePreferences({ popupWidth: Number(popupWidthInput.value) });
  });
  popupHeightInput.addEventListener('change', () => {
    void savePreferences({ popupMaxHeight: Number(popupHeightInput.value) });
  });
  hideDelayInput.addEventListener('change', () => {
    void savePreferences({ popupHideDelayMs: Number(hideDelayInput.value) });
  });
  maxResultsInput.addEventListener('change', () => {
    void savePreferences({ maxResults: Number(maxResultsInput.value) });
  });
  readingSearchInput.addEventListener('change', () => {
    void savePreferences({ readingSearch: readingSearchInput.checked });
  });
  scanAllInput.addEventListener('change', () => {
    void savePreferences({ scanAllSites: scanAllInput.checked });
  });
}

/**
 * Peringatkan bila halaman dan service worker memakai schema dataset berbeda.
 *
 * Kondisi ini terjadi saat extension diperbarui sementara tab pengaturan lama masih
 * terbuka (halaman baru + worker lama). Tanpa peringatan, gejalanya menyesatkan:
 * impor ditolak dengan "versi schema tidak didukung" padahal berkasnya sah.
 */
async function reportComponentMismatch(): Promise<void> {
  let ping: { schemaVersion: number; build: string } | null = null;
  try {
    ping = await request('PING', {});
  } catch {
    // Kegagalan PING sudah ditangani jalur lain (status "Siap"/kontak worker).
    // Identitas komponen tetap ditampilkan dengan penanda "tidak merespons".
  }
  const pageBuild = __BUILD_ID__;
  aboutComponents.textContent = t('settings.aboutComponents', {
    pageSchema: String(SCHEMA_VERSION),
    pageBuild,
    worker:
      ping === null
        ? t('settings.workerUnreachable')
        : `schema v${ping.schemaVersion} · ${ping.build}`,
  });
  if (ping === null || ping.schemaVersion === SCHEMA_VERSION) {
    return;
  }
  importMessages.append(
    el('p', {
      className: 'note note--warning',
      attrs: { 'data-role': 'component-mismatch' },
      text: t('settings.staleComponents', {
        page: String(SCHEMA_VERSION),
        worker: String(ping.schemaVersion),
      }),
    }),
  );
}

/** Versi extension dari manifest (dipakai label header dan kartu Umum). */
function appVersion(): string {
  return chrome.runtime.getManifest().version;
}

async function initialize(): Promise<void> {
  preferences = await initPage();
  await reportComponentMismatch();
  versionLabel.textContent = t('settings.aboutVersion', { version: appVersion() });
  localizeStatic(document);
  renderTabs();
  renderStaticTexts();
  // Kontrol diisi (opsi dibuat) sebelum nilai preferensi diterapkan, agar select
  // menampilkan nilai tersimpan dan bukan opsi pertama.
  setupPreferenceControls();
  renderPreferenceControls(preferences);
  setParallelRequestHandler(request);
  setupImport();
  setupDictionaryDragAndDrop();
  setupDictionaryBulk();
  await refreshDictionaries();
  await renderSites();
}

void initialize();
