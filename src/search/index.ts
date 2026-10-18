/**
 * Halaman pencarian Shirabe (PRD 4.2, 5.3).
 *
 * Berguna untuk lookup yang tidak berasal dari halaman, dan menjadi fallback saat
 * content script belum diaktifkan (mis. item menu konteks "Cari dengan Shirabe").
 */

import { el } from '../ui/dom.js';
import { formatNumber } from '../ui/format.js';
import { initPage, localizeStatic, RequestFailedError, request } from '../ui/page.js';
import { ResultsPanel } from '../ui/results-panel.js';
import { errorMessage, t } from '../ui/strings.js';
import '../styles/base.css';
import './search.css';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Elemen #${id} tidak ditemukan.`);
  }
  return element as T;
}

const searchForm = byId<HTMLFormElement>('search-form');
const searchInput = byId<HTMLInputElement>('search-input');
const searchButton = byId<HTMLButtonElement>('search-button');
const settingsButton = byId<HTMLButtonElement>('settings-button');
const statusRow = byId<HTMLElement>('status');
const resultsContainer = byId<HTMLElement>('results');
const resultsPanel = new ResultsPanel(resultsContainer);

let requestToken = 0;
let activeDictionaries = 0;

function describeError(error: unknown): string {
  if (error instanceof RequestFailedError) {
    return errorMessage(error.code, error.message);
  }
  return error instanceof Error ? error.message : t('error.INTERNAL');
}

function renderDictionaryStatus(): void {
  statusRow.replaceChildren();
  if (activeDictionaries > 0) {
    statusRow.append(
      el('span', {
        className: 'status status--ok',
        text: t('action.activeDictionaries', { count: formatNumber(activeDictionaries) }),
      }),
    );
    return;
  }
  statusRow.append(
    el('span', { className: 'status status--warn', text: t('action.statusNoDictionary') }),
    el('span', { className: 'note', text: t('action.noDictionaryHint') }),
  );
}

async function search(query: string): Promise<void> {
  const token = (requestToken += 1);
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    resultsPanel.showMessage(t('results.emptyQuery'));
    return;
  }
  try {
    const result = await request('LOOKUP', { query: trimmed, source: 'manual' });
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

async function initialize(): Promise<void> {
  await initPage();
  localizeStatic(document);

  const payload = await request('DICTIONARIES_GET', {});
  activeDictionaries = payload.dictionaries.filter((item) => item.status === 'active').length;
  renderDictionaryStatus();

  const initialQuery = new URLSearchParams(window.location.search).get('q') ?? '';
  searchInput.value = initialQuery;
  searchButton.disabled = initialQuery.trim().length === 0;
  if (initialQuery.trim().length > 0) {
    await search(initialQuery);
  }
  searchInput.focus();
}

searchInput.addEventListener('input', () => {
  searchButton.disabled = searchInput.value.trim().length === 0;
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  // Kueri sebelumnya tidak ditampilkan sebagai hasil kueri baru.
  resultsPanel.clear();
  void search(searchInput.value);
});

settingsButton.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void initialize();
