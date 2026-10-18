/**
 * Pengujian urutan kamus hasil seret: fungsi murni yang dipakai halaman pengaturan,
 * jadi perilakunya diuji tanpa DOM (drag & drop-nya sendiri diuji lewat e2e).
 */

import { describe, expect, it } from 'vitest';
import { reorderedIds } from '../../src/settings/order.js';

describe('reorderedIds', () => {
  const ids = ['a', 'b', 'c'];

  it('memindahkan kamus ke bawah melewati satu baris', () => {
    expect(reorderedIds(ids, 'a', 'b', 'after')).toEqual(['b', 'a', 'c']);
  });

  it('memindahkan kamus ke atas melewati satu baris', () => {
    expect(reorderedIds(ids, 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });

  it('memindahkan kamus ke ujung daftar', () => {
    expect(reorderedIds(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
  });

  it('mengembalikan urutan yang sama bila sisi jatuhnya adalah posisi sekarang', () => {
    expect(reorderedIds(ids, 'a', 'b', 'before')).toEqual(['a', 'b', 'c']);
  });

  it('mengabaikan seret ke dirinya sendiri dan ID yang tidak dikenal', () => {
    expect(reorderedIds(ids, 'a', 'a', 'after')).toEqual(['a', 'b', 'c']);
    expect(reorderedIds(ids, 'a', 'hilang', 'after')).toEqual(['a', 'b', 'c']);
    expect(reorderedIds(ids, 'hilang', 'b', 'after')).toEqual(['a', 'b', 'c']);
  });

  it('tidak mengubah array masukan', () => {
    const input = [...ids];
    reorderedIds(input, 'a', 'c', 'after');
    expect(input).toEqual(['a', 'b', 'c']);
  });
});
