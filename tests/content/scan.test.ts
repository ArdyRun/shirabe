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
  it('memindai mulai dari karakter di bawah kursor, bukan sebelumnya', () => {
    // Kursor di 生: kandidat dimulai dari 生, bukan 学生 (aturan Hachidori/Yomitan untuk
    // bahasa tanpa spasi).
    const candidate = candidateFromText('私は学生です。', 3);
    expect(candidate?.query).toBe('生です');
    expect(candidate?.start).toBe(3);
    expect(candidate?.caretOffset).toBe(0);
  });

  it('tidak menyertakan kanji sebelum kursor (mode scan dari kursor)', () => {
    // Kursor di べ pada 食べたい: kandidat べたいです, bukan 食べたいです.
    const candidate = candidateFromText('きょうは食べたいです。', 5);
    expect(candidate?.query).toBe('べたいです');
    expect(candidate?.caretOffset).toBe(0);
  });

  it('kursor di kanji tetap mencakup okurigana sesudahnya', () => {
    const candidate = candidateFromText('食べる', 0);
    expect(candidate?.query).toBe('食べる');
    expect(candidate?.caretOffset).toBe(0);
  });

  it('kandidat pada rangkaian kana panjang mulai tepat di kursor', () => {
    const long = 'あ'.repeat(30);
    const candidate = candidateFromText(long, 29);
    expect(candidate?.query).toBe('あ');
    expect(candidate?.start).toBe(29);
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
    const candidate = candidateFromText('私は毎日日本語を勉強します。', 8);
    expect(candidate?.query).toBe('勉強します');
    expect(candidate?.caretOffset).toBe(0);
    expect(candidate?.start).toBe(8);
  });

  it('mengembalikan null bila posisi bukan bagian dari kata', () => {
    expect(candidateFromText('。、  ', 0)).toBeNull();
    expect(candidateFromText('', 0)).toBeNull();
  });

  it('tidak memotong surrogate pair', () => {
    const text = '\u{20000}\u{20000}';
    const candidate = candidateFromText(text, 1);
    expect(candidate?.query).toBe('\u{20000}');
    expect(candidate?.caretOffset).toBe(0);
  });

  it('mengambil kata latin untuk dataset yang memuatnya', () => {
    expect(candidateFromText('Tokyo tower', 0)?.query).toBe('Tokyo');
    // Kursor di tengah kata: kandidat mulai dari karakter itu (aturan yang sama).
    expect(candidateFromText('Tokyo tower', 2)?.query).toBe('kyo');
  });
});


describe('segmen tampilan kandidat', () => {
  it('memakai rentetan kelas kursor, bukan seluruh kalimat tanpa spasi', () => {
    const sentence = '陸上部だったので髪型はベリィショート';
    // Kursor di っ (karakter kedua): kandidat mulai dari っ, dan segmen tampilan adalah
    // rentetan hiragana dari kursor — bukan rangkaian tanpa spasi sampai akhir kalimat.
    const candidate = candidateFromText(sentence, sentence.indexOf('だった') + 1);
    expect(candidate?.query.startsWith('ったので')).toBe(true);
    expect(candidate?.segment).toBe('ったので');
  });

  it('segmen dimulai dari karakter di bawah kursor', () => {
    const candidate = candidateFromText('私は学生です', 3);
    expect(candidate?.segment).toBe('生');
  });

  it('memisahkan hiragana dan katakana sebagai kata berbeda', () => {
    const sentence = '髪型はベリィショート';
    const candidate = candidateFromText(sentence, sentence.indexOf('ベ') + 2);
    expect(candidate?.segment).toBe('ィショート');
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
  it('menggabungkan text node terpisah melalui text window, mulai dari kursor', () => {
    // Simulasi 食べ + ました pada dua span: window menyatukan keduanya, dan karena kursor
    // berada di べ, kandidat dimulai dari べ (tidak mundur ke 食).
    const left = '今日は';
    const right = '食べました';
    const joined = `${left}${right}`;
    const caretOffset = codePointLength(left) + 1;
    const candidate = candidateFromText(joined, caretOffset);
    expect(candidate?.query).toBe('べました');
    expect(candidate?.caretOffset).toBe(0);
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
