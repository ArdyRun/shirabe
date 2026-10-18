/**
 * Utilitas bersama halaman extension: pemuatan preferensi, tema, dan pemanggilan
 * pesan ke service worker dengan penanganan error terstruktur.
 */

import {
  SETTINGS_STORAGE_KEY,
  sanitizePreferences,
  type Preferences,
} from '../core/preferences.js';
import {
  buildMessage,
  isExtensionContextInvalidated,
  isResponseEnvelope,
  type ErrorCode,
  type MessageType,
  type RequestPayload,
  type ResponseData,
} from '../messaging/protocol.js';
import { setLanguage, t } from './strings.js';
import { applyThemeWithListener, clearThemePending } from './theme.js';

/** Kegagalan permintaan ke service worker, membawa kode error protokol. */
export class RequestFailedError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'RequestFailedError';
    this.code = code;
  }
}

export async function request<K extends MessageType>(
  type: K,
  payload: RequestPayload<K>,
): Promise<ResponseData<K>> {
  let response: unknown;
  try {
    response = await chrome.runtime.sendMessage(buildMessage(type, payload));
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      throw new RequestFailedError(
        'CONTEXT_INVALIDATED',
        error instanceof Error ? error.message : 'Konteks extension sudah tidak berlaku.',
      );
    }
    throw new RequestFailedError(
      'INTERNAL',
      error instanceof Error ? error.message : 'Service worker tidak merespons.',
    );
  }
  if (!isResponseEnvelope(response)) {
    throw new RequestFailedError('INTERNAL', 'Balasan service worker tidak valid.');
  }
  if (!response.response.ok) {
    throw new RequestFailedError(response.response.error.code, response.response.error.message);
  }
  return response.response.data as ResponseData<K>;
}

export async function readPreferences(): Promise<Preferences> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  return sanitizePreferences(stored[SETTINGS_STORAGE_KEY]);
}

/** Siapkan halaman: bahasa, preferensi, dan tema (termasuk mengikuti tema sistem). */
export async function initPage(): Promise<Preferences> {
  let preferences: Preferences;
  try {
    preferences = await readPreferences();
  } catch (error) {
    // Pembacaan gagal: tampilkan antarmuka dengan palet bawaan, jangan biarkan tersembunyi.
    clearThemePending();
    throw error;
  }
  let disposeTheme = applyThemeWithListener(preferences.theme);
  // Tema sudah terpasang: tampilkan antarmuka yang ditahan `data-theme-pending`.
  clearThemePending();
  setLanguage(preferences.uiLanguage);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(SETTINGS_STORAGE_KEY in changes)) {
      return;
    }
    const next = sanitizePreferences(changes[SETTINGS_STORAGE_KEY]?.newValue);
    disposeTheme();
    disposeTheme = applyThemeWithListener(next.theme);
    setLanguage(next.uiLanguage);
  });
  return preferences;
}

/** Terapkan teks statis ber-atribut `data-i18n`, `data-i18n-placeholder`, `data-i18n-label`. */
export function localizeStatic(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset['i18n'];
    if (key !== undefined) {
      element.textContent = t(key);
    }
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    const key = element.dataset['i18nPlaceholder'];
    if (key !== undefined) {
      element.setAttribute('placeholder', t(key));
    }
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    const key = element.dataset['i18nLabel'];
    if (key !== undefined) {
      element.setAttribute('aria-label', t(key));
    }
  }
}
