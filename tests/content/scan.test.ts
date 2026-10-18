// @vitest-environment happy-dom
/**
 * Pengujian penentuan kandidat kata pada posisi kursor (PRD 4.1).
 *
 * Cuplikan kalimat tidak lagi dihitung maupun ditampilkan (lihat §4.14 audit), jadi
 * hanya pemilihan kandidat dan kelayakan elemen yang diuji di sini.
 */

import { describe, expect, it } from 'vitest';
import {
  candidateFromText,
  isEligibleElement,
  isNodeWithinElement,
} from '../../src/content/scan.js';
import { codePointLength } from '../../src/core/text.js';

describe('candidateFromText', () => {
  it('mengambil rangkaian kanji saat kursor berada di tengah kata', () => {
    const candidate = candidateFromText('私は学生です。', 3);
    expect(candidate?.query).toBe('学生です');
    expect(candidate?.start).toBe(2);
    expect(candidate?.caretOffset).toBe(1);
  });

  it('menyertakan rangkaian kanji sebelum kana untuk bentuk infleksi', () => {
    const candidate = candidateFromText('きょうは食べたいです。', 5);
    expect(candidate?.query).toBe('食べたいです');
    expect(candidate?.caretOffset).toBe(1);
  });

  it('membatasi lookback maksimum pada rangkaian kana panjang', () => {
    const long = 'あ'.repeat(30);
    const candidate = candidateFromText(long, 29);
    expect(codePointLength(candidate?.query ?? '')).toBe(17);
  });

  it('membatasi panjang kandidat 32 code point', () => {
    const long = '漢'.repeat(60);
    const candidate = candidateFromText(long, 0);
    expect(codePointLength(candidate?.query ?? '')).toBe(32);
  });

  it('berhenti pada tanda baca dan menyertakan posisi kursor', () => {
    // Rangkaian kanji yang berurutan dianggap satu kandidat (batas kata tidak dapat
    // ditentukan tanpa parser); search core memakai caretOffset untuk memilih kata
    // yang benar-benar berada di bawah kursor.
    const candidate = candidateFromText('私は毎日日本語を勉強します。', 6);
    expect(candidate?.query).toBe('毎日日本語を勉強します');
    expect(candidate?.caretOffset).toBe(4);
    expect(candidate?.start).toBe(2);
  });

  it('mengembalikan null bila posisi bukan bagian dari kata', () => {
    expect(candidateFromText('。、  ', 0)).toBeNull();
    expect(candidateFromText('', 0)).toBeNull();
  });

  it('tidak memotong surrogate pair', () => {
    const text = '\u{20000}\u{20000}';
    const candidate = candidateFromText(text, 1);
    expect(candidate?.query).toBe(text);
    expect(candidate?.caretOffset).toBe(1);
  });

  it('mengambil kata latin untuk dataset yang memuatnya', () => {
    const candidate = candidateFromText('Tokyo tower', 2);
    expect(candidate?.query).toBe('Tokyo');
  });
});


describe('segmen tampilan kandidat', () => {
  it('memakai rentetan kelas kursor, bukan seluruh kalimat tanpa spasi', () => {
    const sentence = '陸上部だったので髪型はベリィショート';
    const candidate = candidateFromText(sentence, sentence.indexOf('だった') + 1);
    expect(candidate?.query).toContain('だった');
    expect(candidate?.segment).toBe('だったので');
  });

  it('menyertakan kanji dasar kata sebelum kana (okurigana)', () => {
    const candidate = candidateFromText('食べる', 1);
    expect(candidate?.segment).toBe('食べる');
  });

  it('memakai rentetan kanji saat kursor di dalam kata kanji', () => {
    const candidate = candidateFromText('私は学生です', 3);
    expect(candidate?.segment).toBe('学生');
  });

  it('memisahkan hiragana dan katakana sebagai kata berbeda', () => {
    const sentence = '髪型はベリィショート';
    const candidate = candidateFromText(sentence, sentence.indexOf('ベ') + 2);
    expect(candidate?.segment).toBe('ベリィショート');
  });

  it('membatasi panjang segmen tampilan', () => {
    const long = `${'あ'.repeat(40)}`;
    const candidate = candidateFromText(long, 20);
    expect(codePointLength(candidate?.segment ?? '')).toBeLessThanOrEqual(12);
  });
});

describe('isNodeWithinElement', () => {
  it('menembus batas shadow DOM', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    if (host === null) {
      throw new Error('Host tidak ada.');
    }
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<span id="inner">teks</span>';
    const inner = shadow.getElementById('inner');
    const textNode = inner?.firstChild ?? null;
    expect(textNode).not.toBeNull();
    expect(isNodeWithinElement(textNode as Node, host)).toBe(true);
    expect(isNodeWithinElement(host, inner as Element)).toBe(false);
  });

  it('menolak text node di dalam shadow DOM input terhadap elemen input', () => {
    document.body.innerHTML = '<input id="field" value="学生" />';
    const field = document.getElementById('field');
    if (field === null) {
      throw new Error('Field tidak ada.');
    }
    // Simulasi chrome: caret berada di dalam shadow root internal input.
    const shadow = field.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div id="ua">学生</div>';
    const ua = shadow.getElementById('ua');
    expect(isNodeWithinElement(ua as Node, field)).toBe(true);
  });
});


describe('candidateFromText pada batas elemen', () => {
  it('menggabungkan kandidat dari text node terpisah melalui text window', () => {
    // Simulasi 食べ + ました pada dua span: window menyatukan keduanya sebelum kandidat dicari.
    const left = '今日は';
    const right = '食べました';
    const joined = `${left}${right}`;
    const caretOffset = codePointLength(left) + 1;
    const candidate = candidateFromText(joined, caretOffset);
    expect(candidate?.query).toBe('食べました');
    expect(candidate?.caretOffset).toBe(1);
  });
});

describe('isEligibleElement', () => {
  it('menolak area yang dapat diedit dan area yang diabaikan', () => {
    document.body.innerHTML = `
      <p id="text">学生</p>
      <input id="input" value="学生" />
      <textarea id="area">学生</textarea>
      <div id="editable" contenteditable="true">学生</div>
      <script id="script">学生</script>
      <div id="fake" contenteditable="false"><span id="child">学生</span></div>
    `;
    expect(isEligibleElement(document.getElementById('text'))).toBe(true);
    expect(isEligibleElement(document.getElementById('input'))).toBe(false);
    expect(isEligibleElement(document.getElementById('area'))).toBe(false);
    expect(isEligibleElement(document.getElementById('editable'))).toBe(false);
    expect(isEligibleElement(document.getElementById('script'))).toBe(false);
    expect(isEligibleElement(document.getElementById('child'))).toBe(true);
    expect(isEligibleElement(null)).toBe(false);
  });
});
