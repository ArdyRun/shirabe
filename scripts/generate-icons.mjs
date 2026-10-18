/**
 * Generator ikon extension (tanpa dependency gambar).
 *
 * Menggambar lambang sederhana (kaca pembesar) pada latar bulat, lalu menulis PNG
 * 32-bit dengan encoder minimal berbasis `node:zlib`.
 *
 * Jalankan: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(projectRoot, 'public', 'icons');
const SIZES = [16, 32, 48, 128];

const BACKGROUND = [47, 111, 237];
const FOREGROUND = [255, 255, 255];
const HANDLE = [22, 24, 29];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function blend(target, index, color, alpha) {
  const inverse = 1 - alpha;
  target[index] = Math.round(target[index] * inverse + color[0] * alpha);
  target[index + 1] = Math.round(target[index + 1] * inverse + color[1] * alpha);
  target[index + 2] = Math.round(target[index + 2] * inverse + color[2] * alpha);
  target[index + 3] = Math.max(target[index + 3], Math.round(255 * alpha));
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size / 2 - 0.5;
  const lensRadius = size * 0.26;
  const lensStroke = Math.max(1, size * 0.09);
  const lensCenterX = size * 0.42;
  const lensCenterY = size * 0.42;
  const handleWidth = Math.max(1, size * 0.1);
  // Gagang mulai dari tepi lensa dan keluar secara diagonal 45°.
  const handleStart = lensRadius * 0.75;
  const handleEnd = lensRadius * 1.75;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // Latar bulat dengan tepi anti-alias.
      const backgroundAlpha = Math.min(1, Math.max(0, radius + 0.5 - distance));
      if (backgroundAlpha <= 0) {
        continue;
      }
      blend(pixels, index, BACKGROUND, backgroundAlpha);

      const lensDistance = Math.hypot(x - lensCenterX, y - lensCenterY);
      const ringAlpha = Math.min(
        1,
        Math.max(0, lensStroke / 2 + 0.5 - Math.abs(lensDistance - lensRadius)),
      );
      if (ringAlpha > 0) {
        blend(pixels, index, FOREGROUND, ringAlpha * backgroundAlpha);
      }

      // Gagang kaca pembesar.
      const t = ((x - lensCenterX) * 0.7071 + (y - lensCenterY) * 0.7071);
      const perpendicular = Math.abs((x - lensCenterX) * 0.7071 - (y - lensCenterY) * 0.7071);
      if (t >= handleStart && t <= handleEnd && perpendicular <= handleWidth / 2) {
        blend(pixels, index, HANDLE, backgroundAlpha);
      }
    }
  }
  return pixels;
}

mkdirSync(outputDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outputDir, `icon${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  process.stdout.write(`icon ${size}px -> ${path.relative(projectRoot, file)}\n`);
}
