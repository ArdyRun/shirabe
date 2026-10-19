/**
 * Pengujian integrasi Shirabe di Chromium asli (PRD 12.2).
 *
 * Menjalankan extension hasil build di browser Chromium melalui Playwright:
 * memuat extension unpacked, mengimpor dataset, mencari kata, mengaktifkan situs,
 * memverifikasi popup hover, mengetes kegagalan impor, dan memastikan data bertahan
 * setelah browser dijalankan ulang.
 *
 * Catatan instrumentasi: manifest pada direktori uji disalin dari `dist` dan diberi
 * `host_permissions` untuk origin server uji saja, supaya langkah persetujuan izin
 * browser (dialog native) dapat dilewati. Kode yang diuji tetap kode produksi.
 *
 * Jalankan: npm run build && npm run e2e
 */

import { chromium } from 'playwright';
import http from 'node:http';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const fixture = path.join(projectRoot, 'tests', 'fixtures', 'demo-mini.jsonl');
const artifactsDir = path.join(projectRoot, 'artifacts', 'e2e');

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  results.push({ name, ok, detail });
  if (!ok) {
    failures += 1;
  }
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
}

const PAGE_HTML = `<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8"><title>Halaman uji Shirabe</title></head>
  <body style="font-family: sans-serif; font-size: 20px; padding: 24px">
    <h1>Halaman uji</h1>
    <p>私は毎日 <span id="word">学生</span> です。</p>
    <p>きょうは <span id="word2">食べ物</span> を買います。</p>
    <p id="sentence">彼は毎日<span id="word3">日本語</span>を勉強します。</p>
    <p>今日は<span id="split-a">食べ</span><span id="split-b">ました</span>。</p>
    <div id="shadow-host" style="display:inline-block; padding:4px; border:1px solid #ddd"></div>
    <iframe id="test-frame" src="/frame" title="frame Jepang"></iframe>
    <p><input id="field" value="学生" /></p>
    <p><textarea id="area">学生</textarea></p>
    <p><span id="editable" contenteditable="true">学生</span></p>
    <p style="text-align: right">これは<span id="right-word">学生</span>です。</p>
    <div style="width: 60px; font-size: 20px">ああ<span id="wrap-word">学生</span></div>
    <div style="height: 1200px"></div>
    <p id="packed">陸上部だったので髪型はベリィショート。</p>
    <p id="packed2">俺がなんでそんなことを、とも思った。</p>
    <p id="inflected">遠くから鳥の声が聞こえてきた。</p>
    <p id="bottom-line">今日は<span id="bottom-word">学生</span>です。</p>
    <p id="no-space">彼は学生です。</p>
  </body>
</html>`;

async function startServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (request.url === '/frame') {
      response.end('<!doctype html><html lang="ja"><meta charset="utf-8"><body style="font:20px sans-serif"><p><span id="frame-word">学生</span>です。</p></body></html>');
      return;
    }
    response.end(PAGE_HTML);
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function launch(userDataDir, extensionDir) {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
    ],
  });
}

async function extensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (worker === undefined) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }
  return new URL(worker.url()).host;
}

/**
 * Kumpulkan teks di dalam halaman termasuk closed shadow root, memakai CDP
 * `DOM.getDocument({ pierce: true })` (shadow DOM tertutup tidak terlihat oleh
 * locator biasa).
 */
async function piercedText(page, options = {}) {
  const { includeStyles = false, className = null } = options;
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });

    /** Teks seluruh turunan, termasuk isi `<rt>` (dipakai hanya untuk anotasi furigana). */
    const annotationText = (node) => {
      if (node.nodeName === '#text') {
        return node.nodeValue ?? '';
      }
      return [...(node.children ?? [])].map(annotationText).join('');
    };

    const textOf = (node) => {
      const name = node.nodeName;
      if (name === 'SCRIPT' || (name === 'STYLE' && includeStyles !== true) || name === 'RT') {
        return '';
      }
      if (name === '#text') {
        return node.nodeValue ?? '';
      }
      const children = [...(node.children ?? []), ...(node.shadowRoots ?? [])];
      if (name === 'RUBY') {
        // Teks dasar tetap menyatu (mis. "食べる"); anotasi furigana ditulis setelahnya
        // supaya kata dengan ruby tetap terbaca utuh oleh pemeriksaan berbasis teks.
        const base = children.filter((child) => child.nodeName !== 'RT').map(textOf).join('');
        const ruby = children
          .filter((child) => child.nodeName === 'RT')
          .map(annotationText)
          .join('');
        return ruby.length > 0 ? `${base} ${ruby}` : base;
      }
      return children.map(textOf).join('');
    };

    const findsPopupHost = (node) => {
      const attributes = node.attributes ?? [];
      for (let index = 0; index < attributes.length; index += 2) {
        if (attributes[index] === 'data-shirabe' && attributes[index + 1] === 'popup') {
          return true;
        }
      }
      return false;
    };

    const findPopupHost = (node) => {
      if (node.nodeName === 'DIV' && findsPopupHost(node)) {
        return node;
      }
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
        const found = findPopupHost(child);
        if (found !== null) {
          return found;
        }
      }
      return null;
    };

    const findNodeByClass = (node, wanted) => {
      const attributes = node.attributes ?? [];
      for (let index = 0; index < attributes.length; index += 2) {
        if (
          attributes[index] === 'class' &&
          typeof attributes[index + 1] === 'string' &&
          attributes[index + 1].split(/\s+/).includes(wanted)
        ) {
          return node;
        }
      }
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
        const found = findNodeByClass(child, wanted);
        if (found !== null) {
          return found;
        }
      }
      return null;
    };

    const target =
      className === null ? findPopupHost(root) : findNodeByClass(root, className);
    const text = target === null ? textOf(root) : textOf(target);
    return text.replace(/\s+/g, ' ').trim();
  } finally {
    await session.detach();
  }
}

/**
 * Cari node di dalam halaman termasuk closed shadow root yang cocok dengan atribut.
 *
 * Playwright tidak menembus shadow root tertutup, sedangkan CDP dengan `pierce: true`
 * bisa. Atribut dicocokkan persis; `class` dicocokkan per kelas.
 */
async function findPiercedNodeId(session, attributes) {
  const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
  const expected = Object.entries(attributes).map(([name, value]) => [
    name === 'className' ? 'class' : name,
    value,
  ]);
  let found = null;
  const matches = (node) => {
    const actual = node.attributes ?? [];
    return expected.every(([name, value]) =>
      name === 'class'
        ? actual.some(
            (item, index) =>
              index % 2 === 0 &&
              item === 'class' &&
              String(actual[index + 1]).split(/\s+/u).includes(value),
          )
        : actual.some((item, index) => index % 2 === 0 && item === name && actual[index + 1] === value),
    );
  };
  const walk = (node) => {
    if (found !== null) {
      return;
    }
    if (expected.length > 0 && matches(node)) {
      found = node.nodeId;
      return;
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
    for (const shadow of node.shadowRoots ?? []) {
      walk(shadow);
    }
  };
  walk(root);
  return found;
}

/** Kumpulkan seluruh node yang cocok (nama tag) di dalam closed shadow root. */
async function collectPiercedNodes(session, attributes) {
  const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
  const expected = Object.entries(attributes).map(([name, value]) => [
    name === 'className' ? 'class' : name,
    value,
  ]);
  const found = [];
  const matches = (node) => {
    const actual = node.attributes ?? [];
    return expected.every(([name, value]) =>
      name === 'class'
        ? actual.some(
            (item, index) =>
              index % 2 === 0 &&
              item === 'class' &&
              String(actual[index + 1]).split(/\s+/u).includes(value),
          )
        : actual.some((item, index) => index % 2 === 0 && item === name && actual[index + 1] === value),
    );
  };
  const walk = (node) => {
    if (expected.length > 0 && matches(node)) {
      found.push(node.nodeName);
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
    for (const shadow of node.shadowRoots ?? []) {
      walk(shadow);
    }
  };
  walk(root);
  return found;
}

/**
 * Klik elemen di dalam shadow root tertutup lewat koordinatnya.
 *
 * Halaman uji tidak digulir, jadi koordinat kotak dari CDP sama dengan koordinat
 * viewport yang dipakai `page.mouse`.
 */
async function piercedClick(page, attributes) {
  const session = await page.context().newCDPSession(page);
  try {
    const nodeId = await findPiercedNodeId(session, attributes);
    if (nodeId === null) {
      throw new Error(`Elemen ${JSON.stringify(attributes)} tidak ditemukan di dalam popup.`);
    }
    const { model } = await session.send('DOM.getBoxModel', { nodeId });
    const [left, top, , , right, bottom] = model.content;
    await page.mouse.click((left + right) / 2, (top + bottom) / 2);
  } finally {
    await session.detach();
  }
}

/** Hitung node di seluruh dokumen termasuk closed shadow root yang cocok dengan atribut. */
async function piercedNodes(page, attributes) {
  const session = await page.context().newCDPSession(page);
  try {
    return await collectPiercedNodes(session, attributes);
  } finally {
    await session.detach();
  }
}

/**
 * Jalankan pembacaan pada node di dalam shadow root tertutup (mis. `scrollLeft` strip tab).
 *
 * `expression` dijalankan sebagai method pada node tersebut, jadi nilainya dibaca apa
 * adanya tanpa perlu menembus shadow root dari dunia halaman.
 */
async function piercedNodeEval(page, attributes, expression) {
  const session = await page.context().newCDPSession(page);
  try {
    const nodeId = await findPiercedNodeId(session, attributes);
    if (nodeId === null) {
      throw new Error(`Elemen ${JSON.stringify(attributes)} tidak ditemukan.`);
    }
    const { object } = await session.send('DOM.resolveNode', { nodeId });
    const result = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function () { return ${expression}; }`,
      returnByValue: true,
    });
    return result.result.value;
  } finally {
    await session.detach();
  }
}

/**
 * Tunggu sampai node dengan atribut tertentu muncul di dalam shadow root tertutup;
 * mengembalikan jumlahnya saat ditemukan atau saat batas waktu habis.
 */
async function waitForPierced(page, attributes, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await piercedNodes(page, attributes);
    if (found.length > 0 || Date.now() > deadline) {
      return found.length;
    }
    await page.waitForTimeout(100);
  }
}

/**
 * Teks elemen tanpa anotasi furigana yang memecah kata: teks dasar dibaca menyatu
 * ("食べる"), lalu furigana ditulis setelahnya — sama untuk semua permukaan hasil.
 */
async function textWithoutRuby(locator) {
  return locator.evaluate((element) => {
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue ?? '';
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }
      if (node.tagName === 'RT' || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
        return '';
      }
      const children = [...node.childNodes];
      if (node.tagName === 'RUBY') {
        const plain = (child) => {
          if (child.nodeType === Node.TEXT_NODE) {
            return child.nodeValue ?? '';
          }
          return [...child.childNodes].map(plain).join('');
        };
        const base = children.filter((child) => child.nodeName !== 'RT').map(walk).join('');
        const ruby = children.filter((child) => child.nodeName === 'RT').map(plain).join('');
        return ruby.length > 0 ? `${base} ${ruby}` : base;
      }
      return children.map(walk).join('');
    };
    return walk(element).replace(/\s+/g, ' ').trim();
  });
}

async function popupText(page) {
  return piercedText(page, { scopeSelector: '[data-shirabe="popup"]' });
}

/**
 * Poll isi popup sampai memuat teks yang diharapkan.
 *
 * Popup adalah shadow DOM tertutup, jadi polling dilakukan dari Node lewat CDP; cara ini
 * juga toleran terhadap urutan hasil lookup yang tiba (hasil di-render secara asinkron).
 */
/**
 * Ukur penempatan popup untuk satu karakter pada satu elemen.
 *
 * Mengembalikan rect kursor (dari `caretPositionFromPoint` pada titik yang sama) dan
 * posisi popup, sehingga aturan penempatan dapat diperiksa secara langsung.
 */
async function popupPlacementAt(page, selector, charIndex, offsetPx = 2) {
  // Pastikan tidak ada popup lama yang masih tampil: kalau ada, pengukuran bisa membaca
  // posisi popup sebelumnya (Escape pertama menutup detail, kedua menutup popup).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]')?.hasAttribute('hidden') === true,
    null,
    { timeout: 5000 },
  );
  const point = await page.evaluate(
    ({ selector: sel, charIndex: index, offset }) => {
      const node = document.querySelector(sel).firstChild;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + offset, y: rect.top + rect.height / 2 };
    },
    { selector, charIndex, offset: offsetPx },
  );
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(80);
  await page.mouse.move(point.x + 1, point.y);
  await page.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]')?.getAttribute('data-state') === 'ready',
    null,
    { timeout: 10000 },
  );
  return await page.evaluate(({ x, y }) => {
    const position = document.caretPositionFromPoint(x, y);
    let caret = null;
    if (position !== null) {
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      const rect = range.getClientRects()[0] ?? null;
      if (rect !== null) {
        caret = { left: rect.left, top: rect.top, bottom: rect.bottom };
      }
    }
    const host = document.querySelector('[data-shirabe="popup"]');
    const transform = getComputedStyle(host).transform;
    // `getComputedStyle` menormalkan translate menjadi matrix(a, b, c, d, tx, ty).
    const match = /matrix\(([^)]+)\)/.exec(transform);
    const parts = match === null ? [] : match[1].split(',').map((value) => Number.parseFloat(value));
    return {
      caret,
      transform,
      left: parts.length === 6 ? parts[4] : null,
      top: parts.length === 6 ? parts[5] : null,
      width: host.offsetWidth,
      height: host.offsetHeight,
      viewportHeight: document.documentElement.clientHeight,
    };
  }, point);
}

/**
 * Kotak (rect) node pertama di dalam shadow DOM tertutup yang cocok dengan atribut
 * tertentu. Dipakai untuk mengklik/menarik elemen yang tidak terlihat dari luar
 * (mis. tombol kanji atau pegangan ubah ukuran popup).
 */
async function piercedBoxModel(page, attributes) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const expected = Object.entries(attributes);
    let target = null;
    const walk = (node) => {
      if (target !== null) {
        return;
      }
      const actual = node.attributes ?? [];
      const map = {};
      for (let index = 0; index < actual.length; index += 2) {
        map[actual[index]] = actual[index + 1];
      }
      if (expected.every(([name, value]) => map[name] === value)) {
        target = node;
        return;
      }
      for (const child of node.children ?? []) {
        walk(child);
      }
      for (const shadow of node.shadowRoots ?? []) {
        walk(shadow);
      }
    };
    walk(root);
    if (target === null) {
      return null;
    }
    const { model } = await session.send('DOM.getBoxModel', { nodeId: target.nodeId });
    const [x1, y1, , , x2, y2] = model.content;
    return {
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2,
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  } finally {
    await session.detach();
  }
}

/** Klik pada koordinat viewport (untuk elemen di dalam shadow DOM tertutup). */
async function clickAt(page, point) {
  const session = await page.context().newCDPSession(page);
  try {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await session.send('Input.dispatchMouseEvent', {
        type,
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
    }
  } finally {
    await session.detach();
  }
}

/**
 * Gaya terhitung node pertama (termasuk di dalam shadow DOM tertutup) yang cocok dengan
 * pasangan atribut tertentu. Dipakai untuk memastikan panel popup benar-benar memakai
 * warna palet tema, bukan latar transparan (§4.20 audit).
 */
async function piercedComputedStyle(page, attributes) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const expected = Object.entries(attributes);
    let target = null;
    const walk = (node) => {
      if (target !== null) {
        return;
      }
      const actual = node.attributes ?? [];
      const map = {};
      for (let index = 0; index < actual.length; index += 2) {
        map[actual[index]] = actual[index + 1];
      }
      if (expected.every(([name, value]) => map[name] === value)) {
        target = node;
        return;
      }
      for (const child of node.children ?? []) {
        walk(child);
      }
      for (const shadow of node.shadowRoots ?? []) {
        walk(shadow);
      }
    };
    walk(root);
    if (target === null) {
      return null;
    }
    const computed = await session.send('CSS.getComputedStyleForNode', { nodeId: target.nodeId });
    return Object.fromEntries(computed.computedStyle.map((entry) => [entry.name, entry.value]));
  } finally {
    await session.detach();
  }
}

/**
 * Atribut node (dalam shadow DOM tertutup) yang cocok dengan pasangan atribut tertentu.
 * Dipakai untuk memeriksa nilai inline seperti variabel palet tema pada panel popup.
 */
async function piercedNodeAttributes(page, attributes) {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const expected = Object.entries(attributes);
    const found = [];
    const walk = (node) => {
      const actual = node.attributes ?? [];
      const map = {};
      for (let index = 0; index < actual.length; index += 2) {
        map[actual[index]] = actual[index + 1];
      }
      if (expected.every(([name, value]) => map[name] === value)) {
        found.push(map);
      }
      for (const child of node.children ?? []) {
        walk(child);
      }
      for (const shadow of node.shadowRoots ?? []) {
        walk(shadow);
      }
    };
    walk(root);
    return found;
  } finally {
    await session.detach();
  }
}

/**
 * Nama node yang memiliki atribut `name` (nilai apa pun). Dipakai untuk memeriksa
 * keadaan boolean seperti `open` pada `<details>` di dalam shadow DOM popup.
 */
async function piercedNodesWithAttribute(page, name) {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const found = [];
    const walk = (node) => {
      const attributes = node.attributes ?? [];
      for (let index = 0; index < attributes.length; index += 2) {
        if (attributes[index] === name) {
          found.push(node.nodeName);
          break;
        }
      }
      for (const child of node.children ?? []) {
        walk(child);
      }
      for (const shadow of node.shadowRoots ?? []) {
        walk(shadow);
      }
    };
    walk(root);
    return found;
  } finally {
    await session.detach();
  }
}

/**
 * Titik (x, y) di tengah karakter ke-`index` di dalam sebuah elemen bertext.
 *
 * Dipakai pemeriksaan hover: pemindaian dimulai dari karakter di bawah kursor, jadi tes
 * harus menunjuk karakter yang dimaksud, bukan sekadar tengah elemen.
 */
async function characterPoint(page, elementId, index = 0) {
  return page.evaluate(
    ([id, offset]) => {
      const element = document.getElementById(id);
      const node = element?.firstChild ?? null;
      if (node === null || node.nodeType !== Node.TEXT_NODE) {
        return null;
      }
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    [elementId, index],
  );
}

async function waitForPopupText(page, needle, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let text = '';
  for (;;) {
    text = await popupText(page);
    if (text.includes(needle) || Date.now() > deadline) {
      return text;
    }
    await page.waitForTimeout(100);
  }
}

async function sendMessage(page, type, payload) {
  return page.evaluate(
    ([messageType, messagePayload]) =>
      chrome.runtime.sendMessage({
        v: 1,
        id: crypto.randomUUID(),
        type: messageType,
        payload: messagePayload,
      }),
    [type, payload],
  );
}

const crash = [];
process.on('uncaughtException', (error) => {
  crash.push(error);
  process.stderr.write(`uncaught: ${error.stack ?? error.message}\n`);
});

async function main() {
  if (!existsSync(path.join(distDir, 'manifest.json'))) {
    throw new Error('dist belum ada. Jalankan `npm run build` lebih dahulu.');
  }
  await rm(artifactsDir, { recursive: true, force: true });
  await mkdir(artifactsDir, { recursive: true });

  const { server, origin } = await startServer();
  // Manifest asli dipakai apa adanya: content script statis di semua situs http/https.
  const extensionDir = distDir;
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'shirabe-profile-'));

  let context = await launch(profileDir, extensionDir);
  const id = await extensionId(context);
  check('Extension MV3 dimuat dan service worker berjalan', /^[a-p]{32}$/.test(id), id);

  const settingsUrl = `chrome-extension://${id}/settings.html`;
  const searchUrl = (query) =>
    `chrome-extension://${id}/search.html${query === undefined ? '' : `?q=${encodeURIComponent(query)}`}`;

  // 1. Status awal: belum ada kamus aktif.
  const settings = await context.newPage();
  await settings.goto(settingsUrl);
  await settings.waitForSelector('#dictionary-list', { state: 'attached' });
  check(
    'Tema default adalah gelap (charcoal) pada halaman extension',
    (await settings.evaluate(() => document.documentElement.dataset.theme)) === 'dark' &&
      (await settings.evaluate(() => getComputedStyle(document.body).backgroundColor)) ===
        'rgb(22, 23, 28)',
    await settings.evaluate(() => getComputedStyle(document.body).backgroundColor),
  );
  check(
    'Halaman settings menjelaskan kebutuhan impor dataset',
    (await settings.locator('#dictionary-empty').isVisible()) &&
      (await settings.locator('#import-hint').innerText()).includes('schemaVersion 1–2'),
  );
  // Identitas komponen: build halaman harus sama dengan build service worker yang
  // benar-benar berjalan (menangkap service worker basi ala cache ScriptCache).
  const componentsText = await settings
    .locator('#about-components')
    .evaluate((node) => node.textContent ?? '');
  const pageBuild = componentsText.match(/\(([^)]+)\)/)?.[1] ?? '';
  const workerSegment = componentsText.split('service worker')[1]?.trim() ?? '';
  check(
    'Halaman dan service worker melaporkan build yang sama',
    pageBuild.length > 0 && workerSegment.includes(pageBuild),
    componentsText,
  );
  check(
    'Tidak ada peringatan komponen tidak seragam saat halaman dan worker seversi',
    (await settings.locator('[data-role="component-mismatch"]').count()) === 0,
    `${await settings.locator('[data-role="component-mismatch"]').count()} peringatan`,
  );
  check(
    'Batasan impor ditampilkan sebelum impor',
    (await settings.locator('#limits-summary').innerText()).includes('entry'),
  );

  // 2. Impor dataset valid.
  await settings.setInputFiles('#import-input', fixture);
  await settings.waitForSelector('.dictionary', { timeout: 45000 });
  const importedText = await settings.locator('.dictionary').first().innerText();
  check(
    'Dataset JSONL dapat diimpor dan tampil di pengelolaan kamus',
    importedText.includes('Kamus Contoh Shirabe') && importedText.includes('34 istilah'),
    importedText.replaceAll('\n', ' | ').slice(0, 140),
  );
  check(
    'Ringkasan storage menampilkan pemakaian dan jumlah entry',
    (await settings.locator('#storage-summary').innerText()).includes('entry'),
    await settings.locator('#storage-summary').innerText(),
  );
  await settings.locator('.dictionary').first().getByRole('button', { name: 'Detail' }).click();
  const importedDetail = await settings.locator('.dictionary__detail').first().innerText();
  check(
    'Lisensi dataset ditampilkan',
    importedDetail.includes('CC0-1.0'),
    importedDetail.replaceAll('\n', ' | ').slice(0, 120),
  );

  // 2b. Action popup: status kamus, pencarian manual, dan tindakan situs.
  const action = await context.newPage();
  await action.goto(`chrome-extension://${id}/action.html`);
  await action.waitForSelector('#status-badge');
  check(
    'Action popup melaporkan status siap dan jumlah kamus aktif',
    (await action.locator('#status-badge').innerText()) === 'Siap' &&
      (await action.locator('#status-badge').getAttribute('title'))?.includes('1'),
    await action.locator('#status-badge').innerText(),
  );
  check(
    'Tombol Cari nonaktif saat kueri kosong',
    await action.locator('#search-button').isDisabled(),
  );
  check(
    'Action popup menjelaskan bahwa halaman extension tidak dapat dipindai',
    await action.locator('#site-button').isHidden(),
  );
  await action.fill('#search-input', '食べる');
  await action.press('#search-input', 'Enter');
  await action.waitForSelector('[data-role="entry"]');
  const actionEntry = await textWithoutRuby(action.locator('[data-role="entry"]').first());
  check(
    'Enter menjalankan pencarian manual yang sama dengan tombol Cari',
    actionEntry.includes('食べる'),
  );
  check(
    'Action popup menampilkan seluruh definisi tanpa klik',
    actionEntry.includes('makan') && actionEntry.includes('memakan'),
    actionEntry.replaceAll('\n', ' | ').slice(0, 160),
  );
  await action.screenshot({ path: path.join(artifactsDir, 'action-popup.png') });
  await action.close();

  await settings.click('#tab-dictionaries');
  await settings.screenshot({ path: path.join(artifactsDir, 'settings-dictionaries.png'), fullPage: true });
  const readingTab = await context.newPage();
  await readingTab.goto(settingsUrl);
  await readingTab.waitForSelector('#tab-reading');
  await readingTab.click('#tab-reading');
  await readingTab.screenshot({ path: path.join(artifactsDir, 'settings-reading.png'), fullPage: true });
  await readingTab.close();

  // 3. Pencarian manual: exact + deinflection; seluruh data entri langsung tampil.
  const search = await context.newPage();
  await search.goto(searchUrl('食べました'));
  await search.waitForSelector('[data-role="entry"]', { timeout: 15000 });
  const firstEntry = await textWithoutRuby(search.locator('[data-role="entry"]').first());
  // Nama kamus ditulis sekali sebagai judul kelompok di atas kartu, bukan di dalam kartu.
  const resultsText = await textWithoutRuby(search.locator('#results'));
  check(
    'Deinflection 食べました menghasilkan entri kamus 食べる',
    firstEntry.includes('食べる') && firstEntry.includes('makan'),
    firstEntry.replaceAll('\n', ' | ').slice(0, 160),
  );
  check(
    'Halaman pencarian menampilkan definisi, kelas kata, dan kamus asal tanpa klik',
    firstEntry.includes('makan') &&
      firstEntry.includes('memakan') &&
      firstEntry.includes('v1') &&
      resultsText.includes('Kamus Contoh'),
    resultsText.replaceAll('\n', ' | ').slice(0, 200),
  );
  check(
    'Halaman pencarian tidak lagi memerlukan langkah buka detail',
    (await search.locator('[data-role="entry-detail"]').count()) === 0 &&
      (await search.locator('button', { hasText: 'Kembali' }).count()) === 0,
  );
  await search.screenshot({ path: path.join(artifactsDir, 'search-results.png') });

  // 4. Kandidat terpanjang + homonim.
  await search.goto(searchUrl('はし'));
  await search.waitForSelector('[data-role="entry"]');
  const homonyms = await Promise.all(
    (await search.locator('[data-role="entry"]').all()).map((entry) => textWithoutRuby(entry)),
  );
  check(
    'Homonim dengan bacaan sama ditampilkan sebagai alternatif',
    homonyms.some((item) => item.includes('橋')) && homonyms.some((item) => item.includes('箸')),
    homonyms.join(' / ').slice(0, 160),
  );

  await search.goto(searchUrl('東京都'));
  await search.waitForSelector('[data-role="entry"]');
  const longest = await textWithoutRuby(search.locator('[data-role="entry"]').first());
  check('Kandidat terpanjang dipakai untuk teks majemuk', longest.includes('東京都'), longest.slice(0, 80));

  // 5. Entri rusak di tengah file tidak merusak kamus aktif.
  const brokenFile = path.join(os.tmpdir(), 'shirabe-broken.jsonl');
  const lines = (await readFile(fixture, 'utf8')).split('\n');
  // ID berbeda agar pengujian ini fokus pada baris rusak, bukan alur konfirmasi replace.
  const header = JSON.parse(lines[0]);
  header.id = 'shirabe-demo-broken';
  header.name = 'Kamus Rusak (uji)';
  lines[0] = JSON.stringify(header);
  lines.splice(5, 0, '{"expression":"rusak","definitions":[]}');
  await writeFile(brokenFile, lines.join('\n'));
  await settings.setInputFiles('#import-input', brokenFile);
  await settings.waitForSelector('.import-message--error', { timeout: 30000 });
  const errorText = await settings.locator('.import-message--error').first().innerText();
  check(
    'Baris tidak valid menghasilkan pesan dengan nomor baris',
    /baris\s*6/i.test(errorText) || /line\s*6/i.test(errorText),
    errorText.slice(0, 160),
  );
  const dictionariesAfterFailure = await settings.locator('.dictionary').count();
  check('Kegagalan impor mempertahankan kamus sebelumnya', dictionariesAfterFailure === 1);

  // 6. Ganti kamus dengan ID sama memerlukan konfirmasi.
  await settings.setInputFiles('#import-input', fixture);
  await settings.waitForSelector('#confirm-dialog[open]', { timeout: 30000 });
  check('Impor dengan ID sama meminta konfirmasi penggantian', true);
  await settings.locator('#confirm-accept').click();
  await settings.waitForSelector('#confirm-dialog[open]', { state: 'detached', timeout: 30000 });
  await settings.waitForFunction(() => !document.querySelector('#import-progress:not([hidden])'), null, {
    timeout: 45000,
  });
  check(
    'Penggantian kamus mempertahankan satu kamus aktif',
    (await settings.locator('.dictionary').count()) === 1,
  );

  // 7. Pemindaian otomatis di semua situs (tanpa aktivasi per situs).
  const page = await context.newPage();
  await page.goto(origin);
  // Content script dari manifest langsung aktif tanpa langkah izin/aktivasi.
  await page.waitForSelector('[data-shirabe="popup"]', { state: 'attached', timeout: 15000 });
  const popupHost = page.locator('[data-shirabe="popup"]');
  check(
    'Content script aktif otomatis di situs baru tanpa aktivasi per situs',
    (await popupHost.count()) === 1 && (await popupHost.getAttribute('hidden')) !== null,
  );

  // Hover tanpa modifier: tidak ada popup.
  const word = page.locator('#word');
  const box = await word.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  check('Hover tanpa modifier tidak memunculkan popup', (await popupHost.getAttribute('hidden')) !== null);

  // Hover dengan modifier Alt.
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]')?.hasAttribute('hidden') === false,
    null,
    { timeout: 10000 },
  );
  const popupBox = await popupHost.boundingBox();
  check(
    'Hover dengan modifier menampilkan popup hasil lookup',
    popupBox !== null && popupBox.width > 200 && popupBox.height > 40,
    JSON.stringify(popupBox),
  );
  const popupContent = await waitForPopupText(page, 'pelajar; mahasiswa');
  check(
    'Popup menampilkan headword, bacaan, definisi, dan kelas kata',
    popupContent.includes('学生') &&
      popupContent.includes('がくせい') &&
      popupContent.includes('pelajar; mahasiswa') &&
      popupContent.includes('Kamus Contoh Shirabe'),
    popupContent.replaceAll('\n', ' | ').slice(0, 240),
  );
  // Pemilik produk memilih popup tanpa blok kalimat sumber (lihat §4.14 audit): popup
  // hanya memuat header kosakata dan kartu entri kamus.
  check(
    'Popup tidak menampilkan kalimat sumber di bawah kosakata',
    (await piercedNodes(page, { 'data-role': 'context' })).length === 0 &&
      !popupContent.includes('私は毎日') &&
      (await piercedNodes(page, { 'class': 'context' })).length === 0,
    popupContent.replaceAll('\n', ' | ').slice(0, 120),
  );
  await page.screenshot({ path: path.join(artifactsDir, 'hover-popup.png') });

  // Panel popup berada di shadow DOM tertutup: token tema harus terpasang di sana, bukan
  // hanya di `:root` (regresi §4.20: panel transparan + warna teks ikut halaman).
  const popupComputed = await piercedComputedStyle(page, { 'data-theme-name': 'shirabe-dark' });
  check(
    'Panel popup memakai warna palet tema, bukan latar transparan',
    popupComputed !== null &&
      popupComputed['background-color'] === 'rgb(22, 23, 28)' &&
      popupComputed['color'] === 'rgb(237, 238, 244)',
    JSON.stringify({
      theme: popupComputed?.['--pal-scheme'],
      background: popupComputed?.['background-color'],
      color: popupComputed?.['color'],
    }),
  );

  // Kata yang sedang di-lookup disorot di halaman memakai CSS Custom Highlight API:
  // tidak ada elemen/kelas yang ditambahkan ke DOM halaman.
  const highlightState = () =>
    page.evaluate(() => {
      const set = CSS.highlights?.get('shirabe-match') ?? null;
      const ranges = set === null ? [] : [...set];
      return {
        text: ranges.map((range) => range.toString()).join('|'),
        marks: document.querySelectorAll('mark, .shirabe-match').length,
        styles: document.querySelectorAll('style[data-shirabe="highlight"]').length,
      };
    });
  const highlighted = await highlightState();
  check(
    'Kata yang di-lookup disorot di halaman tanpa mengubah DOM halaman',
    highlighted.text === '学生' && highlighted.marks === 0 && highlighted.styles === 1,
    JSON.stringify(highlighted),
  );

  // Header popup tidak lagi mengulang kata yang dipindai (kartu entri yang menampilkannya).
  const headerQueries = await piercedNodes(page, { className: 'panel__query' });
  const headerButtons = await piercedNodes(page, { className: 'icon-button' });
  check(
    'Header popup tidak mengulang kata yang dipindai dan tetap punya tombol tutup',
    headerQueries.length === 0 && headerButtons.length === 1,
    `${headerQueries.length} kueri di header · ${headerButtons.length} tombol`,
  );
  check(
    'Header menampilkan kata yang dipindai dan kartu menampilkan bentuk kamus',
    (await piercedNodes(page, { 'class': 'entry__spelling' })).length === 1 &&
      (await piercedNodes(page, { 'class': 'entry__dictionary' })).length === 1,
    `${(await piercedNodes(page, { 'class': 'entry__spelling' })).length} headword kartu`,
  );
  check(
    'Popup memakai tema gelap dan menampilkan furigana di atas kanji',
    (await piercedNodes(page, { 'data-theme': 'dark' })).length > 0 &&
      popupContent.includes('学生') &&
      popupContent.includes('がくせい'),
    popupContent.replaceAll('\n', ' | ').slice(0, 120),
  );
  const definitionBlocks = await piercedNodes(page, { 'data-role': 'definitions' });
  check(
    'Popup menampilkan definisi langsung di kartu entri tanpa aksi pengguna',
    popupContent.includes('pelajar; mahasiswa') && definitionBlocks.length === 1,
    `${definitionBlocks.length} blok definisi · ${popupContent.replaceAll('\n', ' | ').slice(0, 120)}`,
  );
  check(
    'Popup menampilkan kelas kata dan tag entri',
    popupContent.includes('n') && popupContent.includes('umum'),
    popupContent.replaceAll('\n', ' | ').slice(0, 140),
  );
  // Tag prioritas/frekuensi gaya Jitendex (`⭐` kategori popular, `ichi`/`spec`/`news7k`
  // kategori frequent) tidak ditampilkan walau datanya memuatnya.
  check(
    'Tag prioritas (⭐, ichi, spec) tidak ditampilkan di baris sense',
    !popupContent.includes('⭐') &&
      !popupContent.includes('ichi') &&
      !/(?:^|[^A-Za-z])spec(?:[^A-Za-z]|$)/u.test(popupContent),
    popupContent.replaceAll('\n', ' | ').slice(0, 140),
  );
  check(
    'Popup menandai tepat satu kartu entri sebagai terpilih',
    (await piercedNodes(page, { 'data-role': 'entry', 'data-selected': 'true' })).length === 1,
  );

  // Navigasi keyboard: panah memindahkan pilihan antar kartu entri.
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  check(
    'Panah bawah tetap menyisakan tepat satu kartu terpilih',
    (await piercedNodes(page, { 'data-role': 'entry', 'data-selected': 'true' })).length === 1,
  );
  // Menyapu kursor antar kata harus memperbarui popup *selama* kursor bergerak. Dulu timer
  // pemindaian di-restart setiap gerakan (debounce), sehingga popup tidak pernah muncul
  // selama kursor masih menyapu (0–3 dari 15 kata pada pengukuran §4.30).
  const slideWordPosition = (word) =>
    page.evaluate((needle) => {
      const paragraph = document.getElementById('packed');
      const node = paragraph?.firstChild ?? null;
      if (node === null) {
        return null;
      }
      const index = (node.nodeValue ?? '').indexOf(needle);
      if (index < 0) {
        return null;
      }
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, word);

  const scrollBeforeSlide = await page.evaluate(() => window.scrollY);
  await page.locator('#packed').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__slideWords = [];
    window.__slideTimer = setInterval(() => {
      const set = CSS.highlights?.get('shirabe-match') ?? null;
      const text = set === null ? '' : [...set].map((range) => range.toString()).join('');
      if (text.length > 0 && window.__slideWords.at(-1) !== text) window.__slideWords.push(text);
    }, 8);
  });
  await page.keyboard.down('Alt');
  const slideTargets = ['陸上部', 'だった', '髪型', 'ショート'];
  for (const word of slideTargets) {
    const position = await slideWordPosition(word);
    if (position !== null) {
      await page.mouse.move(position.x, position.y);
    }
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(400);
  await page.keyboard.up('Alt');
  const slideWords = await page.evaluate(() => {
    clearInterval(window.__slideTimer);
    return window.__slideWords.slice();
  });
  await page.keyboard.press('Escape');
  check(
    'Menyapu kursor antar kata tetap memperbarui sorotan/popup selama bergerak',
    slideWords.length >= 2,
    slideWords.join(' → '),
  );
  // Kembalikan posisi gulir: pemeriksaan berikutnya memakai koordinat elemen di bagian atas
  // halaman, dan `boundingBox()` di luar viewport akan memindai elemen yang salah.
  await page.evaluate((position) => window.scrollTo(0, position), scrollBeforeSlide);
  await page.waitForTimeout(150);

  await page.screenshot({ path: path.join(artifactsDir, 'hover-selected.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape menutup popup', (await popupHost.getAttribute('hidden')) !== null);
  const afterClose = await highlightState();
  check(
    'Sorotan kata hilang saat popup ditutup',
    afterClose.text === '' && afterClose.marks === 0,
    JSON.stringify(afterClose),
  );
  await page.keyboard.up('Alt');

  // Popup yang sedang tampil memang menutupi sebagian halaman (keterbatasan yang sama
  // juga ada di Yomitan/Hachidori); tutup dulu sebelum menguji hover kata lain.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(
    'Popup dapat ditutup sebelum memindai kata lain',
    (await popupHost.getAttribute('hidden')) !== null,
  );

  // Hover di tengah rangkaian kanji tanpa spasi: kandidat harus mencakup kursor.
  const sentence = page.locator('#word3');
  // Rentetan kanji 毎日日本語: pemindaian dimulai dari karakter di bawah kursor, jadi
  // kursor diletakkan di karakter pertama kata yang dicari.
  const sentenceFirst = await characterPoint(page, 'word3', 0);
  await page.keyboard.down('Alt');
  await page.mouse.move(sentenceFirst.x - 6, sentenceFirst.y);
  await page.mouse.move(sentenceFirst.x, sentenceFirst.y);
  const sentencePopupText = await waitForPopupText(page, 'bahasa Jepang');
  check(
    'Hover di karakter pertama kata tanpa spasi menemukan kata itu',
    sentencePopupText.includes('日本語') && sentencePopupText.includes('bahasa Jepang'),
    sentencePopupText.replaceAll('\n', ' | ').slice(0, 200),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);

  // Aturan baru: kursor di tengah kata tidak memindai karakter sebelum kursor.
  const sentenceMiddle = await characterPoint(page, 'word3', 1);
  await page.mouse.move(sentenceMiddle.x - 6, sentenceMiddle.y);
  await page.mouse.move(sentenceMiddle.x, sentenceMiddle.y);
  const middleText = await waitForPopupText(page, '本語');
  check(
    'Kursor di tengah kata memindai dari karakter itu, bukan dari awal kata',
    middleText.includes('本語') && !middleText.includes('日本語'),
    middleText.replaceAll('\n', ' | ').slice(0, 160),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');
  // Text terbelah ke beberapa text node inline (formatting HTML) tetap dibaca sebagai kata.
  const splitPoint = await characterPoint(page, 'split-a', 0);
  await page.keyboard.down('Alt');
  await page.mouse.move(splitPoint.x - 6, splitPoint.y);
  await page.mouse.move(splitPoint.x, splitPoint.y);
  const splitContent = await waitForPopupText(page, 'makan');
  check(
    'Kata yang terbelah ke beberapa text node inline tetap dipindai',
    splitContent.includes('食べる') && splitContent.includes('makan'),
    splitContent.replaceAll('\n', ' | ').slice(0, 160),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');

  // Open Shadow DOM: content script meminta caret dengan daftar shadow root.
  await page.evaluate(() => {
    const host = document.getElementById('shadow-host');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<span id="shadow-word" style="font:20px sans-serif">学生</span>';
  });
  const shadowBox = await page.locator('#shadow-host').boundingBox();
  await page.keyboard.down('Alt');
  // Karakter pertama 学生 di dalam shadow root (tengah elemen host ada di antara dua kanji).
  await page.mouse.move(shadowBox.x + 4, shadowBox.y + shadowBox.height / 2);
  await page.mouse.move(shadowBox.x + 6, shadowBox.y + shadowBox.height / 2);
  const shadowContent = await waitForPopupText(page, 'pelajar; mahasiswa');
  check(
    'Teks dalam open Shadow DOM dapat dipindai',
    shadowContent.includes('学生') && shadowContent.includes('pelajar; mahasiswa'),
    shadowContent.replaceAll('\n', ' | ').slice(0, 160),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');

  // Penempatan popup: konsisten terhadap posisi kursor (aturan Yomitan), bukan terhadap
  // rentang kandidat yang bisa memanjang/memendek.
  await page.keyboard.down('Alt');
  // Dua kata berbeda pada baris berbeda: pemindaian mulai dari karakter di bawah kursor,
  // jadi karakter kedua `学生` (生) tidak punya entri sendiri di kamus uji.
  const placeFirst = await popupPlacementAt(page, '#word', 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const placeSecond = await popupPlacementAt(page, '#word3', 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const placeRepeat = await popupPlacementAt(page, '#word', 0);
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');

  check(
    'Popup selalu berjarak tetap dari karakter di bawah kursor',
    placeFirst.caret !== null &&
      placeSecond.caret !== null &&
      Math.abs(placeFirst.left - (placeFirst.caret.left + 10)) <= 1 &&
      Math.abs(placeSecond.left - (placeSecond.caret.left + 10)) <= 1,
    JSON.stringify({ first: [placeFirst.left, placeFirst.caret?.left], second: [placeSecond.left, placeSecond.caret?.left] }),
  );
  check(
    'Popup berada di bawah baris kursor ketika ruang tersedia',
    Math.abs(placeFirst.top - (placeFirst.caret.bottom + 10)) <= 1 &&
      Math.abs(placeSecond.top - (placeSecond.caret.bottom + 10)) <= 1,
    JSON.stringify({ top: placeFirst.top, caretBottom: placeFirst.caret?.bottom }),
  );
  check(
    'Satu posisi kursor menghasilkan penempatan yang identik (deterministik)',
    placeRepeat.transform === placeFirst.transform,
    `${placeFirst.transform} vs ${placeRepeat.transform}`,
  );
  check(
    'Popup mengikuti kursor, bukan terpaku pada satu kata',
    placeSecond.caret !== null &&
      placeFirst.caret !== null &&
      placeSecond.left !== placeFirst.left &&
      Math.abs(
        placeSecond.left - placeFirst.left - (placeSecond.caret.left - placeFirst.caret.left),
      ) <= 1,
    JSON.stringify({
      first: [placeFirst.left, placeFirst.caret?.left],
      second: [placeSecond.left, placeSecond.caret?.left],
    }),
  );

  // Di dasar halaman tidak ada ruang di bawah: popup pindah ke ATAS kursor dan tetap utuh.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(200);
  await page.keyboard.down('Alt');
  const placeBottom = await popupPlacementAt(page, '#bottom-word', 0);
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');
  check(
    'Tanpa ruang di bawah, popup tampil di atas kursor',
    placeBottom.caret !== null &&
      Math.abs(placeBottom.top + placeBottom.height - (placeBottom.caret.top - 10)) <= 1,
    JSON.stringify({ top: placeBottom.top, height: placeBottom.height, caretTop: placeBottom.caret?.top }),
  );
  check(
    'Popup selalu berada di dalam viewport',
    placeBottom.top >= 0 && placeBottom.top + placeBottom.height <= placeBottom.viewportHeight + 1,
    JSON.stringify({ top: placeBottom.top, height: placeBottom.height, vh: placeBottom.viewportHeight }),
  );
  // Kandidat di tengah kalimat tanpa spasi (regresi: dulu satu kalimat penuh sehingga
  // kata di tengah tidak pernah ditemukan).
  await page.locator('#packed').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const packedPoint = await page.evaluate(() => {
    const node = document.getElementById('packed').firstChild;
    // Mulai dari karakter pertama kata: pemindaian tidak lagi mundur melewati kursor.
    const index = node.nodeValue.indexOf('だった');
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.keyboard.down('Alt');
  await page.mouse.move(packedPoint.x, packedPoint.y);
  await page.mouse.move(packedPoint.x + 1, packedPoint.y);
  const packedText = await waitForPopupText(page, 'bentuk lampau');
  const packedCard = await piercedText(page, { className: 'entry__spelling' });
  check(
    'Kata di dalam kalimat tanpa spasi tetap ditemukan dari karakter pertamanya (だった)',
    packedText.includes('bentuk lampau') && packedCard.includes('だった'),
    `${packedCard} :: ${packedText.replaceAll('\n', ' | ').slice(0, 120)}`,
  );
  // Kata pendek di dalam rentetan kana panjang (regresi: dulu jendela panjang menutupi
  // `がな` sehingga hanya `なんで` yang dilaporkan).
  await page.locator('#packed2').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const ganaPoint = await page.evaluate(() => {
    const node = document.getElementById('packed2').firstChild;
    const index = node.nodeValue.indexOf('がな');
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(ganaPoint.x, ganaPoint.y);
  await page.mouse.move(ganaPoint.x + 1, ganaPoint.y);
  const ganaText = await waitForPopupText(page, 'partikel akhir kalimat');
  check(
    'Kata pendek di rentetan kana panjang tetap dilaporkan (がな)',
    // `なんで` mulai di dalam teks pindai (bukan di kursor), jadi tidak lagi dilaporkan:
    // pemindaian hanya dari karakter di bawah kursor.
    ganaText.includes('partikel akhir kalimat') && !ganaText.includes('なんで'),
    ganaText.replaceAll('\n', ' | ').slice(0, 140),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');
  await page.waitForTimeout(200);

  // Rantai deinfleksi ditampilkan sebagai disclosure tertutup dengan keterangan per
  // langkah (pola Hachidori); bentuk kamus 聞こえる ditemukan lewat rantai -た, -くる, -て.
  await page.locator('#inflected').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.keyboard.down('Alt');
  const inflectedPoint = await page.evaluate(() => {
    const node = document.getElementById('inflected').firstChild;
    const index = node.nodeValue.indexOf('聞こえてきた');
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(inflectedPoint.x, inflectedPoint.y);
  await page.mouse.move(inflectedPoint.x + 1, inflectedPoint.y);
  const inflectionText = await waitForPopupText(page, 'Kenapa cocok');
  const inflectionNodes = await piercedNodes(page, { 'data-role': 'inflection' });
  const inflectionFull = await piercedNodes(page, {
    'data-role': 'inflection',
    'data-steps': '3',
    'data-lemma': '聞こえる',
    'data-surface': '聞こえてきた',
  });
  check(
    'Rantai deinfleksi tampil tertutup dengan langkah dan keterangannya',
    inflectionNodes.length === 1 &&
      inflectionFull.length === 1 &&
      (await piercedNodesWithAttribute(page, 'open')).length === 0 &&
      inflectionText.includes('聞こえてきた') &&
      inflectionText.includes('-くる') &&
      inflectionText.includes('Bentuk lampau') &&
      inflectionText.includes('Bentuk -て'),
    inflectionText.replaceAll('\n', ' | ').slice(0, 200),
  );
  await page.screenshot({ path: path.join(artifactsDir, 'hover-inflection.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');
  await page.waitForTimeout(200);

  // 4b. Interaksi kartu bergaya jl-entry: klik kanji pada headword dan pegangan
  //     ubah ukuran popup.
  // Kartu 聞こえる (hasil lookup 聞こえてきた) menampilkan headword-nya karena berbeda
  // dari header, jadi kanji di dalamnya menjadi tombol seperti `jl-kanji-link`.
  await page.locator('#inflected').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const kanjiWord = await page.evaluate(() => {
    const node = document.getElementById('inflected').firstChild;
    const at = node.nodeValue.indexOf('聞こえてきた');
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left, y: rect.top + rect.height / 2 };
  });
  await page.keyboard.down('Alt');
  await page.mouse.move(kanjiWord.x + 1, kanjiWord.y);
  await page.mouse.move(kanjiWord.x + 2, kanjiWord.y);
  await waitForPopupText(page, 'Bentuk lampau');
  // Popup mengabaikan event pointer selama modifier ditahan (agar kursor bisa menyapu
  // teks di bawahnya); lepaskan modifier supaya popup interaktif dan bisa diklik.
  await page.keyboard.up('Alt');
  await page.waitForTimeout(150);
  const kanjiPoint = await piercedBoxModel(page, { class: 'entry__kanji' });
  const kanjiNodes = await piercedNodes(page, { class: 'entry__kanji' });
  await clickAt(page, kanjiPoint);
  const kanjiText = await waitForPopupText(page, 'Tidak ada hasil');
  check(
    'Klik kanji pada headword menjalankan lookup kanji tunggal',
    kanjiNodes.length === 1 && kanjiText.includes('“聞”'),
    `${kanjiNodes.length} tombol kanji · ${kanjiText.replaceAll('\n', ' | ').slice(0, 120)}`,
  );

  const handleBefore = await piercedBoxModel(page, { 'data-role': 'resize-handle' });
  const panelBefore = await piercedComputedStyle(page, { class: 'panel' });
  const viewport = page.viewportSize() ?? { width: 1000, height: 700 };
  await page.mouse.move(handleBefore.x, handleBefore.y);
  await page.mouse.down();
  await page.mouse.move(Math.min(viewport.width - 20, handleBefore.x + 90), handleBefore.y, {
    steps: 5,
  });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const panelAfter = await piercedComputedStyle(page, { class: 'panel' });
  const widthBefore = Number.parseFloat(panelBefore?.['width'] ?? '0');
  const widthAfter = Number.parseFloat(panelAfter?.['width'] ?? '0');
  check(
    'Pegangan ubah ukuran mengubah lebar popup',
    Number.isFinite(widthBefore) &&
      Number.isFinite(widthAfter) &&
      widthAfter > widthBefore &&
      widthAfter <= 720,
    `${widthBefore}px → ${widthAfter}px`,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // Kata yang tidak ada di kamus uji: pesan kosong harus memakai segmen kursor
  // (ベリィショート), bukan seluruh rangkaian tanpa spasi.
  await page.locator('#packed').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.keyboard.down('Alt');
  const missingPoint = await page.evaluate(() => {
    const node = document.getElementById('packed').firstChild;
    const index = node.nodeValue.indexOf('ベリィショート');
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(missingPoint.x, missingPoint.y);
  await page.mouse.move(missingPoint.x + 1, missingPoint.y);
  const missingText = await waitForPopupText(page, 'Tidak ada hasil');
  check(
    'Pesan tanpa hasil memakai segmen kursor, bukan satu kalimat penuh',
    missingText.includes('ベリィショート') &&
      !missingText.includes('陸上部だったので') &&
      missingText.includes('Tidak ada hasil'),
    missingText.replaceAll('\n', ' | ').slice(0, 140),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');
  await page.waitForTimeout(200);

  // Kueri tanpa spasi (`彼は学生です。`) cocok dengan entri `学生`: sorotan harus menyempit
  // ke `学生`, bukan seluruh rangkaian huruf. Kursor diletakkan di karakter pertama `学`
  // karena pemindaian dimulai dari karakter di bawah kursor.
  await page.locator('#no-space').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.keyboard.down('Alt');
  const noSpacePoint = await characterPoint(page, 'no-space', 2);
  await page.mouse.move(noSpacePoint.x - 6, noSpacePoint.y);
  await page.mouse.move(noSpacePoint.x, noSpacePoint.y);
  await waitForPopupText(page, 'pelajar; mahasiswa');
  const narrowed = await highlightState();
  check(
    'Sorotan menyempit ke kata yang cocok, bukan seluruh rangkaian huruf',
    narrowed.text === '学生',
    JSON.stringify(narrowed),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  // Tepi kanan viewport: popup digeser ke kiri supaya tetap utuh.
  await page.keyboard.down('Alt');
  const placeRight = await popupPlacementAt(page, '#right-word', 0);
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');
  check(
    'Di tepi kanan, popup digeser agar tidak melewati viewport',
    placeRight.left + placeRight.width <= 1280 + 1 && placeRight.left < placeRight.caret.left + 10,
    JSON.stringify({ left: placeRight.left, width: placeRight.width, caretLeft: placeRight.caret?.left }),
  );

  // Content script statis all_frames: teks di iframe web juga dipindai.
  const frame = page.frameLocator('#test-frame');
  const framePopup = frame.locator('[data-shirabe="popup"]');
  await framePopup.waitFor({ state: 'attached', timeout: 15000 });
  const frameBox = await frame.locator('#frame-word').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
  await page.mouse.move(frameBox.x + frameBox.width / 2 + 1, frameBox.y + frameBox.height / 2);
  await frame.locator('[data-shirabe="popup"]:not([hidden])').waitFor({ timeout: 10000 });
  check('Teks di iframe HTTP dapat dipindai', true);
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');

  // Modifier ditahan TANPA menggerakkan pointer harus tetap memicu popup.
  await page.waitForTimeout(200);
  await page.mouse.move(box.x + box.width / 2 - 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await page.keyboard.down('Alt');
  await page.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]')?.hasAttribute('hidden') === false,
    null,
    { timeout: 10000 },
  );
  check('Menahan modifier tanpa menggerakkan pointer memunculkan popup', true);
  await page.keyboard.up('Alt');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Menonaktifkan situs lewat preferensi harus menghentikan pemindaian tanpa reload.
  await sendMessage(settings, 'SITE_SCAN_DISABLE', { origin });
  await page.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]') === null,
    null,
    { timeout: 10000 },
  );
  check('Menonaktifkan situs menghentikan pemindaian di tab yang sudah terbuka', true);

  await sendMessage(settings, 'SITE_SCAN_ENABLE', { origin });
  await page.waitForSelector('[data-shirabe="popup"]', { state: 'attached', timeout: 10000 });
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]')?.hasAttribute('hidden') === false,
    null,
    { timeout: 10000 },
  );
  check('Mengaktifkan kembali situs langsung memulihkan pemindaian tanpa reload', true);
  await page.keyboard.up('Alt');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Lookup harus tetap bekerja tanpa jaringan (semua data lokal).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await context.setOffline(true);
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]')?.hasAttribute('hidden') === false,
    null,
    { timeout: 10000 },
  );
  const offlineText = await waitForPopupText(page, 'pelajar; mahasiswa');
  await page.keyboard.up('Alt');
  // Tutup popup dan beri jeda: tanpa ini, timer hover yang masih tertunda dapat
  // memunculkan hasil hover sesudah lookup berikutnya (mis. dari menu konteks).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(
    'Lookup tetap berfungsi saat browser offline (tanpa permintaan jaringan)',
    offlineText.includes('学生') && offlineText.includes('pelajar; mahasiswa'),
    offlineText.replaceAll('\n', ' | ').slice(0, 120),
  );
  await context.setOffline(false);

  // 8b. Path selection: GET_SELECTION dan SHOW_LOOKUP dari menu konteks.
  const [testTab] = await settings.evaluate(
    async (targetOrigin) => chrome.tabs.query({ url: `${targetOrigin}/*` }),
    origin,
  );
  await page.bringToFront();
  await page.evaluate(() => {
    const target = document.getElementById('word3').firstChild;
    const range = document.createRange();
    range.setStart(target, 0);
    range.setEnd(target, target.textContent.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const selectionResponse = await settings.evaluate(
    async (tabId) =>
      // `frameId: 0` = frame utama, sama seperti action popup; tanpa ini iframe pada
      // halaman uji dapat merespons lebih dahulu dengan seleksi kosong.
      chrome.tabs.sendMessage(
        tabId,
        {
          v: 1,
          id: crypto.randomUUID(),
          type: 'GET_SELECTION',
          payload: {},
        },
        { frameId: 0 },
      ),
    testTab.id,
  );
  check(
    'Teks terpilih dapat dibaca dari halaman melalui GET_SELECTION',
    selectionResponse.response.ok === true && selectionResponse.response.data.text === '日本語',
    JSON.stringify(selectionResponse.response).slice(0, 160),
  );

  await settings.evaluate(
    async (tabId) =>
      chrome.tabs.sendMessage(tabId, {
        v: 1,
        id: crypto.randomUUID(),
        type: 'SHOW_LOOKUP',
        payload: { query: '食べました', source: 'context-menu' },
      }),
    testTab.id,
  );

  await page.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]')?.hasAttribute('hidden') === false,
    null,
    { timeout: 10000 },
  );
  const contextMenuText = await waitForPopupText(page, 'makan');
  const menuCard = await piercedText(page, { className: 'entry__spelling' });
  check(
    'Kartu hasil menu konteks menampilkan bentuk kamus, bukan teks terpilih',
    menuCard.includes('食べる') && !menuCard.includes('食べました'),
    menuCard,
  );
  check(
    'Popup dari menu konteks memakai teks terpilih, bukan kata di bawah pointer',
    // Teks terpilih "食べました" menghasilkan entri kamus 食べる; kata di bawah pointer
    // saat itu adalah 学生 sehingga entri itu tidak boleh muncul.
    contextMenuText.includes('食べる') &&
      contextMenuText.includes('makan') &&
      !contextMenuText.includes('学生'),
    contextMenuText.replaceAll('\n', ' | ').slice(0, 200),
  );
  await page.screenshot({ path: path.join(artifactsDir, 'selection-popup.png') });
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.keyboard.press('Escape');

  // Area yang dapat diedit tidak dipindai.
  const field = page.locator('#field');
  const fieldBox = await field.boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(fieldBox.x + 10, fieldBox.y + fieldBox.height / 2);
  await page.mouse.move(fieldBox.x + 20, fieldBox.y + fieldBox.height / 2);
  await page.waitForTimeout(500);
  check(
    'Area input tidak dipindai meski modifier ditahan',
    (await popupHost.getAttribute('hidden')) !== null,
  );
  await page.keyboard.up('Alt');

  // 8. Kegagalan lookup tidak menampilkan hasil dari kueri lama (kueri kosong).
  const emptyResult = await sendMessage(settings, 'LOOKUP', { query: '', source: 'manual' });
  check(
    'Kueri kosong ditolak dengan status terkontrol',
    emptyResult.response.ok === true && emptyResult.response.data.status === 'empty-query',
  );

  // 9. Validasi pesan pada permukaan extension.
  const malformed = await settings.evaluate(() =>
    chrome.runtime.sendMessage({ v: 1, id: crypto.randomUUID(), type: 'TIDAK_ADA', payload: {} }),
  );
  check(
    'Pesan dengan tipe tidak dikenal menghasilkan kode error terkontrol',
    malformed.response.ok === false && malformed.response.error.code === 'UNKNOWN_TYPE',
  );

  // 10. Preferensi bertahan: ubah tema lewat UI.
  await settings.click('#tab-about');
  // Toggle global: mematikan pemindaian semua situs.
  const togglePage = await context.newPage();
  await togglePage.goto(origin);
  await togglePage.waitForSelector('[data-shirabe="popup"]', { state: 'attached', timeout: 15000 });
  await sendMessage(settings, 'SETTINGS_SET', { changes: { scanAllSites: false } });
  await togglePage.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]') === null,
    null,
    { timeout: 10000 },
  );
  check('Memindai semua situs dapat dimatikan secara global', true);
  await sendMessage(settings, 'SETTINGS_SET', { changes: { scanAllSites: true } });
  await togglePage.waitForSelector('[data-shirabe="popup"]', { state: 'attached', timeout: 10000 });
  check('Menyalakan kembali pemindaian global langsung aktif di tab terbuka', true);
  const aboutTexts = await settings.evaluate(() => ({
    header: document.getElementById('version')?.textContent ?? '',
    card: document.getElementById('about-version')?.textContent ?? '',
  }));
  check(
    'Label versi tidak berulang di kartu Umum',
    /^Versi \d/u.test(aboutTexts.header) && aboutTexts.card === aboutTexts.header,
    JSON.stringify(aboutTexts),
  );
  await togglePage.close();

  await settings.click('#tab-about');
  await settings.selectOption('#setting-theme', 'dark');
  await settings.waitForTimeout(300);
  check(
    'Tema terang/gelap dapat diubah dari pengaturan',
    (await settings.locator('html').getAttribute('data-theme')) === 'dark' &&
      (await settings.locator('html').getAttribute('data-theme-name')) === 'shirabe-dark',
  );

  // Tema katalog (adaptasi katalog Hachidori/GSM) dapat dipilih dan langsung berlaku.
  const themeGroups = await settings.evaluate(() =>
    [...document.querySelectorAll('#setting-theme optgroup')].map((group) => ({
      label: group.getAttribute('label'),
      count: group.querySelectorAll('option').length,
    })),
  );
  await settings.selectOption('#setting-theme', 'autumn');
  await settings.waitForTimeout(300);
  const autumnState = await settings.evaluate(() => {
    const style = getComputedStyle(document.body);
    const root = document.documentElement;
    return {
      theme: root.dataset.theme,
      name: root.dataset.themeName,
      background: style.backgroundColor,
      foreground: style.color,
      palettePrimary: root.style.getPropertyValue('--pal-primary').trim(),
    };
  });
  await settings.screenshot({ path: path.join(artifactsDir, 'settings-theme-autumn.png') });
  check(
    'Tema katalog dapat dipilih dan mengganti palet',
    autumnState.name === 'autumn' &&
      autumnState.theme === 'light' &&
      autumnState.background === 'rgb(251, 246, 233)' &&
      autumnState.palettePrimary === '#596b3b',
    JSON.stringify(autumnState),
  );
  check(
    'Pemilih tema menampilkan grup katalog (otomatis, gelap, terang, kontras tinggi)',
    themeGroups.length === 4 &&
      themeGroups.every((group) => group.count > 0) &&
      themeGroups.some((group) => group.count > 20),
    JSON.stringify(themeGroups),
  );
  // Popup dalam halaman memakai palet tema yang sama (disclosure diterapkan ke panel).
  const autumnPage = await context.newPage();
  await autumnPage.goto(origin);
  await autumnPage.waitForSelector('[data-shirabe="popup"]', { state: 'attached', timeout: 15000 });
  const autumnPopup = await piercedNodeAttributes(autumnPage, { 'data-theme-name': 'autumn' });
  const popupStyle = autumnPopup[0]?.style ?? '';
  await autumnPage.screenshot({ path: path.join(artifactsDir, 'hover-popup-autumn.png') });
  const autumnComputed = await piercedComputedStyle(autumnPage, { 'data-theme-name': 'autumn' });
  check(
    'Panel popup memakai palet tema katalog terang',
    autumnComputed !== null &&
      autumnComputed['background-color'] === 'rgb(251, 246, 233)' &&
      autumnComputed['color'] === 'rgb(47, 49, 39)',
    JSON.stringify({
      background: autumnComputed?.['background-color'],
      color: autumnComputed?.['color'],
    }),
  );
  check(
    'Popup memakai tema katalog yang dipilih di pengaturan',
    autumnPopup.length === 1 &&
      popupStyle.includes('--pal-base-100: #fbf6e9') &&
      popupStyle.includes('--pal-primary: #596b3b'),
    popupStyle.slice(0, 160),
  );
  await autumnPage.close();

  // Tema pembaca monokrom (audit §4.23): hitam putih tanpa hue, teks bacaan serif.
  const hoverWord = async (target) => {
    const word = target.locator('#word');
    const box = await word.boundingBox();
    await target.keyboard.down('Alt');
    await target.mouse.move(box.x + 4, box.y + box.height / 2);
    await target.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await target.waitForFunction(
      () => document.querySelector('[data-shirabe="popup"]')?.hasAttribute('hidden') === false,
      null,
      { timeout: 10000 },
    );
    await target.waitForTimeout(250);
  };
  const popupFont = async (name) => {
    const target = await context.newPage();
    await target.goto(origin);
    await target.waitForSelector('[data-shirabe="popup"]', { state: 'attached', timeout: 15000 });
    await hoverWord(target);
    const panel = await piercedComputedStyle(target, { 'data-theme-name': name });
    const headword = await piercedComputedStyle(target, { class: 'entry__spelling' });
    await target.screenshot({ path: path.join(artifactsDir, `hover-popup-${name}.png`) });
    await target.keyboard.up('Alt');
    await target.keyboard.press('Escape');
    await target.close();
    return { panel, headword: headword?.['font-family'] ?? '' };
  };

  await settings.selectOption('#setting-theme', 'ereader-dark');
  await settings.waitForTimeout(300);
  const darkReader = await popupFont('ereader-dark');
  check(
    'Tema pembaca gelap: panel hitam dengan teks terang',
    darkReader.panel?.['background-color'] === 'rgb(17, 17, 17)' &&
      darkReader.panel?.['color'] === 'rgb(236, 236, 236)',
    JSON.stringify({
      background: darkReader.panel?.['background-color'],
      color: darkReader.panel?.['color'],
    }),
  );
  check(
    'Tema pembaca memakai serif untuk teks bacaan',
    /Georgia|Mincho|serif/u.test(darkReader.headword),
    darkReader.headword,
  );

  await settings.selectOption('#setting-theme', 'ereader-light');
  await settings.waitForTimeout(300);
  const lightReader = await popupFont('ereader-light');
  check(
    'Tema pembaca terang: panel putih dengan tinta hitam',
    lightReader.panel?.['background-color'] === 'rgb(255, 255, 255)' &&
      lightReader.panel?.['color'] === 'rgb(0, 0, 0)',
    JSON.stringify({
      background: lightReader.panel?.['background-color'],
      color: lightReader.panel?.['color'],
    }),
  );

  // Serif hanya milik tema pembaca; tema lain tetap memakai font permukaan.
  await settings.selectOption('#setting-theme', 'dark');
  await settings.waitForTimeout(300);
  const sansPage = await context.newPage();
  await sansPage.goto(searchUrl('学生'));
  await sansPage.waitForSelector('[data-role="entry"]', { timeout: 15000 });
  const sansFont = await sansPage
    .locator('.entry__spelling')
    .first()
    .evaluate((node) => getComputedStyle(node).fontFamily);
  check(
    'Serif teks bacaan hanya berlaku pada tema pembaca',
    !/Georgia|Mincho/u.test(sansFont),
    sansFont,
  );
  await sansPage.close();


  // 11. Restart browser: kamus dan preferensi tetap tersedia.
  await context.close();
  context = await launch(profileDir, extensionDir);
  const restartedId = await extensionId(context);
  check('Extension tetap dapat dimuat setelah restart', restartedId === id);

  const settingsAfter = await context.newPage();
  await settingsAfter.goto(settingsUrl);
  await settingsAfter.waitForSelector('.dictionary', { timeout: 30000 });
  check(
    'Kamus tetap terpasang setelah browser dimulai ulang',
    (await settingsAfter.locator('.dictionary').first().innerText()).includes('34 istilah'),
  );
  check(
    'Preferensi tetap tersimpan setelah browser dimulai ulang',
    (await settingsAfter.locator('html').getAttribute('data-theme')) === 'dark' &&
      (await settingsAfter.locator('#setting-theme').inputValue()) === 'dark',
  );

  const searchAfter = await context.newPage();
  await searchAfter.goto(searchUrl('学生'));
  await searchAfter.waitForSelector('[data-role="entry"]', { timeout: 15000 });
  check(
    'Lookup tetap berfungsi setelah restart (tanpa memuat ulang dataset)',
    (await textWithoutRuby(searchAfter.locator('[data-role="entry"]').first())).includes('学生'),
  );

  // 12. Nonaktifkan kamus: hasil lookup kosong, status dijelaskan.
  await sendMessage(settingsAfter, 'DICTIONARY_ENABLE', { id: 'shirabe-demo-mini', enabled: false });
  await searchAfter.goto(searchUrl('学生'));
  await searchAfter.waitForTimeout(600);
  const disabledMessage = await textWithoutRuby(searchAfter.locator('#results'));
  check(
    'Kamus nonaktif tidak dipakai untuk lookup',
    disabledMessage.includes('Tidak ada hasil') && disabledMessage.includes('kamus aktif'),
    disabledMessage.replaceAll('\n', ' | ').slice(0, 140),
  );

  await sendMessage(settingsAfter, 'DICTIONARY_ENABLE', { id: 'shirabe-demo-mini', enabled: true });
  await searchAfter.goto(searchUrl('学生'));
  await searchAfter.waitForSelector('[data-role="entry"]', { timeout: 15000 });

  // 13. Hapus kamus.
  await settingsAfter.evaluate(() =>
    Promise.resolve(document.querySelector('#tab-dictionaries')?.click()),
  );
  const firstDictionaryRow = settingsAfter.locator('.dictionary').first();
  await firstDictionaryRow.getByRole('button', { name: 'Detail' }).click();
  const removeButton = firstDictionaryRow.getByRole('button', { name: 'Hapus' }).first();
  await removeButton.click();
  await settingsAfter.waitForSelector('#confirm-dialog[open]');
  const confirmBody = await settingsAfter.locator('#confirm-body').innerText();
  check(
    'Konfirmasi penghapusan menyebut nama kamus dan jumlah data',
    confirmBody.includes('Kamus Contoh Shirabe') && confirmBody.includes('34 entri'),
    confirmBody.slice(0, 160),
  );
  await settingsAfter.locator('#confirm-accept').click();
  await settingsAfter.waitForFunction(
    () => document.querySelectorAll('.dictionary').length === 0,
    null,
    { timeout: 30000 },
  );
  check('Kamus dapat dihapus beserta entry-nya', true);
  const afterDeleteStorage = await settingsAfter.locator('#storage-summary').innerText();
  check(
    'Storage kembali kosong setelah kamus dihapus',
    afterDeleteStorage.includes('0 entry'),
    afterDeleteStorage,
  );

  // 14. Impor ZIP Yomitan langsung dari extension (adapter subset).
  const yomitanZip = path.join(projectRoot, 'tests', 'fixtures', 'yomitan-demo.zip');
  await settingsAfter.setInputFiles('#import-input', yomitanZip);
  await settingsAfter.waitForFunction(
    () => document.querySelectorAll('.dictionary').length === 1,
    null,
    { timeout: 60000 },
  );
  const zipMessages = (await settingsAfter.locator('#import-messages').innerText()).replaceAll('\n', ' | ');
  check(
    'ZIP Yomitan dapat diimpor langsung dari extension',
    zipMessages.includes('ZIP Yomitan') && zipMessages.includes('Kamus Uji Yomitan'),
    zipMessages.slice(0, 220),
  );
  check(
    'Entry Yomitan dikonversi dan laporan menyebut jumlah entry',
    zipMessages.includes('5 entri'),
    zipMessages.slice(0, 220),
  );
  check(
    'Komponen arsip yang diabaikan dilaporkan (tag bank)',
    zipMessages.includes('tag_bank_1.json'),
    zipMessages.slice(0, 260),
  );
  check(
    'Entry yang dilewati dilaporkan beserta alasannya',
    zipMessages.includes('2 entry dilewati') && zipMessages.includes('definitions'),
    zipMessages.slice(0, 300),
  );
  const zipSearch = await context.newPage();
  await zipSearch.goto(searchUrl('食べる'));
  await zipSearch.waitForSelector('[data-role="entry"]', { timeout: 15000 });
  const zipResult = await textWithoutRuby(zipSearch.locator('[data-role="entry"]').first());
  check(
    'Kamus hasil impor ZIP dapat dipakai untuk lookup',
    zipResult.includes('食べる') && zipResult.includes('to eat'),
    zipResult.replaceAll('\n', ' | ').slice(0, 140),
  );
  await zipSearch.goto(searchUrl('食べました'));
  await zipSearch.waitForSelector('[data-role="entry"]', { timeout: 15000 });
  check(
    'Deinflection bekerja pada tag aturan gaya Yomitan (rules: v1)',
    (await textWithoutRuby(zipSearch.locator('[data-role="entry"]').first())).includes('食べる'),
  );
  await zipSearch.close();

  // 15. Dua kamus aktif: tab sumber kamus menyaring panel definisi.
  await settingsAfter.setInputFiles('#import-input', fixture);
  await settingsAfter.waitForFunction(
    () => document.querySelectorAll('.dictionary').length === 2,
    null,
    { timeout: 60000 },
  );
  const tabSearch = await context.newPage();
  await tabSearch.goto(searchUrl('食べる'));
  await tabSearch.waitForSelector('[data-role="dictionary-tabs"]', { timeout: 15000 });
  const tabLabels = await tabSearch.locator('.dict-tab').allInnerTexts();
  const entriesBefore = await tabSearch.locator('[data-role="entry"]').count();
  const panelsBefore = await tabSearch.locator('[data-role="dictionary-panel"]').count();
  const labelsBefore = await tabSearch.locator('.entry__dictionary').allInnerTexts();
  check(
    'Tab sumber kamus muncul saat hasil berasal dari beberapa kamus',
    tabLabels.length === 3 &&
      tabLabels[0]?.startsWith('Semua') &&
      // Daftar entri datar (pola jl-scroll): tidak ada panel per kamus, nama kamus
      // ditampilkan pada tiap kartu.
      panelsBefore === 0 &&
      entriesBefore === 2 &&
      new Set(labelsBefore).size === 2,
    `${tabLabels.join(' | ')} · ${entriesBefore} entri · ${labelsBefore.join(' | ')}`,
  );
  await tabSearch.locator('.dict-tab').nth(1).click();
  await tabSearch.waitForFunction(
    () => document.querySelectorAll('[data-role="entry"]').length === 1,
    null,
    { timeout: 10000 },
  );
  const activeTab = (await tabSearch.locator('.dict-tab[aria-pressed="true"]').innerText())
    .replaceAll('\n', ' ')
    .replace(/\s*\d+$/, '')
    .trim()
    .toLowerCase();
  const activeDictionary = (await tabSearch.locator('.entry__dictionary').first().innerText())
    .replaceAll('\n', ' ')
    .trim()
    .toLowerCase();
  const filteredEntries = await tabSearch.locator('[data-role="entry"]').count();
  check(
    'Memilih tab menyaring daftar entri sesuai kamus yang dipilih',
    activeTab === activeDictionary && filteredEntries === 1,
    `tab=${activeTab} kartu=${activeDictionary} entri=${filteredEntries}`,
  );
  await tabSearch.locator('.dict-tab').first().click();
  await tabSearch.waitForFunction(
    () => document.querySelectorAll('[data-role="entry"]').length === 2,
    null,
    { timeout: 10000 },
  );
  check('Tab Semua menampilkan kembali seluruh kamus', true);

  // Popup hover dengan dua kamus aktif: kata yang di-lookup tampil sekali di header,
  // kartu di bawahnya hanya memuat isi kamus (tanpa mengulang kosakata).
  const popupPage = await context.newPage();
  await popupPage.goto(origin);
  await popupPage.waitForSelector('[data-shirabe="popup"]', { state: 'attached', timeout: 15000 });
  const wordBox = await popupPage.locator('#word').boundingBox();
  await popupPage.keyboard.down('Alt');
  await popupPage.mouse.move(wordBox.x + 4, wordBox.y + wordBox.height / 2);
  await popupPage.mouse.move(wordBox.x + wordBox.width / 2, wordBox.y + wordBox.height / 2);
  await popupPage.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]')?.hasAttribute('hidden') === false,
    null,
    { timeout: 10000 },
  );
  const twoDictionaryText = await waitForPopupText(popupPage, 'pelajar; mahasiswa');
  const popupDictionaries = await piercedNodes(popupPage, { 'data-role': 'dictionary-panel' });
  const popupCards = await piercedNodes(popupPage, { 'data-role': 'entry' });
  const popupTabStrip = await piercedNodes(popupPage, { 'data-role': 'dictionary-tabs' });
  const popupTabButtons = await piercedNodes(popupPage, { class: 'dict-tab' });
  check(
    'Popup dua kamus: kartu per kamus dengan tab di header',
    // Setiap kartu menampilkan headword + bacaan + label kamusnya sendiri.
      twoDictionaryText.split('学生').length - 1 === 2 &&
      twoDictionaryText.includes('pelajar; mahasiswa') &&
      twoDictionaryText.includes('student') &&
      // Daftar entri datar: tiap kamus punya kartu sendiri dengan label kamusnya.
      popupDictionaries.length === 0 &&
      popupCards.length === 2 &&
      // Tab sumber kamus berada di header popup (pola `jl-header > jl-tabs`).
      popupTabStrip.length === 1 &&
      popupTabButtons.length === 3,
    `${popupCards.length} kartu · ${popupTabButtons.length} tab · ${twoDictionaryText.slice(0, 120)}`,
  );
  await popupPage.keyboard.press('Escape');
  await popupPage.keyboard.up('Alt');
  await popupPage.close();
  await tabSearch.screenshot({ path: path.join(artifactsDir, 'search-tabs.png'), fullPage: true });
  await tabSearch.close();
  await settingsAfter.screenshot({ path: path.join(artifactsDir, 'settings-yomitan-zip.png'), fullPage: true });

  // 16. Kamus yang memecah sense menjadi beberapa baris: satu kartu, sense bernomor.
  const multiSenseFixture = path.join(projectRoot, 'tests', 'fixtures', 'demo-multi-sense.jsonl');
  await settingsAfter.setInputFiles('#import-input', multiSenseFixture);
  await settingsAfter.waitForFunction(
    () => document.querySelectorAll('.dictionary').length === 3,
    null,
    { timeout: 60000 },
  );
  const senseSearch = await context.newPage();
  await senseSearch.goto(searchUrl('傾ける'));
  await senseSearch.waitForSelector('[data-role="entry"]', { timeout: 15000 });
  const senseCards = await senseSearch.locator('[data-role="entry"]').count();
  const senseCard = senseSearch.locator('[data-role="entry"]').first();
  const senseText = await textWithoutRuby(senseCard);
  const senses = await senseCard.locator('.definitions__item').allInnerTexts();
  const glosses = await senseCard.locator('.glosses__item').allInnerTexts();
  const metas = await senseCard.locator('.definitions__meta').allInnerTexts();
  check(
    'Baris dengan kata sama digabung menjadi satu kartu dengan sense bernomor',
    senseCards === 1 &&
      (await senseCard.getAttribute('data-rows')) === '4' &&
      senses.length === 4 &&
      glosses.length === 6 &&
      (await senseCard.locator('.definitions__item .glosses').count()) === 4,
    `${senseCards} kartu · data-rows=${await senseCard.getAttribute('data-rows')} · ${senses.length} sense / ${glosses.length} glosarium`,
  );
  check(
    'Metadata sense ditulis inline dan penanda nomor sense tidak diulang',
    // Metadata tampil per sense dalam tanda kurung siku. Tag angka (nomor sense dataset)
    // tidak muncul di dalamnya karena nomor sudah diberikan daftar berurut, dan tag
    // prioritas/frekuensi (`ichi`) juga disaring.
    metas.length === 4 &&
      metas[0] === '[v1, vt]' &&
      metas.every((meta) => !/\[\s*\d/.test(meta)) &&
      metas.every((meta) => !meta.includes('ichi')) &&
      senseText.includes('memiringkan') &&
      senseText.includes('menenggak (alkohol)'),
    metas.join(' | '),
  );
  await senseSearch.screenshot({ path: path.join(artifactsDir, 'search-multi-sense.png'), fullPage: true });
  await senseSearch.close();

  // 17. Schema v2: tabel bentuk kata (glosarium `forms` JMdict) harus jadi tabel asli,
  //     bukan sederet teks yang menempel.
  const structuredFixture = path.join(projectRoot, 'tests', 'fixtures', 'demo-structured.jsonl');
  await settingsAfter.setInputFiles('#import-input', structuredFixture);
  await settingsAfter.waitForFunction(
    () => document.querySelectorAll('.dictionary').length === 4,
    null,
    { timeout: 60000 },
  );
  const tableSearch = await context.newPage();
  await tableSearch.goto(searchUrl('俺'));
  await tableSearch.waitForSelector('[data-role="entry"]', { timeout: 15000 });
  const tableCard = tableSearch.locator('[data-role="entry"]').first();
  const scTable = tableCard.locator('table.sc-table');
  const tableWrap = tableCard.locator('.sc-table-wrap');
  const tableRows = await scTable.locator('tr').count();
  const tableHeaders = await scTable.locator('th').allInnerTexts();
  const tableCells = await scTable.locator('td').allInnerTexts();
  const firstThAlign = await scTable.locator('th').nth(1).evaluate((node) => node.style.textAlign);
  check(
    'Definisi berstruktur dirender sebagai tabel asli dengan seluruh selnya',
    (await scTable.count()) === 1 &&
      (await tableWrap.count()) === 1 &&
      tableRows === 5 &&
      tableHeaders.slice(0, 4).join('|') === '|俺|己|∅' &&
      tableCells.includes('★') &&
      tableCells.includes('🅁') &&
      firstThAlign === 'center',
    `${tableRows} baris · th=${tableHeaders.slice(0, 4).join(',')} · td=${tableCells.length}`,
  );
  await tableSearch.screenshot({ path: path.join(artifactsDir, 'search-structured-table.png'), fullPage: true });
  await tableSearch.goto(searchUrl('手伝い'));
  await tableSearch.waitForSelector('[data-role="entry"]', { timeout: 15000 });
  const notesEntry = tableSearch.locator('[data-role="entry"]').first();
  const notesNode = notesEntry.locator('[data-content="notes"]');
  check(
    'Daftar catatan tetap membawa penandanya, bukan diratakan menjadi teks biasa',
    // Browser menormalkan kutipan (Chrome menulis `"📝 "`), jadi cukup penandanya.
    (await notesNode.count()) === 1 &&
      (await notesNode.evaluate((node) => node.style.getPropertyValue('list-style-type'))).includes('📝') &&
      (await notesNode.first().innerText()).includes('biasanya ditulis kana'),
    `${await notesNode.count()} daftar · penanda=${await notesNode.first().evaluate((node) => node.style.getPropertyValue('list-style-type'))}`,
  );
  await tableSearch.close();

  // 20. Bank kanji, bank meta (pitch/frekuensi), dan berkas media kamus.
  const mediaMetaZip = path.join(projectRoot, 'tests', 'fixtures', 'yomitan-media-meta.zip');
  await settingsAfter.setInputFiles('#import-input', mediaMetaZip);
  await settingsAfter.waitForFunction(
    () => document.querySelectorAll('.dictionary').length === 5,
    null,
    { timeout: 60000 },
  );
  const mediaMessages = (await settingsAfter.locator('#import-messages').innerText()).replaceAll('\n', ' | ');
  check(
    'ZIP dengan bank kanji/meta/gambar diimpor beserta seluruh data turunannya',
    // Meta dihitung per record: pitch punya bacaan, frekuensi tidak (berlaku untuk
    // bacaan apa pun), jadi tersimpan sebagai dua record.
    mediaMessages.includes('3 kanji') && mediaMessages.includes('2 meta') && mediaMessages.includes('1 gambar'),
    mediaMessages.slice(0, 320),
  );
  const contentsNote = (await settingsAfter.locator('.dictionary').last().innerText()).replaceAll('\n', ' | ');
  check(
    'Daftar kamus meringkas kanji/meta/gambar yang tersimpan',
    contentsNote.includes('kanji') && contentsNote.includes('meta') && contentsNote.includes('gambar'),
    contentsNote.slice(0, 240),
  );
  const mediaSearch = await context.newPage();
  await mediaSearch.goto(searchUrl('学生'));
  await mediaSearch.waitForSelector('[data-role="entry"]', { timeout: 15000 });
  // Bacaan diganti kontur nada: がくせい = 4 mora, heiban (mora pertama rendah, sisanya tinggi).
  const contourShape = await mediaSearch
    .locator('.entry__reading--pitch .pitch-reading')
    .first()
    .evaluate((node) => ({
      category: node.getAttribute('data-pitch-category'),
      position: node.getAttribute('data-pitch-position'),
      title: node.getAttribute('title'),
      morae: [...node.querySelectorAll('.pitch-reading__mora')].map((mora) => ({
        text: mora.textContent,
        level: mora.getAttribute('data-pitch-level'),
        transition: mora.getAttribute('data-pitch-transition'),
      })),
    }));
  check(
    'Bacaan diganti kontur nada (kana + garis naik/turun) saat kamus pitch terpasang',
    contourShape.category === 'heiban' &&
      contourShape.position === '0' &&
      (contourShape.title ?? '').includes('aksen datar') &&
      contourShape.morae.length === 4 &&
      contourShape.morae.map((mora) => mora.text).join('') === 'がくせい' &&
      contourShape.morae[0]?.level === 'low' &&
      contourShape.morae[1]?.level === 'high' &&
      contourShape.morae[1]?.transition === 'up',
    JSON.stringify(contourShape).slice(0, 260),
  );

  // Frekuensi: barisnya sendiri di bawah headword, tiap chip menyebut kamusnya.
  const frequencyRow = mediaSearch.locator('.entry__frequencies').first();
  const frequencyChips = await frequencyRow
    .locator('.meta-badge--freq')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        source: node.querySelector('.meta-badge__source')?.textContent ?? '',
        value: node.querySelector('.meta-badge__value')?.textContent ?? '',
      })),
    );
  const frequenciesInsideTop = await mediaSearch
    .locator('.entry__top .meta-badge--freq')
    .count();
  check(
    'Frekuensi tampil di baris terpisah di bawah headword beserta nama kamusnya',
    frequenciesInsideTop === 0 &&
      frequencyChips.some((chip) => chip.value === '123㋕') &&
      frequencyChips.every((chip) => chip.source.length > 0),
    `${frequenciesInsideTop} chip sejajar headword · ${JSON.stringify(frequencyChips.slice(0, 3))}`,
  );
  // Roda mouse menggeser strip tab mendatar di permukaan yang sama (panel hasil dipakai
  // bersama popup): viewport sempit memaksa strip melebihi lebarnya.
  await mediaSearch.setViewportSize({ width: 420, height: 620 });
  await mediaSearch.goto(searchUrl('学生'));
  await mediaSearch.waitForSelector('[data-role="dictionary-tabs"]', { timeout: 15000 });
  const stripBefore = await mediaSearch
    .locator('[data-role="dictionary-tabs"]')
    .evaluate((node) => ({ scrollLeft: node.scrollLeft, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  const stripBox = await mediaSearch.locator('[data-role="dictionary-tabs"]').boundingBox();
  await mediaSearch.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2);
  await mediaSearch.mouse.wheel(0, 200);
  await mediaSearch.waitForTimeout(150);
  const stripAfter = await mediaSearch
    .locator('[data-role="dictionary-tabs"]')
    .evaluate((node) => node.scrollLeft);
  check(
    'Roda mouse menggeser strip tab kamus mendatar',
    stripBefore.scrollWidth > stripBefore.clientWidth && stripAfter > stripBefore.scrollLeft,
    `lebar=${stripBefore.scrollWidth}/${stripBefore.clientWidth} · scrollLeft ${stripBefore.scrollLeft} → ${stripAfter}`,
  );
  await mediaSearch.setViewportSize({ width: 1000, height: 700 });
  await mediaSearch.goto(searchUrl('学生'));
  await mediaSearch.waitForSelector('[data-role="entry"]', { timeout: 15000 });

  const mediaImage = mediaSearch.locator('.sc-img').first();
  await mediaImage.waitFor({ state: 'attached', timeout: 15000 });
  await mediaSearch.waitForFunction(
    () => {
      const node = document.querySelector('.sc-img');
      return node instanceof HTMLImageElement && node.naturalWidth > 0;
    },
    null,
    { timeout: 15000 },
  );
  const imageState = await mediaImage.evaluate((node) => ({
    src: node.getAttribute('src') ?? '',
    width: node.naturalWidth,
  }));
  check(
    'Gambar kamus dirender dari store media (data URL, tanpa permintaan jaringan)',
    imageState.src.startsWith('data:image/png;base64,') && imageState.width === 16,
    `src=${imageState.src.slice(0, 28)}… naturalWidth=${imageState.width}`,
  );
  await mediaSearch.screenshot({ path: path.join(artifactsDir, 'search-meta-image.png'), fullPage: true });
  await mediaSearch.close();

  // Klik kanji pada headword popup meminta data bank kanji (source `kanji`).
  const kanjiPopup = await context.newPage();
  await kanjiPopup.goto(origin);
  await kanjiPopup.waitForSelector('[data-shirabe="popup"]', { state: 'attached', timeout: 15000 });
  const kanjiWordBox = await kanjiPopup.locator('#word').boundingBox();
  await kanjiPopup.keyboard.down('Alt');
  await kanjiPopup.mouse.move(kanjiWordBox.x + 4, kanjiWordBox.y + kanjiWordBox.height / 2);
  await kanjiPopup.mouse.move(kanjiWordBox.x + kanjiWordBox.width / 2, kanjiWordBox.y + kanjiWordBox.height / 2);
  await kanjiPopup.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]')?.hasAttribute('hidden') === false,
    null,
    { timeout: 10000 },
  );
  // Tunggu hasil terender dulu: strip tab baru ada setelah daftar sumber kamus diketahui.
  await waitForPierced(kanjiPopup, { 'data-role': 'entry' }, 15000);
  // Modifier dilepas sebelum kursor dipindahkan ke dalam popup: dengan modifier ditahan,
  // setiap gerakan kursor memicu pemindaian baru yang menutup/mengganti popup.
  await kanjiPopup.keyboard.up('Alt');
  const popupStrip = await piercedNodeEval(
    kanjiPopup,
    { 'data-role': 'dictionary-tabs' },
    '{ scrollWidth: this.scrollWidth, clientWidth: this.clientWidth }',
  );
  check(
    'Strip tab kamus di popup dapat digulir mendatar saat melebihi lebarnya',
    popupStrip.scrollWidth > popupStrip.clientWidth,
    `lebar isi=${popupStrip.scrollWidth} · lebar tampak=${popupStrip.clientWidth}`,
  );
  await kanjiPopup.screenshot({ path: path.join(artifactsDir, 'popup-pitch-graph.png') });
  await piercedClick(kanjiPopup, { class: 'entry__kanji' });
  await kanjiPopup.waitForFunction(
    () => document.querySelector('[data-shirabe="popup"]')?.getAttribute('data-state') === 'ready',
    null,
    { timeout: 15000 },
  );
  const kanjiBlocks = await waitForPierced(kanjiPopup, { 'data-role': 'kanji' }, 15000);
  const kanjiBlockText = kanjiBlocks > 0 ? await waitForPopupText(kanjiPopup, 'study') : '';
  check(
    'Klik kanji pada headword popup menampilkan bank kanji (arti, bacaan, statistik)',
    kanjiBlocks === 1 &&
      kanjiBlockText.includes('学') &&
      kanjiBlockText.includes('study') &&
      kanjiBlockText.includes('ガク') &&
      kanjiBlockText.includes('8'),
    kanjiBlockText.replaceAll('\n', ' | ').slice(0, 200),
  );
  await kanjiPopup.screenshot({ path: path.join(artifactsDir, 'popup-kanji.png') });
  await kanjiPopup.keyboard.up('Alt');
  await kanjiPopup.close();

  // 21. Baris kamus ringkas dan urutan kamus dengan seret.
  await settingsAfter.evaluate(() =>
    Promise.resolve(document.querySelector('#tab-dictionaries')?.click()),
  );
  const dictionaryRows = settingsAfter.locator('.dictionary');
  const rowCount = await dictionaryRows.count();
  const detailHidden = await settingsAfter.locator('.dictionary__detail').first().isHidden();
  const factsFirst = await settingsAfter.locator('.dictionary__facts').first().innerText();
  check(
    'Baris kamus ringkas: judul dan ringkasan isi, detail tersembunyi sampai dibuka',
    rowCount === 5 &&
      detailHidden &&
      /istilah|kanji|meta|gambar/u.test(factsFirst),
    `${rowCount} baris · ringkasan="${factsFirst}" · detail tersembunyi=${detailHidden}`,
  );
  await dictionaryRows.first().getByRole('button', { name: 'Detail' }).click();
  check(
    'Tombol Detail membuka informasi lengkap kamus (lisensi dan atribusi)',
    (await settingsAfter.locator('.dictionary__detail').first().innerText()).includes('Lisensi'),
  );

  // Aksi harian harus tersedia tanpa membuka panel Detail.
  const secondRow = dictionaryRows.nth(1);
  const rowActionsVisible =
    (await secondRow.getByRole('button', { name: 'Hapus' }).isVisible()) &&
    (await secondRow.getByRole('button', { name: /Nonaktifkan|Aktifkan/ }).isVisible()) &&
    (await secondRow.getByRole('button', { name: 'Naikkan' }).isVisible()) &&
    (await secondRow.getByRole('button', { name: 'Detail' }).isVisible());
  check(
    'Aksi aktif/nonaktif, urutan, dan hapus terlihat tanpa membuka Detail',
    rowActionsVisible,
  );

  // Tombol aksi memakai glyph, jadi setiap tombol wajib tetap punya nama aksesibel.
  const namedButtons = await secondRow.evaluate((row) =>
    [...row.querySelectorAll('button')].map((button) => ({
      text: button.textContent?.trim() ?? '',
      label: button.getAttribute('aria-label') ?? '',
      title: button.getAttribute('title') ?? '',
    })),
  );
  check(
    'Tombol glyph tetap punya nama aksesibel dan tooltip',
    namedButtons.length === 5 &&
      namedButtons.every((button) => button.label.length > 0 && button.title.length > 0),
    namedButtons.map((button) => `${button.text}→${button.label}`).join(' · '),
  );

  // Mode pilih: checkbox per baris + bilah aksi massal.
  await settingsAfter.locator('#tab-dictionaries').click();
  await settingsAfter.locator('#dictionary-select-mode').focus();
  await settingsAfter.keyboard.press('Space');
  const bulkVisible = await settingsAfter.locator('#dictionary-bulk').isVisible();
  check(
    'Mode pilih dapat dinyalakan dengan keyboard (fokus + Space)',
    bulkVisible && (await settingsAfter.locator('#dictionary-select-mode').isChecked()),
  );
  const checkboxes = await settingsAfter.locator('.dictionary__select:visible').count();
  check(
    'Mode pilih menampilkan checkbox per baris dan bilah aksi massal',
    bulkVisible && checkboxes === rowCount,
    `bilah=${bulkVisible} · checkbox=${checkboxes}/${rowCount}`,
  );

  await settingsAfter.locator('#dictionary-select-all').click();
  const selectedCount = await settingsAfter.locator('#dictionary-selected-count').innerText();
  const checkedCount = await settingsAfter.locator('.dictionary__select:checked').count();
  check(
    'Pilih semua mencentang seluruh kamus dan menampilkan jumlahnya',
    checkedCount === rowCount && /\d/.test(selectedCount),
    `${selectedCount} · checkbox tercentang=${checkedCount}`,
  );

  await settingsAfter.locator('#dictionary-bulk-disable').click();
  await settingsAfter.waitForFunction(
    () => document.querySelector('#global-status')?.textContent?.includes('dinonaktifkan') ||
      document.querySelector('#global-status')?.textContent?.includes('disabled'),
    null,
    { timeout: 30000 },
  );
  const disabledRows = await settingsAfter.locator('.dictionary .status', { hasText: /Nonaktif|Disabled/ }).count();
  check(
    'Aksi massal nonaktifkan berlaku untuk semua kamus terpilih',
    disabledRows === rowCount,
    `${disabledRows}/${rowCount} baris nonaktif`,
  );

  await settingsAfter.locator('#dictionary-select-all').click();
  await settingsAfter.locator('#dictionary-bulk-enable').click();
  await settingsAfter.waitForFunction(
    () => document.querySelector('#global-status')?.textContent?.includes('diaktifkan') ||
      document.querySelector('#global-status')?.textContent?.includes('enabled'),
    null,
    { timeout: 30000 },
  );
  const enabledRows = await settingsAfter.locator('.dictionary .status', { hasText: /Aktif|Enabled/ }).count();
  check(
    'Aksi massal aktifkan memulihkan seluruh kamus terpilih',
    enabledRows === rowCount,
    `${enabledRows}/${rowCount} baris aktif`,
  );

  const desktopViewport = settingsAfter.viewportSize();
  await settingsAfter.setViewportSize({ width: 420, height: 720 });
  const narrowOverflow = await settingsAfter.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  check(
    'Mode pilih tidak menimbulkan overflow horizontal di viewport sempit',
    narrowOverflow.scrollWidth <= narrowOverflow.clientWidth,
    `${narrowOverflow.scrollWidth}px isi / ${narrowOverflow.clientWidth}px tampak`,
  );
  if (desktopViewport !== null) {
    await settingsAfter.setViewportSize(desktopViewport);
  }

  await settingsAfter.locator('#dictionary-select-mode').uncheck();
  const bulkHidden = await settingsAfter.locator('#dictionary-bulk').isHidden();
  const checkboxesHidden = (await settingsAfter.locator('.dictionary__select:visible').count()) === 0;
  check(
    'Mematikan mode pilih menyembunyikan checkbox dan bilah massal',
    bulkHidden && checkboxesHidden,
    `bilah tersembunyi=${bulkHidden} · checkbox tersembunyi=${checkboxesHidden}`,
  );

  const namesBefore = await settingsAfter.locator('.dictionary__head h3').allTextContents();
  const draggedName = namesBefore.at(-1) ?? '';
  await dictionaryRows.last().dragTo(dictionaryRows.first());
  await settingsAfter.waitForFunction(
    (expected) => document.querySelector('.dictionary__head h3')?.textContent === expected,
    draggedName,
    { timeout: 15000 },
  );
  await settingsAfter.reload();
  await settingsAfter.evaluate(() =>
    Promise.resolve(document.querySelector('#tab-dictionaries')?.click()),
  );
  await settingsAfter.waitForFunction(() => document.querySelectorAll('.dictionary').length > 0, null, {
    timeout: 30000,
  });
  const namesReloaded = await settingsAfter.locator('.dictionary__head h3').allTextContents();
  check(
    'Seret baris kamus mengubah urutan dan bertahan setelah halaman dimuat ulang',
    namesReloaded[0] === draggedName && namesReloaded.length === namesBefore.length,
    `${namesBefore[0]} → ${namesReloaded[0]} (diseret: ${draggedName})`,
  );

  // Arsip rusak harus ditolak tanpa mengubah kamus yang sudah terpasang.
  const brokenZip = path.join(projectRoot, 'tests', 'fixtures', 'broken.zip');
  await settingsAfter.setInputFiles('#import-input', brokenZip);
  await settingsAfter.waitForSelector('.import-message--error', { timeout: 30000 });
  const brokenZipMessage = await settingsAfter.locator('.import-message--error').first().innerText();
  check(
    'Arsip ZIP rusak ditolak dengan pesan jelas dan kamus lama tetap utuh',
    /ZIP/i.test(brokenZipMessage) &&
      (await settingsAfter.locator('.dictionary').count()) === 5,
    brokenZipMessage.slice(0, 160),
  );

  // Aksi massal hapus: bukti bahwa kontrolnya benar-benar bekerja.
  await settingsAfter.locator('#dictionary-select-mode').check();
  await settingsAfter.locator('.dictionary').nth(0).locator('.dictionary__select').check();
  await settingsAfter.locator('.dictionary').nth(1).locator('.dictionary__select').check();
  await settingsAfter.locator('#dictionary-bulk-delete').click();
  await settingsAfter.waitForSelector('#confirm-dialog[open]', { timeout: 15000 });
  const bulkConfirmBody = await settingsAfter.locator('#confirm-body').innerText();
  await settingsAfter.locator('#confirm-accept').click();
  await settingsAfter.waitForFunction(
    () => document.querySelectorAll('.dictionary').length === 3,
    null,
    { timeout: 60000 },
  );
  check(
    'Aksi massal hapus menghapus kamus terpilih setelah konfirmasi',
    (await settingsAfter.locator('.dictionary').count()) === 3 &&
      /2|dua/.test(bulkConfirmBody),
    bulkConfirmBody.slice(0, 160),
  );

  await context.close();
  server.close();
  await rm(profileDir, { recursive: true, force: true });
  await rm(brokenFile, { force: true });

  const passed = results.filter((item) => item.ok).length;
  process.stdout.write(`\n${passed}/${results.length} pemeriksaan lulus.\n`);
  process.stdout.write(`Bukti visual: ${path.relative(projectRoot, artifactsDir)}\n`);
  if (crash.length > 0) {
    failures += crash.length;
  }
  return failures === 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  process.stderr.write(`e2e gagal: ${error?.stack ?? error}\n`);
  exitCode = 1;
}
process.exit(exitCode);
