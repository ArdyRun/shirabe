/**
 * Disclosure rantai deinfleksi pada kartu entri.
 *
 * Pola tampilan mengikuti Hachidori: satu elemen `<details>` yang **tertutup** secara
 * bawaan, ringkasannya berisi jalur bentuk permukaan → bentuk kamus
 * (`聞こえてきた → 聞こえる`), dan daftar bernomor berisi langkah transformasi beserta
 * keterangannya. Semua teks ditulis sebagai `textContent`; deskripsi tidak pernah
 * diurai sebagai markup.
 *
 * Keterangan tiap langkah berasal dari tabel rule Shirabe (`-た`, `-て`, `-くる`, …),
 * jadi label yang tampil selalu sesuai transformasi yang benar-benar diterapkan
 * (PRD 4.4), bukan tebakan UI.
 */

import { transformDescriptionKey } from '../core/rules.js';
import type { DeinflectionStep } from '../core/types.js';
import { el } from './dom.js';
import { t } from './strings.js';

/** Batas jumlah langkah yang ditampilkan (pola Hachidori: 31 langkah + penanda `…`). */
export const MAX_INFLECTION_STEPS = 31;

/** Penanda bahwa masih ada langkah yang tidak ditampilkan. */
export const INFLECTION_OMITTED_MARKER = '…';

/**
 * Bangun disclosure infleksi; `null` bila tidak ada yang perlu dijelaskan
 * (tanpa langkah, atau bentuk permukaan sama dengan bentuk kamus).
 */
export function inflectionDisclosure(
  surface: string,
  lemma: string,
  steps: readonly DeinflectionStep[],
): HTMLElement | null {
  if (steps.length === 0 || surface.length === 0 || lemma.length === 0 || surface === lemma) {
    return null;
  }

  const why = t('results.inflectionWhy', { surface, lemma });
  const summary = el('summary', {
    className: 'inflection__summary',
    attrs: { title: why, 'aria-label': why },
  });
  summary.append(
    el('span', { className: 'inflection__endpoint', text: surface }),
    el('span', {
      className: 'inflection__arrow',
      text: '→',
      attrs: { 'aria-hidden': 'true' },
    }),
    el('span', { className: 'inflection__endpoint', text: lemma }),
  );

  const details = el('details', {
    className: 'inflection',
    attrs: {
      'data-role': 'inflection',
      'data-steps': String(steps.length),
      'data-surface': surface,
      'data-lemma': lemma,
    },
  });
  details.append(summary);

  const shown = steps.slice(0, MAX_INFLECTION_STEPS);
  const list = el('ol', {
    className: 'inflection__steps',
    attrs: { 'aria-label': t('results.inflectionSteps') },
  });
  for (const step of shown) {
    const item = el('li', {
      className: 'inflection__step',
      attrs: { 'data-transform': step.transformId, 'data-from': step.from, 'data-to': step.to },
    });
    item.append(el('span', { className: 'inflection__transform', text: step.transformId }));
    const descriptionKey = transformDescriptionKey(step.transformId);
    if (descriptionKey !== null) {
      item.append(
        el('span', {
          className: 'inflection__description',
          text: t(`inflect.desc.${descriptionKey}`),
        }),
      );
    }
    list.append(item);
  }
  if (steps.length > shown.length) {
    list.append(
      el('li', {
        className: 'inflection__step inflection__step--omitted',
        text: INFLECTION_OMITTED_MARKER,
        attrs: { 'aria-hidden': 'true' },
      }),
    );
  }
  details.append(list);

  return details;
}
