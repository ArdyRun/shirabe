// @vitest-environment happy-dom
/** Pengujian penyelarasan furigana dari expression + reading (tampilan saja). */

import { describe, expect, it } from 'vitest';
import { alignFurigana, hasKanji } from '../../src/ui/furigana.js';

describe('alignFurigana', () => {
  it('membagi bacaan pada kanji yang diikuti okurigana', () => {
    expect(alignFurigana('食べる', 'たべる')).toEqual([
      { text: '食', ruby: 'た' },
      { text: 'べる' },
    ]);
  });

  it('memberi furigana seluruh kata bila hanya berisi kanji', () => {
    expect(alignFurigana('学生', 'がくせい')).toEqual([{ text: '学生', ruby: 'がくせい' }]);
  });

  it('mempertahankan kana di awal kata', () => {
    expect(alignFurigana('お茶', 'おちゃ')).toEqual([{ text: 'お' }, { text: '茶', ruby: 'ちゃ' }]);
  });

  it('memisahkan dua kanji dengan okurigana di antaranya', () => {
    expect(alignFurigana('取り出す', 'とりだす')).toEqual([
      { text: '取', ruby: 'と' },
      { text: 'り' },
      { text: '出', ruby: 'だ' },
      { text: 'す' },
    ]);
  });

  it('mengembalikan null bila okurigana tidak cocok', () => {
    expect(alignFurigana('食べる', 'たべます')).toBeNull();
  });

  it('mengembalikan null bila bacaan memuat kanji', () => {
    expect(alignFurigana('学生', '学生')).toBeNull();
    expect(alignFurigana('学問', '勉強')).toBeNull();
  });

  it('mengembalikan null bila tidak ada kanji yang perlu diberi furigana', () => {
    expect(alignFurigana('たべる', 'たべる')).toBeNull();
    expect(alignFurigana('', 'たべる')).toBeNull();
    expect(alignFurigana('食べる', '')).toBeNull();
  });

  it('mengenali keberadaan kanji', () => {
    expect(hasKanji('学生')).toBe(true);
    expect(hasKanji('がくせい')).toBe(false);
    expect(hasKanji('食べる')).toBe(true);
  });
});
