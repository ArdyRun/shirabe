/**
 * Sumber lookup in-memory untuk menguji search core tanpa IndexedDB/browser.
 */

import { normalizeQuery } from '../../src/core/text.js';
import type { DictionaryEntry, KanjiMatch, LookupSource, MetaMatch } from '../../src/core/types.js';

export interface MemoryEntryInput {
  expression: string;
  reading?: string;
  definitions?: string[];
  partOfSpeech?: string[];
  tags?: string[];
  rules?: string[];
  dictionaryId?: string;
  dictionaryName?: string;
  dictionaryOrder?: number;
}

export interface MemorySource extends LookupSource {
  entries: DictionaryEntry[];
  meta: MetaMatch[];
  kanji: KanjiMatch[];
}

/** Data meta/kanji yang dapat disuntikkan tes ke sumber in-memory. */
export interface MemoryAuxInput {
  meta?: MetaMatch[];
  kanji?: KanjiMatch[];
}

export function createMemorySource(
  inputs: readonly MemoryEntryInput[],
  aux: MemoryAuxInput = {},
): MemorySource {
  const entries: DictionaryEntry[] = inputs.map((input, index) => ({
    entryId: `${input.dictionaryId ?? 'mem'}:${index}`,
    dictionaryId: input.dictionaryId ?? 'mem',
    dictionaryName: input.dictionaryName ?? 'Kamus Memori',
    dictionaryOrder: input.dictionaryOrder ?? 0,
    expression: input.expression,
    reading: input.reading ?? '',
    definitions: input.definitions ?? ['definisi'],
    partOfSpeech: input.partOfSpeech ?? [],
    tags: input.tags ?? [],
    rules: input.rules ?? [],
  }));
  const meta = aux.meta ?? [];
  const kanji = aux.kanji ?? [];

  return {
    entries,
    meta,
    kanji,
    findExactExpression: async (text) => {
      const key = normalizeQuery(text);
      return entries.filter((entry) => normalizeQuery(entry.expression) === key);
    },
    findExactReading: async (text) => {
      const key = normalizeQuery(text);
      return entries.filter(
        (entry) => entry.reading.length > 0 && normalizeQuery(entry.reading) === key,
      );
    },
    findMeta: async (expressionNfc, readingNfc) =>
      meta.filter(
        (item) =>
          normalizeQuery(item.expression) === expressionNfc &&
          (item.reading.length === 0 || normalizeQuery(item.reading) === readingNfc),
      ),
    findKanji: async (character) => kanji.filter((item) => item.character === character),
  };
}
