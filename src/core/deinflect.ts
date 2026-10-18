/**
 * Mesin deinflection berbasis tabel kondisi (PRD 4.4).
 *
 * Model mengikuti deinflector hoshidicts (Hachidori) dan Yomitan: dari satu bentuk
 * permukaan, mesin menelusuri rule secara breadth-first, mempertahankan **rantai
 * transformasi** yang dilalui. Kondisi awal adalah `ALL_CONDITIONS` (rule mana pun boleh
 * menjadi langkah pertama); langkah lanjutan hanya boleh bila kondisi hasil langkah
 * sebelumnya memenuhi `conditionsIn` rule tersebut.
 *
 * Contoh rantai yang didukung:
 *
 *   聞こえてきた → 聞こえてくる (-た) → 聞こえて (-くる) → 聞こえる (-て)
 *
 * Mesin ini murni: tidak ada I/O, tidak ada akses kamus. Validasi terhadap entry kamus
 * (termasuk pencocokan kelas kata) dilakukan oleh search core.
 */

import {
  ALL_CONDITIONS,
  DEINFLECTION_RULES,
  MAX_DEINFLECTION_ANALYSES,
  MAX_DEINFLECTION_DEPTH,
  POS_CONDITIONS,
  type DeinflectionRule,
} from './rules.js';
import type { DeinflectionAnalysis, DeinflectionStep } from './types.js';

export interface DeinflectOptions {
  /**
   * Kedalaman rantai maksimum. Default {@link MAX_DEINFLECTION_DEPTH}: cukup untuk
   * bentuk majemuk (mis. `食べていました` = -ました, -いる, -て).
   */
  maxDepth?: number;
  /** Batas jumlah analisis yang dikembalikan. */
  maxAnalyses?: number;
  rules?: readonly DeinflectionRule[];
}

interface Node {
  text: string;
  conditions: ReadonlySet<string>;
  steps: readonly DeinflectionStep[];
}

/** Kelas kata dari sekumpulan kondisi (kondisi bentuk tidak termasuk). */
function posOf(conditions: ReadonlySet<string>): string[] {
  return POS_CONDITIONS.filter((pos) => conditions.has(pos));
}

/** Semua analisis kandidat lema dari sebuah bentuk permukaan, terurut dari dangkal. */
export function deinflect(surface: string, options: DeinflectOptions = {}): DeinflectionAnalysis[] {
  const maxDepth = options.maxDepth ?? MAX_DEINFLECTION_DEPTH;
  const maxAnalyses = options.maxAnalyses ?? MAX_DEINFLECTION_ANALYSES;
  const rules = options.rules ?? DEINFLECTION_RULES;
  if (surface.length === 0) {
    return [];
  }

  const allConditions: ReadonlySet<string> = new Set(ALL_CONDITIONS);
  const analyses: DeinflectionAnalysis[] = [];
  const seenAnalyses = new Set<string>();
  const seenStates = new Set<string>();

  let frontier: Node[] = [{ text: surface, conditions: allConditions, steps: [] }];
  seenStates.add(`${surface}\u0000${[...allConditions].sort().join('|')}`);

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const rule of rules) {
        if (!node.text.endsWith(rule.from)) {
          continue;
        }
        if (!rule.conditionsIn.every((condition) => node.conditions.has(condition))) {
          continue;
        }
        const stem = node.text.slice(0, node.text.length - rule.from.length);
        const text = stem + rule.to;
        if (text.length === 0) {
          continue;
        }
        const steps = [
          ...node.steps,
          { transformId: rule.transform, from: rule.from, to: rule.to },
        ];
        const conditions: ReadonlySet<string> = new Set(rule.conditionsOut);
        const stateKey = `${text}\u0000${[...conditions].sort().join('|')}`;
        if (seenStates.has(stateKey)) {
          continue;
        }
        seenStates.add(stateKey);

        const partOfSpeech = posOf(conditions);
        const analysisKey = `${text}\u0000${partOfSpeech.join('|')}`;
        if (!seenAnalyses.has(analysisKey)) {
          seenAnalyses.add(analysisKey);
          analyses.push({ lemma: text, partOfSpeech, steps });
          if (analyses.length >= maxAnalyses) {
            return analyses;
          }
        }
        next.push({ text, conditions, steps });
      }
    }
    frontier = next;
  }

  return analyses;
}
