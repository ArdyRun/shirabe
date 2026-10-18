/**
 * Action popup Shirabe (PRD 5.1, 5.3).
 *
 * Menyediakan pencarian manual, pencarian teks terpilih, status kamus, dan tombol
 * aktivasi scan untuk situs tab aktif. Popup tidak membaca dataset kamus; hasil
 * lookup diminta ke service worker.
 */

import type { Preferences } from '../core/preferences.js';
import { isScannableUrl, originFromUrl } from '../core/site.js';
import { el } from '../ui/dom.js';
import { formatBytes, formatNumber } from '../ui/format.js';
import { initPage, localizeStatic, RequestFailedError, request } from '../ui/page.js';
import { ResultsPanel } from '../ui/results-panel.js';
import { errorMessage, t } from '../ui/strings.js';
import '../styles/base.css';
import './action.css';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Elemen #${id} tidak ditemukan.`);
  }
  return element as T;
}

const statusBadge = byId<HTMLSpanElement>('status-badge');
const searchForm = byId<HTMLFormElement>('search-form');
const searchInput = byId<HTMLInputElement>('search-input');
const searchButton = byId<HTMLButtonElement>('search-button');
const selectionButton = byId<HTMLButtonElement>('selection-button');
const siteButton = byId<HTMLButtonElement>('site-button');
const notice = byId<HTMLElement>('notice');
const hint = byId<HTMLParagraphElement>('hint');
const storageNote = byId<HTMLSpanElement>('storage-note');
const settingsButton = byId<HTMLButtonElement>('settings-button');
const resultsContainer = byId<HTMLElement>('results');
const resultsPanel = new ResultsPanel(resultsContainer);

let preferences: Preferences | null = null;
let tabId: number | null = null;
let tabOrigin: string | null = null;
let siteEnabled = false;
let activeDictionaryCount = 0;
let requestToken = 0;

function describeError(error: unknown): string {
  if (error instanceof RequestFailedError) {
    return errorMessage(error.code, error.message);
  }
  return error instanceof Error ? error.message : t('error.INTERNAL');
}

function renderStatus(): void {
  statusBadge.textContent =
    activeDictionaryCount > 0 ? t('action.statusReady') : t('action.statusNoDictionary');
  statusBadge.className = activeDictionaryCount > 0 ? 'status status--ok' : 'status status--warn';
  statusBadge.title = t('action.activeDictionaries', {
    count: formatNumber(activeDictionaryCount),
  });
}

function renderNotice(): void {
  if (activeDictionaryCount > 0) {
    notice.hidden = true;
    notice.replaceChildren();
    return;
  }
  notice.hidden = false;
  const link = el('button', {
    className: 'button button--icon',
    text: t('action.importLink'),
    attrs: { type: 'button' },
  });
  link.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
  notice.replaceChildren(el('p', { className: 'note', text: t('action.noDictionaryHint') }), link);
}

function renderSiteControl(): void {
  if (tabOrigin === null) {
    siteButton.hidden = true;
    hint.textContent = t('action.unsupportedPage');
    return;
  }
  siteButton.hidden = false;
  const globallyOff = preferences?.scanAllSites === false;
  siteButton.textContent = siteEnabled ? t('action.disableSite') : t('action.enableSite');
  hint.textContent = globallyOff
    ? t('action.scanDisabledGlobally')
    : siteEnabled
      ? t('action.hint', { modifier: preferences?.scanModifier ?? 'Alt' })
      : t('action.scanOff');
}

async function runLookup(query: string, source: 'manual' | 'selection'): Promise<void> {
  const token = (requestToken += 1);
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    resultsPanel.showMessage(t('results.emptyQuery'));
    return;
  }
  try {
    const result = await request('LOOKUP', { query: trimmed, source });
    if (token !== requestToken) {
      return;
    }
    resultsPanel.showResult(result);
  } catch (error) {
    if (token !== requestToken) {
      return;
    }
    resultsPanel.showMessage(describeError(error));
  }
}

/** Baca teks terpilih dari content script di tab aktif (respons divalidasi). */
async function readSelectionFromTab(activeTabId: number): Promise<string | null> {
  // Seleksi pengguna selalu berada di frame utama; tanpa `frameId` pesan juga dikirim ke
  // iframe yang dapat merespons lebih dahulu dengan seleksi kosong.
  const response: unknown = await chrome.tabs.sendMessage(
    activeTabId,
    {
      v: 1,
      id: crypto.randomUUID(),
      type: 'GET_SELECTION',
      payload: {},
    },
    { frameId: 0 },
  );
  if (typeof response !== 'object' || response === null || !('response' in response)) {
    return null;
  }
  const envelope = response.response;
  if (typeof envelope !== 'object' || envelope === null || !('ok' in envelope) || envelope.ok !== true) {
    return null;
  }
  if (!('data' in envelope)) {
    return null;
  }
  const data = envelope.data;
  if (typeof data !== 'object' || data === null || !('text' in data) || typeof data.text !== 'string') {
    return null;
  }
  return data.text;
}

async function searchSelectedText(): Promise<void> {
  if (tabId === null) {
    resultsPanel.showMessage(t('action.selectionFailed'));
    return;
  }
  if (!siteEnabled) {
    resultsPanel.showMessage(t('action.scanOff'));
    return;
  }
  try {
    const text = await readSelectionFromTab(tabId);
    if (text === null) {
      resultsPanel.showMessage(t('action.selectionFailed'));
      return;
    }
    if (text.length === 0) {
      resultsPanel.showMessage(t('action.selectionEmpty'));
      return;
    }
    searchInput.value = text;
    searchButton.disabled = false;
    await runLookup(text, 'selection');
  } catch (error) {
    resultsPanel.showMessage(`${t('action.selectionFailed')} ${describeError(error)}`);
  }
}

async function toggleSite(): Promise<void> {
  if (tabOrigin === null) {
    return;
  }
  try {
    if (siteEnabled) {
      await request('SITE_SCAN_DISABLE', { origin: tabOrigin });
      siteEnabled = false;
    } else {
      await request('SITE_SCAN_ENABLE', { origin: tabOrigin });
      siteEnabled = true;
    }
    renderSiteControl();
  } catch (error) {
    hint.textContent = describeError(error);
  }
}

async function initialize(): Promise<void> {
  preferences = await initPage();
  localizeStatic(document);
  renderStatus();
  renderNotice();

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  tabId = tab?.id ?? null;
  tabOrigin = isScannableUrl(tab?.url) ? originFromUrl(tab?.url) : null;
  if (tabOrigin !== null) {
    const sites = await request('SITES_GET', {});
    siteEnabled = sites.sites[tabOrigin]?.enabled !== false;
  }
  renderSiteControl();

  try {
    const payload = await request('DICTIONARIES_GET', {});
    activeDictionaryCount = payload.dictionaries.filter((item) => item.status === 'active').length;
    renderStatus();
    renderNotice();
    storageNote.textContent = t('action.storage', {
      usage: formatBytes(payload.storage.usage),
      quota: formatBytes(payload.storage.quota),
    });
  } catch (error) {
    storageNote.textContent = describeError(error);
  }

  searchButton.disabled = searchInput.value.trim().length === 0;
  searchInput.focus();
}

searchInput.addEventListener('input', () => {
  searchButton.disabled = searchInput.value.trim().length === 0;
  resultsPanel.clear();
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void runLookup(searchInput.value, 'manual');
});

selectionButton.addEventListener('click', () => {
  void searchSelectedText();
});

siteButton.addEventListener('click', () => {
  void toggleSite();
});

settingsButton.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void initialize();
