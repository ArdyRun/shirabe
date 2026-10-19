/**
 * Content script Shirabe (PRD 4.1, 6.1).
 *
 * Dari manifest, script ini berjalan di semua halaman http/https (seperti Yomitan dan
 * Hachidori), jadi tidak ada permintaan izin per situs maupun pendaftaran dinamis.
 * Pengguna tetap dapat mematikannya lewat `scanAllSites` (global) atau daftar
 * pengecualian per origin; preferensi dibaca langsung dari `chrome.storage.local` dan
 * dipantau perubahannya, sehingga script dapat berhenti/mulai tanpa bergantung pada
 * service worker.
 *
 * Tanggung jawab: menentukan kata kandidat pada posisi pointer, meminta lookup, menyorot
 * kata itu di halaman, dan menampilkan popup terisolasi. Hanya kueri (kata kandidat) yang
 * dikirim ke service worker; teks halaman di sekitar kursor tidak pernah dikirim maupun
 * disimpan. Dataset kamus tidak pernah dimuat di sini.
 */

import {
  DEFAULT_PREFERENCES,
  SETTINGS_STORAGE_KEY,
  sanitizePreferences,
  type Preferences,
} from '../core/preferences.js';
import { originFromUrl } from '../core/site.js';
import {
  codePointLength,
  codePointToUtf16Index,
  sliceCodePoints,
  // textWindowAt menyatukan text node tetangga dalam satu blok DOM.
} from '../core/text.js';
import {
  buildMessage,
  errorResponse,
  isExtensionContextInvalidated,
  isResponseEnvelope,
  requestId,
  type ExtensionMessage,
  type MessageError,
  type MessageType,
  type RectLike,
  type RequestPayload,
  type LookupSourceKind,
  type ResponseData,
} from '../messaging/protocol.js';
import type { LookupMatch } from '../core/types.js';
import { errorMessage, setLanguage } from '../ui/strings.js';
import { SourceHighlight } from './highlight.js';
import { ContentPopup, type PopupAnchor } from './popup.js';
import { candidateFromText, elementFromNode, isEligibleElement } from './scan.js';
import { createThrottle } from './throttle.js';

/**
 * Jarak minimum antar pemindaian saat modifier ditahan (ms).
 *
 * Ini **throttle**, bukan debounce: timer tidak di-restart setiap `pointermove`, sehingga
 * popup tetap mengikuti kursor waktu pengguna menyapu beberapa kata berturut-turut. Dengan
 * debounce, setiap gerakan membatalkan pemindaian dan popup baru muncul setelah kursor
 * berhenti — perbedaan yang terasa jelas dibanding Hachidori, yang memakai pola throttle
 * yang sama (`content.js`: "at most one scan per hoverDelayMs, always at the pointer's
 * latest position"). Nilainya tidak 0 karena satu pemindaian dapat memicu lookup ke service
 * worker + render ulang popup; 40 ms membatasi laju ±25 scan/detik, sementara lookup untuk
 * kata yang sama tetap dilewati oleh deduplikasi node + offset.
 */
const SCAN_THROTTLE_MS = 40;
/** Tampilkan status memuat hanya bila lookup terasa lambat. */
const LOADING_DELAY_MS = 150;





interface PointedText {
  node: Text;
  codePointOffset: number;
}

/**
 * Rentang kandidat hasil pemindaian di dalam jendela teks blok.
 *
 * Disimpan agar sorotan dapat dipersempit ke bagian kueri yang benar-benar cocok dengan
 * entri (`学生です` → `学生`), sama seperti `highlightText` Hachidori.
 */
interface ScanSpan {
  segments: readonly WindowSegment[];
  /** Awal kandidat dalam teks jendela (code point). */
  start: number;
  /** Akhir kandidat (eksklusif, code point). */
  end: number;
}

class ContentScanner {
  #popup: ContentPopup;
  #preferences: Preferences = { ...DEFAULT_PREFERENCES };
  #running = false;
  #lastPointer: { x: number; y: number } | null = null;
  #hoverThrottle = createThrottle(SCAN_THROTTLE_MS, () => {
    this.#scanAtPointer();
  });
  #hideTimer: number | null = null;
  #loadingTimer: number | null = null;
  #pointerInPopup = false;
  #requestCounter = 0;
  #lastHoverNode: Text | null = null;
  #lastHoverOffset = -1;
  #sourceRange: Range | null = null;
  /** Rentang kata yang sedang di-lookup (disorot selama popup terbuka). */
  #matchRange: Range | null = null;
  /** Kandidat pindai terakhir, untuk mempersempit sorotan ke bagian yang cocok. */
  #matchSpan: ScanSpan | null = null;
  #highlight: SourceHighlight;
  #shownQuery: string | null = null;
  #shownAnchor: PopupAnchor | null = null;

  constructor() {
    this.#highlight = new SourceHighlight(this.#preferences.theme);
    this.#popup = new ContentPopup({
      width: this.#preferences.popupWidth,
      maxHeight: this.#preferences.popupMaxHeight,
      theme: this.#preferences.theme,
      // Klik kanji pada headword kartu = lookup kanji tunggal (pola `jl-kanji-link`).
      onKanjiClick: (kanji) => {
        const anchor = this.#shownAnchor;
        if (anchor === null) {
          return;
        }
        void this.#performLookup(kanji, 'kanji', anchor, null, null);
      },
      // Pegangan ubah ukuran menyimpan lebar ke preferensi (satu sumber kebenaran).
      onResize: (width) => {
        this.#preferences = { ...this.#preferences, popupWidth: width };
        void sendMessage('SETTINGS_SET', { changes: { popupWidth: width } }).catch(() => undefined);
      },
    });
    this.#popup.host.addEventListener('mouseenter', () => {
      this.#pointerInPopup = true;
      this.#cancelHide();
    });
    this.#popup.host.addEventListener('mouseleave', () => {
      // Sengaja tidak menjadwalkan penutupan di sini: saat popup diposisikan ulang, event
      // `mouseleave` dapat terpicu walau kursor tidak benar-benar pergi, sehingga popup
      // yang baru tampil ikut tertutup. Penutupan dijadwalkan dari `mousemove` yang
      // membawa koordinat kursor.
      this.#pointerInPopup = false;
    });
    this.#popup.onClose(() => {
      this.#shownQuery = null;
      this.#shownAnchor = null;
      // Sorotan kata ikut hilang bersama popup, seperti Hachidori.
      this.#matchRange = null;
      this.#matchSpan = null;
      this.#highlight.clear();
      // Bila popup ditutup, kata yang sama harus dapat dipindai ulang.
      this.#lastHoverNode = null;
      this.#lastHoverOffset = -1;
    });
  }

  /** Mulai memantau preferensi dan mulai memindai bila situs ini diizinkan. */
  start(): void {
    chrome.storage.onChanged.addListener(this.#onStorageChanged);
    void this.#loadPreferences();
  }

  /** Hentikan pemindaian sepenuhnya (dipakai saat extension di-reload/dimatikan). */
  stop(): void {
    chrome.storage.onChanged.removeListener(this.#onStorageChanged);
    this.#stopScanning();
    this.#popup.close();
  }

  #startScanning(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    document.documentElement.append(this.#popup.host);
    document.addEventListener('pointermove', this.#onMouseMove, { passive: true, capture: true });
    document.addEventListener('pointerdown', this.#onPointerDown, true);
    document.addEventListener('keydown', this.#onKeyDown, true);
    document.addEventListener('keyup', this.#onKeyUp, true);
    document.addEventListener('mousedown', this.#onMouseDown, true);
    window.addEventListener('scroll', this.#onViewportChange, { passive: true });
    window.addEventListener('resize', this.#onViewportChange, { passive: true });
  }

  /**
   * Hentikan pemindaian.
   *
   * `keepPopup` dipakai ketika konteks extension sudah mati: penjelasan yang sedang
   * tampil harus tetap bisa dibaca, jadi popup tidak ditutup dan host-nya tidak dilepas.
   */
  #stopScanning(options: { keepPopup?: boolean } = {}): void {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    document.removeEventListener('pointermove', this.#onMouseMove, true);
    document.removeEventListener('pointerdown', this.#onPointerDown, true);
    document.removeEventListener('keydown', this.#onKeyDown, true);
    document.removeEventListener('keyup', this.#onKeyUp, true);
    document.removeEventListener('mousedown', this.#onMouseDown, true);
    window.removeEventListener('scroll', this.#onViewportChange);
    window.removeEventListener('resize', this.#onViewportChange);
    this.#cancelHover();
    this.#cancelHide();
    this.#clearLoading();
    this.#matchRange = null;
    this.#highlight.dispose();
    if (options.keepPopup === true) {
      return;
    }
    this.#popup.close();
    this.#popup.host.remove();
  }

  /** Tampilkan lookup untuk teks terpilih (dipanggil dari menu konteks browser). */
  showSelectionLookup(query: string, source: LookupSourceKind): void {
    const selection = window.getSelection();
    const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const anchor = anchorFromRange(range) ?? {
      left: 8,
      top: 8,
      bottom: 24,
      height: 16,
    };
    void this.#performLookup(query, source, anchor, range, null, null);
  }

  /** Teks terpilih saat ini beserta posisinya (dipakai action popup). */
  readSelection(): { text: string; rect: RectLike | null } {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) {
      return { text: '', rect: null };
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return {
      text: selection.toString().trim(),
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
      },
    };
  }

  async #loadPreferences(): Promise<void> {
    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
    this.#applyPreferences(sanitizePreferences(stored[SETTINGS_STORAGE_KEY]));
  }

  #onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local' || !(SETTINGS_STORAGE_KEY in changes)) {
      return;
    }
    this.#applyPreferences(sanitizePreferences(changes[SETTINGS_STORAGE_KEY]?.newValue));
  };

  #applyPreferences(preferences: Preferences): void {
    this.#preferences = preferences;
    setLanguage(preferences.uiLanguage);
    this.#popup.configure({
      width: preferences.popupWidth,
      maxHeight: preferences.popupMaxHeight,
      theme: preferences.theme,
    });
    this.#highlight.setThemePreference(preferences.theme);
    const origin = originFromUrl(window.location.href);
    const enabledHere = origin !== null && preferences.sites[origin]?.enabled !== false;
    if (preferences.scanAllSites && enabledHere) {
      this.#startScanning();
    } else {
      this.#stopScanning();
    }
  }

  #modifierHeld(event: MouseEvent): boolean {
    switch (this.#preferences.scanModifier) {
      case 'Control':
        return event.ctrlKey;
      case 'Shift':
        return event.shiftKey;
      case 'Meta':
        return event.metaKey;
      case 'Alt':
      default:
        return event.altKey;
    }
  }

  #onMouseMove = (event: MouseEvent): void => {
    if (!this.#running) {
      return;
    }
    this.#lastPointer = { x: event.clientX, y: event.clientY };
    // Catatan: pointer di atas popup TIDAK menghentikan pemindaian. Flag `#pointerInPopup`
    // hanya mencegah popup menutup sendiri; dulu flag ini juga memblokir scan sehingga
    // popup tidak mau memperbarui saat kursor diarahkan ke kata lain.
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) {
      // Jangan memindai saat pengguna sedang menyorot teks.
      return;
    }
    if (!this.#modifierHeld(event)) {
      this.#popup.setPointerInteractive(true);
      this.#scheduleHide();
      return;
    }
    // Pemindaian aktif: popup tidak boleh menghalangi hit-test teks di bawahnya.
    this.#popup.setPointerInteractive(false);
    this.#cancelHide();
    // Hit-test (elementFromPoint + caretPositionFromPoint) sengaja TIDAK dilakukan di sini:
    // satu pemindaian per `SCAN_THROTTLE_MS` cukup, dan itu memindahkan biaya layout dari
    // setiap event pointer ke sekali per jeda.
    this.#scheduleHover();
  };

  /** Klik dengan modifier juga memicu scan segera (pola Yomitan pointerdown). */
  #onPointerDown = (event: PointerEvent): void => {
    this.#lastPointer = { x: event.clientX, y: event.clientY };
    if (!this.#running || !this.#modifierHeld(event) || this.#pointerInPopup) {
      return;
    }
    const point = pointedTextAt(event.clientX, event.clientY);
    if (point !== null && isEligibleElement(elementFromNode(point.node))) {
      this.#cancelHover();
      this.#cancelHide();
      this.#handleHoverPoint(point.node, point.codePointOffset);
    }
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    if (this.#popup.isOpen && this.#popup.handleKey(event)) {
      // Pengguna sedang berinteraksi dengan popup: batalkan scan/penutupan tertunda agar
      // tampilan detail atau pilihan yang sedang dibaca tidak ter-reset.
      this.#cancelHover();
      this.#cancelHide();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.#isModifierKey(event)) {
      // Modifier ditahan = niat memindai; popup dibuat transparan terhadap pointer.
      this.#popup.setPointerInteractive(false);
    }
    // Menahan modifier tanpa menggerakkan pointer tetap harus memicu scan (perilaku yang
    // sama dengan opsi `scanWithoutMousemove` Yomitan dan `scanActivatedPointer` Hachidori).
    if (!this.#popup.isOpen && this.#isModifierKey(event) && this.#lastPointer !== null) {
      const point = pointedTextAt(this.#lastPointer.x, this.#lastPointer.y);
      if (point !== null && isEligibleElement(elementFromNode(point.node))) {
        this.#cancelHide();
        this.#handleHoverPoint(point.node, point.codePointOffset);
      }
      return;
    }
    void event;
  };

  #onKeyUp = (event: KeyboardEvent): void => {
    if (this.#isModifierKey(event, true)) {
      // Modifier dilepas = niat membaca/mengklik hasil; popup kembali interaktif.
      this.#popup.setPointerInteractive(true);
    }
  };

  /** Benar bila tombol yang ditekan adalah tombol modifier scan yang dikonfigurasi. */
  #isModifierKey(event: KeyboardEvent, forRelease = false): boolean {
    if (event.repeat && !forRelease) {
      return false;
    }
    switch (this.#preferences.scanModifier) {
      case 'Control':
        return event.key === 'Control';
      case 'Shift':
        return event.key === 'Shift';
      case 'Meta':
        return event.key === 'Meta';
      case 'Alt':
      default:
        return event.key === 'Alt';
    }
  }

  #onMouseDown = (event: MouseEvent): void => {
    if (this.#popup.isOpen && !this.#popup.ownsTarget(event.target)) {
      this.#popup.close();
    }
  };

  #onViewportChange = (): void => {
    if (!this.#popup.isOpen || this.#sourceRange === null) {
      return;
    }
    const anchor = anchorFromRange(this.#sourceRange);
    if (anchor === null) {
      this.#popup.close();
      return;
    }
    // Hanya reposisi: tampilan detail atau pilihan yang sedang dibaca tidak boleh direset.
    this.#popup.reposition(anchor);
  };

  /** Jadwalkan pemindaian pada posisi pointer terbaru (lihat `createThrottle`). */
  #scheduleHover(): void {
    this.#hoverThrottle.schedule();
  }

  /** Hit-test di posisi pointer terakhir, lalu scan bila titiknya kata yang layak. */
  #scanAtPointer(): void {
    const pointer = this.#lastPointer;
    if (pointer === null) {
      return;
    }
    const point = pointedTextAt(pointer.x, pointer.y);
    if (point === null || !isEligibleElement(elementFromNode(point.node))) {
      this.#scheduleHide();
      return;
    }
    if (this.#lastHoverNode === point.node && this.#lastHoverOffset === point.codePointOffset) {
      return;
    }
    this.#lastHoverNode = point.node;
    this.#lastHoverOffset = point.codePointOffset;
    this.#handleHoverPoint(point.node, point.codePointOffset);
  }

  #cancelHover(): void {
    this.#hoverThrottle.cancel();
  }

  #scheduleHide(): void {
    this.#cancelHide();
    if (!this.#popup.isOpen) {
      return;
    }
    this.#hideTimer = window.setTimeout(() => {
      this.#hideTimer = null;
      if (!this.#pointerInPopup) {
        this.#popup.close();
      }
    }, this.#preferences.popupHideDelayMs);
  }

  #cancelHide(): void {
    if (this.#hideTimer !== null) {
      window.clearTimeout(this.#hideTimer);
      this.#hideTimer = null;
    }
  }

  #handleHoverPoint(node: Text, codePointOffset: number): void {
    const window = textWindowAt(node, codePointOffset);
    if (window === null) {
      return;
    }
    const candidate = candidateFromText(window.text, window.caretOffset);
    if (candidate === null) {
      return;
    }
    const range = rangeForWindow(window.segments, candidate.start, candidate.end);
    // Anchor = posisi kursor (rect pertama range di posisi kursor), bukan rentang kandidat:
    // kandidat dapat memanjang/memendek saat kursor menyapu satu kata sehingga popup akan
    // meloncat. Lihat catatan pada `caretRangeAt`.
    const caretRange = caretRangeAt(node, codePointOffset);
    const anchor = anchorFromRange(caretRange) ?? anchorFromRange(range);
    if (anchor === null) {
      return;
    }
    void this.#performLookup(
      candidate.query,
      'hover',
      anchor,
      caretRange ?? range,
      candidate.caretOffset,
      { segments: window.segments, start: candidate.start, end: candidate.end },
      candidate.segment,
    );
  }

  async #performLookup(
    query: string,
    source: LookupSourceKind,
    anchor: PopupAnchor,
    anchorRange: Range | null = null,
    caretOffset: number | null = null,
    span: ScanSpan | null = null,
    displayQuery: string | null = null,
  ): Promise<void> {
    // Scan ulang tidak berguna ketika popup masih menampilkan kata yang sama *pada posisi
    // kursor yang sama*, dan berbahaya: timer hover yang tertunda dapat menimpa tampilan
    // yang sedang dibaca (mis. detail yang baru dibuka dengan Enter). Namun bila kursor
    // berpindah ke karakter lain — walau kata yang cocok masih sama — lookup harus jalan
    // lagi supaya popup mengikuti kursor seperti Yomitan, bukan terpaku di posisi lama.
    if (
      this.#popup.isOpen &&
      source === 'hover' &&
      query === this.#shownQuery &&
      anchorEquals(this.#shownAnchor, anchor)
    ) {
      return;
    }
    const shownQuery = displayQuery !== null && displayQuery.length > 0 ? displayQuery : query;
    const requestNumber = (this.#requestCounter += 1);
    // Range anchor dipakai untuk reposisi saat halaman digulir/di-zoom; rentang kata
    // yang dipindai dipakai untuk sorotan.
    this.#sourceRange = anchorRange;
    this.#matchSpan = span;
    this.#matchRange = span === null ? anchorRange : rangeForWindow(span.segments, span.start, span.end);
    this.#highlight.show(this.#matchRange ?? anchorRange);
    this.#showLoadingLater(requestNumber, shownQuery, anchor);

    const response = await sendMessage('LOOKUP', { query, source, caretOffset });
    this.#clearLoading();
    if (requestNumber !== this.#requestCounter) {
      // Ada permintaan yang lebih baru: hasil kedaluwarsa tidak ditampilkan.
      return;
    }
    if (!response.ok) {
      this.#popup.show(
        {
          query: shownQuery,
          source,
          result: null,
          status: errorMessage(response.error.code, response.error.message),
        },
        anchor,
      );
      this.#shownQuery = query;
      this.#shownAnchor = anchor;
      this.#cancelHide();
      if (response.error.code === 'CONTEXT_INVALIDATED') {
        // Tidak ada gunanya memindai lagi: setiap permintaan akan gagal sampai halaman
        // dimuat ulang. Hentikan pemindaian, tetapi biarkan popup penjelasan tetap tampil.
        this.#stopScanning({ keepPopup: true });
      }
      return;
    }
    // Sorotan dipersempit ke bagian kueri yang cocok dengan entri yang tampil.
    this.#highlight.show(this.#matchRangeFor(query, response.data.matches[0]) ?? this.#matchRange);
    // Pesan "tidak ada hasil" memakai teks yang ditampilkan (segmen kursor), bukan
    // seluruh rangkaian tanpa spasi yang dikirim ke service worker.
    const result = response.data.matches.length > 0
      ? response.data
      : { ...response.data, query: shownQuery };
    this.#popup.show({ query: shownQuery, source, result }, anchor);
    this.#shownQuery = query;
    this.#shownAnchor = anchor;
    this.#cancelHide();
  }

  /**
   * Rentang sorotan untuk hasil lookup: bagian kandidat yang benar-benar cocok dengan
   * entri. Kueri seperti `学生です` (tanpa spasi) menghasilkan entri `学生`, dan sorotan
   * harus menunjuk `学生` — bukan seluruh kandidat.
   */
  #matchRangeFor(query: string, match: LookupMatch | undefined): Range | null {
    const span = this.#matchSpan;
    if (span === null || match === undefined) {
      return null;
    }
    const offset = matchOffsetInQuery(query, match.matchedText);
    const length = codePointLength(match.matchedText);
    if (offset < 0 || length === 0 || span.start + offset + length > span.end) {
      return null;
    }
    return rangeForWindow(span.segments, span.start + offset, span.start + offset + length);
  }

  #showLoadingLater(requestNumber: number, query: string, anchor: PopupAnchor): void {
    this.#clearLoading();
    this.#loadingTimer = window.setTimeout(() => {
      this.#loadingTimer = null;
      if (requestNumber !== this.#requestCounter) {
        return;
      }
      this.#popup.show({
        query,
        source: 'hover',
        result: null,
        status: 'Mencari…',
        loading: true,
      }, anchor);
      this.#cancelHide();
    }, LOADING_DELAY_MS);
  }

  #clearLoading(): void {
    if (this.#loadingTimer !== null) {
      window.clearTimeout(this.#loadingTimer);
      this.#loadingTimer = null;
    }
  }
}

const MAX_TEXT_WINDOW_CODE_POINTS = 1200;
const MAX_TEXT_WINDOW_NODES = 200;

interface WindowSegment {
  node: Text;
  /** Teks potongan ini (bisa hanya sebagian dari `node`). */
  text: string;
  /**
   * Offset awal potongan di dalam `node` (UTF-16).
   *
   * Satu text node dapat dipecah menjadi dua potongan (sebelum/sesudah posisi kursor),
   * dan potongan pertama dapat dipotong lagi agar jendela teks tetap terbatas. Tanpa
   * offset ini, offset potongan disalahartikan sebagai offset node dan rentang yang
   * dihasilkan menjadi lebih pendek dari kandidat kata.
   */
  nodeOffset: number;
  /** Offset awal potongan di dalam teks jendela (code point). */
  start: number;
  length: number;
}

interface TextWindow {
  text: string;
  caretOffset: number;
  segments: WindowSegment[];
}


/**
 * Bentuk satu text window lintas text node dalam blok DOM yang sama.
 * Mengambil paling banyak 1200 code point sebelum + sesudah posisi kursor; kandidat
 * lookup sendiri tetap dibatasi 32 code point oleh search core.
 */
function textWindowAt(target: Text, targetOffset: number): TextWindow | null {
  const block = blockElementForComposed(target);
  if (block === null) {
    const length = codePointLength(target.data);
    return {
      text: target.data,
      caretOffset: Math.min(Math.max(targetOffset, 0), length),
      segments: [{ node: target, text: target.data, nodeOffset: 0, start: 0, length }],
    };
  }

  const walker = target.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const before: Array<{ node: Text; text: string; nodeOffset: number }> = [];
  let beforeCount = 0;
  let foundTarget = false;
  let current = walker.nextNode();
  while (current !== null) {
    const node = current as Text;
    if (node === target) {
      foundTarget = true;
      break;
    }
    if (blockElementForComposed(node) === block && isEligibleElement(elementFromNode(node))) {
      const length = codePointLength(node.data);
      if (length > 0) {
        before.push({ node, text: node.data, nodeOffset: 0 });
        beforeCount += length;
        while (beforeCount > MAX_TEXT_WINDOW_CODE_POINTS) {
          const first = before[0];
          if (first === undefined) break;
          const firstLength = codePointLength(first.text);
          const excess = beforeCount - MAX_TEXT_WINDOW_CODE_POINTS;
          if (firstLength <= excess) {
            before.shift();
            beforeCount -= firstLength;
          } else {
            // Offset node ikut bergeser sepanjang bagian yang dibuang.
            first.nodeOffset += codePointToUtf16Index(first.text, excess);
            first.text = sliceCodePoints(first.text, excess);
            beforeCount -= excess;
          }
        }
        if (before.length > MAX_TEXT_WINDOW_NODES) {
          const removed = before.shift();
          if (removed !== undefined) beforeCount -= codePointLength(removed.text);
        }
      }
    }
    current = walker.nextNode();
  }
  if (!foundTarget) {
    return null;
  }

  const clampedOffset = Math.min(Math.max(targetOffset, 0), codePointLength(target.data));
  const prefix = sliceCodePoints(target.data, 0, clampedOffset);
  const suffix = sliceCodePoints(target.data, clampedOffset);
  const prefixUtf16Length = codePointToUtf16Index(target.data, clampedOffset);
  const rawSegments: Array<{ node: Text; text: string; nodeOffset: number }> = [...before];
  if (prefix.length > 0) rawSegments.push({ node: target, text: prefix, nodeOffset: 0 });
  if (suffix.length > 0) {
    rawSegments.push({ node: target, text: suffix, nodeOffset: prefixUtf16Length });
  }

  let afterCount = codePointLength(suffix);
  current = walker.nextNode();
  while (current !== null && afterCount < MAX_TEXT_WINDOW_CODE_POINTS && rawSegments.length < MAX_TEXT_WINDOW_NODES) {
    const node = current as Text;
    if (blockElementForComposed(node) === block && isEligibleElement(elementFromNode(node))) {
      const remaining = MAX_TEXT_WINDOW_CODE_POINTS - afterCount;
      const length = codePointLength(node.data);
      const text = length > remaining ? sliceCodePoints(node.data, 0, remaining) : node.data;
      if (text.length > 0) {
        rawSegments.push({ node, text, nodeOffset: 0 });
        afterCount += codePointLength(text);
      }
    }
    current = walker.nextNode();
  }

  const segments: WindowSegment[] = [];
  let text = '';
  let caretOffset = beforeCount + codePointLength(prefix);
  let start = 0;
  for (const segment of rawSegments) {
    const length = codePointLength(segment.text);
    segments.push({ ...segment, start, length });
    text += segment.text;
    start += length;
  }
  caretOffset = Math.min(caretOffset, start);
  return { text, caretOffset, segments };
}

function domPointAtCodePoint(
  segments: readonly WindowSegment[],
  codePointOffset: number,
  isEnd: boolean,
): { node: Text; offset: number } | null {
  for (const segment of segments) {
    const segmentEnd = segment.start + segment.length;
    if (codePointOffset < segmentEnd || (!isEnd && codePointOffset === segment.start)) {
      const localOffset = Math.min(Math.max(codePointOffset - segment.start, 0), segment.length);
      return {
        node: segment.node,
        offset: segment.nodeOffset + codePointToUtf16Index(segment.text, localOffset),
      };
    }
    if (isEnd && codePointOffset === segmentEnd) {
      return {
        node: segment.node,
        offset: segment.nodeOffset + codePointToUtf16Index(segment.text, segment.length),
      };
    }
  }
  return null;
}

/** Buat Range lintas text node untuk posisi popup dan highlight. */
function rangeForWindow(segments: readonly WindowSegment[], start: number, end: number): Range | null {
  const startPoint = domPointAtCodePoint(segments, start, false);
  const endPoint = domPointAtCodePoint(segments, end, true);
  if (startPoint === null || endPoint === null) return null;
  const range = startPoint.node.ownerDocument.createRange();
  try {
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    return range;
  } catch {
    return null;
  }
}

/** Elemen block dalam shadow tree; berjalan naik dengan composed parent. */
function blockElementForComposed(node: Text): Element | null {
  let current: Node | null = node;
  let nearest: Element | null = null;
  for (let depth = 0; current !== null && depth < 12; depth += 1) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element;
      nearest = element;
      const display = element.ownerDocument.defaultView?.getComputedStyle(element).display;
      if (display !== undefined && display !== 'inline' && display !== 'contents') return element;
    }
    if (current.parentNode !== null) {
      if (current.parentNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in current.parentNode) {
        return nearest;
      }
      current = current.parentNode;
    } else {
      const root = current.getRootNode();
      current = 'host' in root ? (root as ShadowRoot).host : null;
    }
  }
  return nearest;
}

/**
 * Node + offset pada posisi pointer, dengan text node tetangga dalam satu blok.
 * `caretPositionFromPoint` menerima daftar open shadow root (Chrome 120+); fallback
 * `caretRangeFromPoint` tetap tersedia untuk dokumen biasa.
 */
function pointedTextAt(clientX: number, clientY: number): PointedText | null {
  const hit = document.elementFromPoint(clientX, clientY);
  if (hit === null || !isEligibleElement(hit)) return null;
  const fromCaret = caretTextAt(clientX, clientY, hit);
  if (fromCaret === null) {
    return null;
  }
  // Pada batas antar elemen, caret API kadang mengembalikan text node tetangga yang tidak
  // strict-descendant dari elemen teratas (mis. link + span, browser annotation, overlay
  // transparan). Tolak hanya bila elemen node caret sendiri editable/diabaikan; elemen hit
  // di atas sudah divalidasi, sehingga nilai kontrol formulir tetap terlindungi.
  if (!isEligibleElement(elementFromNode(fromCaret.node))) {
    return null;
  }
  return fromCaret;
}

function openShadowRootsAtPoint(hit: Element, clientX: number, clientY: number): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  const seen = new Set<ShadowRoot>();
  const visit = (element: Element): void => {
    let current: Element | null = element;
    while (current !== null) {
      const root = current.shadowRoot;
      if (root !== null && !seen.has(root)) {
        seen.add(root);
        roots.push(root);
        const nested = root as ShadowRoot & { elementsFromPoint?: (x: number, y: number) => Element[] };
        for (const child of nested.elementsFromPoint?.(clientX, clientY) ?? []) visit(child);
      }
      current = current.parentElement;
    }
  };
  visit(hit);
  return roots;
}

function caretTextAt(clientX: number, clientY: number, hit: Element): PointedText | null {
  const withCaret = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
      options?: { shadowRoots: ShadowRoot[] },
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof withCaret.caretPositionFromPoint === 'function') {
    const position = withCaret.caretPositionFromPoint(clientX, clientY, {
      shadowRoots: openShadowRootsAtPoint(hit, clientX, clientY),
    });
    if (position !== null && position.offsetNode.nodeType === Node.TEXT_NODE) {
      return pointedTextAtOffset(position.offsetNode as Text, position.offset, clientX, clientY);
    }
    return null;
  }
  const range = withCaret.caretRangeFromPoint?.(clientX, clientY) ?? null;
  if (range !== null && range.startContainer.nodeType === Node.TEXT_NODE) {
    return pointedTextAtOffset(range.startContainer as Text, range.startOffset, clientX, clientY);
  }
  return null;
}

/**
 * Titik teks dari caret API, digeser ke karakter yang benar-benar ada di bawah pointer.
 *
 * `caretPositionFromPoint` mengembalikan **posisi sisipan**: menunjuk separuh kanan sebuah
 * karakter memberi offset setelah karakter itu, sehingga pemindaian akan mulai dari
 * karakter berikutnya. Bila pointer berada di dalam kotak karakter sebelum caret, offset
 * digeser mundur satu karakter — pola yang sama dengan `alignToCharacter` Hachidori
 * (`extension/content.js`), dan itu yang membuat "scan mulai dari kursor" tidak bergantung
 * pada separuh glyph mana yang kena.
 */
function pointedTextAtOffset(
  node: Text,
  offset: number,
  clientX: number,
  clientY: number,
): PointedText {
  const aligned = alignCaretToPoint(node, offset, clientX, clientY);
  return { node, codePointOffset: codePointLength(node.data.slice(0, aligned)) };
}

function alignCaretToPoint(node: Text, offset: number, clientX: number, clientY: number): number {
  if (offset === 0) {
    return offset;
  }
  const probe = document.createRange();
  try {
    probe.setStart(node, offset - 1);
    probe.setEnd(node, offset);
  } catch {
    return offset;
  }
  for (const rect of probe.getClientRects()) {
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return offset - 1;
    }
  }
  return offset;
}

/** Bandingkan dua anchor dengan toleransi sub-piksel. */
function anchorEquals(a: PopupAnchor | null, b: PopupAnchor): boolean {
  if (a === null) {
    return false;
  }
  return (
    Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.bottom - b.bottom) < 1
  );
}

function anchorFromRect(rect: DOMRect | RectLike | null): PopupAnchor | null {
  if (rect === null || (rect.width === 0 && rect.height === 0)) {
    return null;
  }
  return { left: rect.left, top: rect.top, bottom: rect.bottom, height: rect.height };
}

/**
 * Rect baris pertama sebuah range.
 *
 * Anchor popup memakai rect *pertama* dari range di posisi kursor, bukan rect gabungan:
 * untuk teks yang membungkus beberapa baris, posisi kursor ada di baris pertama, dan
 * Yomitan juga memilih satu rect utuh (`_getPosition` → `getClientRects()`), bukan
 * rect gabungan lintas baris.
 */
function anchorFromRange(range: Range | null): PopupAnchor | null {
  if (range === null) {
    return null;
  }
  const rects = range.getClientRects();
  return anchorFromRect(rects.length > 0 ? (rects[0] ?? null) : null);
}

/**
 * Range kosong tepat di posisi kursor.
 *
 * Yomitan menambatkan popup pada rect range *di posisi kursor*: untuk bahasa tanpa spasi
 * (`SCAN_RESOLUTION_EXCLUDED_LANGUAGES` mencakup `ja`) offset awal tidak digeser ke awal
 * kata, sehingga rect yang dipakai adalah posisi karakter di bawah kursor, bukan rentang
 * kandidat yang bisa memanjang/memendek. Ini yang membuat penempatan popup konsisten.
 */
function caretRangeAt(node: Text, codePointOffset: number): Range | null {
  try {
    const range = document.createRange();
    range.setStart(node, codePointToUtf16Index(node.data, codePointOffset));
    range.collapse(true);
    return range;
  } catch {
    return null;
  }
}

/** Indeks (code point) kemunculan pertama `needle` di dalam `query`, atau -1. */
function matchOffsetInQuery(query: string, needle: string): number {
  const index = query.indexOf(needle);
  return index === -1 ? -1 : codePointLength(query.slice(0, index));
}

type LookupReply =
  | { ok: true; data: ResponseData<'LOOKUP'> }
  | { ok: false; error: MessageError };

async function sendMessage<K extends MessageType>(
  type: K,
  payload: RequestPayload<K>,
): Promise<LookupReply> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(buildMessage(type, payload));
    if (!isResponseEnvelope(response) || response.response.ok !== true) {
      return {
        ok: false,
        error: { code: 'INTERNAL', message: 'Balasan service worker tidak valid.' },
      };
    }
    return { ok: true, data: response.response.data as ResponseData<'LOOKUP'> };
  } catch (error) {
    // Halaman ini dibuat sebelum extension dimuat ulang/di-update: content script tidak
    // bisa lagi menghubungi service worker sampai halaman dimuat ulang.
    if (isExtensionContextInvalidated(error)) {
      return {
        ok: false,
        error: {
          code: 'CONTEXT_INVALIDATED',
          message: error instanceof Error ? error.message : 'Konteks extension sudah tidak berlaku.',
        },
      };
    }
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: error instanceof Error ? error.message : 'Service worker tidak merespons.',
      },
    };
  }
}

let scanner: ContentScanner | null = null;
let messageListener:
  | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | undefined)
  | null = null;

/** Penanda global (isolated world) supaya injeksi berulang tidak menumpuk listener. */
interface ContentScriptState {
  version: string;
  teardown: () => void;
}
const globalScope = globalThis as unknown as { __shirabeContent?: ContentScriptState };

function payloadQuery(message: Partial<ExtensionMessage>): string {
  if (message.payload === undefined || typeof message.payload !== 'object') {
    return '';
  }
  if (!('query' in message.payload) || typeof message.payload.query !== 'string') {
    return '';
  }
  return message.payload.query.trim();
}

/** Benar bila URL frame ini dapat dipindai (hanya http/https). */
function isScannableDocument(): boolean {
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

function bootstrap(): void {
  if (!isScannableDocument()) {
    return;
  }
  // Bila versi lama masih hidup di tab ini (mis. setelah extension di-update),
  // lepaskan lebih dahulu agar tidak ada dua popup/listener.
  globalScope.__shirabeContent?.teardown();

  scanner = new ContentScanner();
  messageListener = (message, _sender, sendResponse) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) {
      return undefined;
    }
    const envelope = message as Partial<ExtensionMessage>;
    if (envelope.type === 'GET_SELECTION') {
      if (scanner === null) {
        sendResponse(
          errorResponse(requestId(), {
            code: 'NOT_FOUND',
            message: 'Content script belum aktif di tab ini.',
          }),
        );
        return false;
      }
      sendResponse({
        v: 1,
        id: envelope.id ?? requestId(),
        response: { ok: true, data: scanner.readSelection() },
      });
      return false;
    }
    if (envelope.type === 'SHOW_LOOKUP') {
      const query = payloadQuery(envelope);
      if (scanner !== null && query.length > 0) {
        scanner.showSelectionLookup(query, 'context-menu');
      }
      return false;
    }
    return undefined;
  };

  chrome.runtime.onMessage.addListener(messageListener);
  scanner.start();
  globalScope.__shirabeContent = {
    version: chrome.runtime.getManifest().version,
    teardown: () => {
      if (messageListener !== null) {
        chrome.runtime.onMessage.removeListener(messageListener);
        messageListener = null;
      }
      scanner?.stop();
      scanner = null;
    },
  };
}

bootstrap();
