/**
 * Mode pengembangan: bangun ulang `dist/` secara otomatis saat berkas berubah.
 *
 * Menjalankan dua build Vite dalam mode watch (halaman extension dan content script)
 * memakai skrip npm yang sudah ada, lalu menghentikan keduanya saat proses ini dihentikan
 * (Ctrl+C). Tidak ada dependency tambahan.
 *
 * Catatan Chrome: extension yang di-load unpacked dari `dist/` tetap perlu diklik
 * **Reload** di `chrome://extensions`, dan tab yang sudah terbuka perlu dimuat ulang (F5)
 * sekali — Chrome tidak menyuntikkan ulang content script ke tab lama. Popup Shirabe
 * menjelaskan hal ini bila pemindaian menemukan konteks extension yang sudah mati.
 *
 * Jalankan: npm run dev
 */

import { spawn } from 'node:child_process';

const workers = [
  { name: 'halaman', script: 'dev:pages' },
  { name: 'content', script: 'dev:content' },
];

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exitCode = code;
}

for (const worker of workers) {
  const child = spawn('npm', ['run', '--silent', worker.script], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      process.stderr.write(`\nProses ${worker.name} berhenti dengan kode ${code}.\n`);
      shutdown(code ?? 1);
    }
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

process.stdout.write(
  'Mode pengembangan aktif: dist/ dibangun ulang saat berkas berubah.\n' +
    'Setelah dist berubah: klik Reload pada kartu Shirabe di chrome://extensions, ' +
    'lalu muat ulang tab (F5) sekali.\n',
);
