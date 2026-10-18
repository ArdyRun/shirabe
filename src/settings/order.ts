/**
 * Urutan kamus setelah satu baris dipindahkan dengan seret (drag and drop).
 *
 * Dipisah dari halaman pengaturan supaya perhitungan urutannya murni dan diuji tanpa DOM:
 * halaman hanya menyediakan posisi baris, fungsi ini yang menentukan urutan ID yang dikirim
 * ke `DICTIONARY_REORDER`.
 */

/** Sisi relatif terhadap baris tujuan: sebelum atau sesudah. */
export type DropSide = 'before' | 'after';

/**
 * Pindahkan `draggedId` ke posisi relatif `targetId`.
 *
 * ID yang tidak dikenal (kamus dihapus di tab lain) membuat urutan dikembalikan apa adanya,
 * sehingga seret yang tidak masuk akal tidak pernah mengirim urutan rusak ke storage.
 */
export function reorderedIds(
  ids: readonly string[],
  draggedId: string,
  targetId: string,
  side: DropSide,
): string[] {
  if (draggedId === targetId || !ids.includes(draggedId) || !ids.includes(targetId)) {
    return [...ids];
  }
  const without = ids.filter((id) => id !== draggedId);
  const targetIndex = without.indexOf(targetId);
  without.splice(side === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId);
  return without;
}
