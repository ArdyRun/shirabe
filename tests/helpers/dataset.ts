/**
 * Helper pengujian data layer: reset database in-memory dan memuat fixture JSONL.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEntry, parseHeader, type DictionaryHeader, type ParsedEntry } from '../../src/core/jsonl.js';
import { closeDatabase } from '../../src/data/db.js';
import { DB_NAME } from '../../src/data/schema.js';

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures');

export interface FixtureDataset {
  header: DictionaryHeader;
  entries: ParsedEntry[];
  raw: string[];
}

export async function loadFixture(name: string): Promise<FixtureDataset> {
  const content = await readFile(path.join(FIXTURES, name), 'utf8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  const [headerLine, ...entryLines] = lines;
  if (headerLine === undefined) {
    throw new Error(`Fixture ${name} kosong.`);
  }
  const header = parseHeader(headerLine);
  if (!header.ok) {
    throw new Error(`Header fixture ${name} tidak valid: ${header.reason}`);
  }
  const entries: ParsedEntry[] = [];
  for (const line of entryLines) {
    const parsed = parseEntry(line);
    if (!parsed.ok) {
      throw new Error(`Entry fixture ${name} tidak valid: ${parsed.reason}`);
    }
    entries.push(parsed.value);
  }
  return { header: header.value, entries, raw: lines };
}

export async function resetDatabase(): Promise<void> {
  closeDatabase();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      resolve();
    };
    request.onblocked = () => {
      resolve();
    };
  });
  closeDatabase();
}
