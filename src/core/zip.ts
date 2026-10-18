/**
 * Pembaca ZIP minimal untuk impor kamus (PRD 8.4 fitur P1: "Import subset Yomitan").
 *
 * Yang dikerjakan sendiri hanya pembacaan struktur ZIP (End of Central Directory →
 * central directory → local header). Dekompresi dilakukan oleh browser lewat
 * `DecompressionStream('deflate-raw')`, jadi tidak ada implementasi inflate di sini.
 * Tidak ada dependency runtime tambahan.
 *
 * Batasan yang disengaja (ditolak dengan pesan jelas, bukan gagal diam-diam):
 * - ZIP64, arsip terenkripsi, dan metode kompresi selain `stored`/`deflate`.
 * - CRC32 tidak diverifikasi; integritas data ditegakkan oleh validasi JSON dan
 *   pencocokan ukuran hasil dekompresi dengan ukuran pada central directory.
 */

/** Batas ukuran satu anggota arsip yang masih dianggap wajar (byte). */
export const MAX_ZIP_MEMBER_BYTES = 256 * 1024 * 1024;

const SIGNATURE_EOCD = 0x06054b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_LOCAL = 0x04034b50;
const SIGNATURE_ZIP64_EOCD_LOCATOR = 0x07064b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  /** Flag "ukuran tidak diketahui" pada local header (data descriptor). */
  usesDataDescriptor: boolean;
}

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  const slice = blob.slice(start, Math.min(end, blob.size), 'application/octet-stream');
  return new Uint8Array(await slice.arrayBuffer());
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/** Cari End of Central Directory pada bagian akhir berkas. */
async function findEndOfCentralDirectory(blob: Blob): Promise<{ offset: number; bytes: Uint8Array }> {
  const searchSize = Math.min(blob.size, MAX_COMMENT_SIZE + EOCD_MIN_SIZE);
  const start = blob.size - searchSize;
  const bytes = await readBytes(blob, start, blob.size);
  for (let offset = bytes.length - EOCD_MIN_SIZE; offset >= 0; offset -= 1) {
    if (readUint32(bytes, offset) === SIGNATURE_EOCD) {
      return { offset: start + offset, bytes };
    }
  }
  throw new ZipFormatError('Berkas bukan arsip ZIP yang valid (End of Central Directory tidak ditemukan).');
}

/** Baca daftar anggota arsip dari central directory. */
export async function readZipEntries(blob: Blob): Promise<ZipEntry[]> {
  if (blob.size < EOCD_MIN_SIZE) {
    throw new ZipFormatError('Berkas terlalu kecil untuk menjadi arsip ZIP.');
  }
  const { offset: eocdOffset, bytes: tail } = await findEndOfCentralDirectory(blob);
  const tailOffset = eocdOffset - (blob.size - tail.length);

  const entryCount = readUint16(tail, tailOffset + 10);
  const directorySize = readUint32(tail, tailOffset + 12);
  const directoryOffset = readUint32(tail, tailOffset + 16);

  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    // Titik ini adalah penanda ZIP64; arsip Yomitan biasa tidak memakainya.
    if (readUint32(tail, Math.max(0, tailOffset - 20)) === SIGNATURE_ZIP64_EOCD_LOCATOR) {
      throw new ZipFormatError('Arsip ZIP64 belum didukung. Ekstrak lalu impor berkas JSONL-nya.');
    }
    throw new ZipFormatError('Arsip ZIP64 belum didukung.');
  }
  if (directoryOffset + directorySize > blob.size + 1) {
    throw new ZipFormatError('Central directory ZIP berada di luar berkas (arsip rusak).');
  }

  const directory = await readBytes(blob, directoryOffset, directoryOffset + directorySize);
  const entries: ZipEntry[] = [];
  let cursor = 0;
  const decoder = new TextDecoder('utf-8');

  while (cursor + 46 <= directory.length && entries.length < entryCount) {
    if (readUint32(directory, cursor) !== SIGNATURE_CENTRAL) {
      break;
    }
    const flags = readUint16(directory, cursor + 8);
    const method = readUint16(directory, cursor + 10);
    const compressedSize = readUint32(directory, cursor + 20);
    const uncompressedSize = readUint32(directory, cursor + 24);
    const nameLength = readUint16(directory, cursor + 28);
    const extraLength = readUint16(directory, cursor + 30);
    const commentLength = readUint16(directory, cursor + 32);
    const localHeaderOffset = readUint32(directory, cursor + 42);
    const nameBytes = directory.subarray(cursor + 46, cursor + 46 + nameLength);

    if ((flags & 0x1) === 0x1) {
      throw new ZipFormatError('Arsip ZIP terenkripsi (password) tidak didukung.');
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new ZipFormatError('Anggota arsip memakai ZIP64 yang belum didukung.');
    }

    entries.push({
      name: decoder.decode(nameBytes),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      usesDataDescriptor: (flags & 0x8) === 0x8,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (entries.length === 0) {
    throw new ZipFormatError('Arsip ZIP tidak berisi anggota berkas.');
  }
  return entries;
}

/** Cari anggota arsip berdasarkan namanya (case-sensitive, seperti spesifikasi ZIP). */
export function findZipEntry(entries: readonly ZipEntry[], name: string): ZipEntry | undefined {
  return entries.find((entry) => entry.name === name);
}

/** Daftar anggota yang cocok dengan sebuah pola nama. */
export function matchZipEntries(entries: readonly ZipEntry[], pattern: RegExp): ZipEntry[] {
  return entries.filter((entry) => pattern.test(entry.name));
}

function assertSupported(entry: ZipEntry): void {
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipFormatError(
      `Metode kompresi ZIP ${entry.method} pada "${entry.name}" tidak didukung (hanya stored/deflate).`,
    );
  }
  if (entry.uncompressedSize > MAX_ZIP_MEMBER_BYTES) {
    throw new ZipFormatError(
      `Anggota arsip "${entry.name}" melebihi batas ${Math.round(MAX_ZIP_MEMBER_BYTES / (1024 * 1024))} MB.`,
    );
  }
}

/** Aliran byte mentah hasil dekompresi satu anggota arsip. */
export async function openZipEntryStream(blob: Blob, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  assertSupported(entry);
  const localHeader = await readBytes(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (readUint32(localHeader, 0) !== SIGNATURE_LOCAL) {
    throw new ZipFormatError(`Local header untuk "${entry.name}" tidak valid.`);
  }
  const nameLength = readUint16(localHeader, 26);
  const extraLength = readUint16(localHeader, 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > blob.size) {
    throw new ZipFormatError(`Data untuk "${entry.name}" berada di luar berkas (arsip rusak).`);
  }
  const compressed = blob.slice(dataStart, dataEnd, 'application/octet-stream');
  const source = compressed.stream();
  if (entry.method === 0) {
    return source;
  }
  return source.pipeThrough(new DecompressionStream('deflate-raw'));
}

/** Baca satu anggota arsip sebagai byte mentah (dipakai untuk berkas media kamus). */
export async function readZipEntryBytes(blob: Blob, entry: ZipEntry): Promise<Uint8Array> {
  const reader = (await openZipEntryStream(blob, entry)).getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done === true) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > entry.uncompressedSize + 1024 || bytes > MAX_ZIP_MEMBER_BYTES) {
        throw new ZipFormatError(`Anggota arsip "${entry.name}" tidak wajar besar setelah dekompresi.`);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Baca satu anggota arsip sebagai teks UTF-8 (dekoding manual agar aman untuk streaming). */
export async function readZipEntryText(blob: Blob, entry: ZipEntry): Promise<string> {
  const reader = (await openZipEntryStream(blob, entry)).getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done === true) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > entry.uncompressedSize + 1024 || bytes > MAX_ZIP_MEMBER_BYTES) {
        throw new ZipFormatError(`Anggota arsip "${entry.name}" tidak wajar besar setelah dekompresi.`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}
