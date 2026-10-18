/** Pemformatan angka/tanggal/ukuran untuk UI (locale mengikuti bahasa antarmuka). */

import { getLanguage } from './strings.js';

function locale(): string {
  return getLanguage() === 'id' ? 'id-ID' : 'en-US';
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale()).format(value);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  const digits = value >= 100 || exponent === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(locale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)} ${units[exponent]}`;
}

export function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '—';
  }
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestamp),
  );
}
