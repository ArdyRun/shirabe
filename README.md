# Shirabe

Ekstensi Chrome (Manifest V3) untuk membaca bahasa Jepang: tahan modifier dan arahkan kursor
ke kata di halaman web, lalu lihat bentuk kamus, bacaan, definisi, dan kelas kata. Lookup
berjalan lokal dari kamus di IndexedDB; tidak ada teks yang dikirim ke jaringan.

- Spesifikasi produk: [`PRD.md`](PRD.md)
- Status implementasi, keterbatasan, dan benchmark: [`docs/mvp-audit.md`](docs/mvp-audit.md)

Status saat ini: MVP. 342 unit/integration test lulus, typecheck bersih, dan build MV3 lolos
validasi manifest.

## Persyaratan

- Node.js 22+ (dikembangkan dan diuji pada Node 26).
- Chromium/Chrome desktop versi stabil untuk memasang hasil build.

## Menjalankan

```bash
npm install
npm run build          # build halaman + content script, lalu validasi manifest MV3
npm run dev            # build ulang otomatis saat berkas berubah (watch)
npm test               # 342 unit/integration test (Vitest, tanpa browser)
npm run typecheck      # pemeriksaan TypeScript
npm run e2e            # pengujian di Chromium asli (Playwright)
npm run bench          # benchmark impor/lookup/hover di Chromium asli
npm run icons          # regenerasi ikon (opsional)
npm run dataset:verify # impor dataset JSONL/ZIP ke Chromium asli + lookup pemeriksaan
npm run verify:stale   # regresi halaman yang belum dimuat ulang setelah extension di-reload
```

## Memasang di Chrome (developer mode)

1. `npm run build` (atau `npm run dev` untuk build ulang otomatis).
2. Buka `chrome://extensions`, aktifkan **Developer mode**.
3. **Load unpacked**, pilih direktori `dist/`.
4. Buka action popup Shirabe, lalu **Pengaturan** untuk mengimpor dataset.
5. Buka situs berbahasa Jepang, tahan `Alt`, arahkan kursor ke kata Jepang.

Pemindaian aktif di semua situs http/https setelah extension dipasang. Tidak ada langkah
aktivasi per situs; pengguna dapat mematikannya secara global atau per situs dari Pengaturan.

Build hanya menulis ulang berkas di `dist/`; Chrome tidak memuatnya sendiri. Setelah
`npm run build`, klik Reload pada kartu Shirabe di `chrome://extensions`, lalu muat ulang tab
(F5) agar content script yang sudah berjalan ikut diperbarui.

## Kamus

Repository ini tidak menyertakan kamus. Dataset dibeli atau dibuat pengguna sendiri, atau
pakai contoh kecil di `tests/fixtures/`: `demo-mini.jsonl`, `yomitan-demo.zip` (bank term),
dan `yomitan-media-meta.zip` (bank term + bank kanji + meta pitch/frekuensi + satu gambar).

Format yang diterima: Shirabe JSONL (v1/v2) dan ZIP Yomitan format 3 langsung, termasuk bank
term, bank kanji, `term_meta_bank_*.json` (pitch dan frekuensi), serta gambar yang
direferensikan definisi. Batas impor ditampilkan di dialog impor (128 MB per berkas, 1 juta
entry, 2 MB per media, 64 MB media per kamus). Detail format dan whitelist structured content
ada di [`PRD.md` §8](PRD.md).

Kamus yang diimpor sebelum skema penyimpanan v4 perlu diimpor ulang agar data pitch/frekuensi
terisi; impor ulang dengan ID yang sama akan menggantikan versi lamanya.

## Struktur proyek

```text
src/
  core/            mesin lookup murni (tanpa DOM/Chrome): teks, aturan deinflection,
                   kandidat, ranking, validasi JSONL, preferensi, helper situs
  data/            IndexedDB: skema, entries, pengelolaan kamus, siklus impor staging
  background/      service worker: router pesan, izin situs, preferensi, context menu
  content/         content script: scan kata, cuplikan konteks, popup Shadow DOM
  action/          action popup (pencarian manual, teks terpilih, status, izin situs)
  search/          halaman pencarian
  settings/        halaman pengaturan + alur impor streaming
  ui/              renderer kartu entri bersama, tema, i18n, helper DOM
  messaging/       protokol pesan berversi + validasinya
scripts/           validasi build, e2e Playwright, benchmark, generator ikon, verifikasi dataset
tests/             unit/integration Vitest + fixture dataset
```

## Arsitektur singkat

- **Service worker stateless.** Tidak ada state penting di memori global; koneksi IndexedDB
  dibuka kembali saat dibutuhkan.
- **Content script tanpa dataset.** Ia hanya mengirim kueri ke service worker, lalu
  menampilkan popup di dalam Shadow DOM tertutup. Pemindaian memakai *throttle* (satu
  pemindaian per 40 ms pada posisi kursor terbaru, bukan debounce), sehingga popup mengikuti
  kursor saat pengguna menyapu beberapa kata tanpa berhenti.
- **Pemindaian mulai dari karakter di bawah kursor.** Kandidat kata dimulai pada karakter
  yang ditunjuk (caret digeser ke karakter itu, seperti `alignToCharacter` Hachidori) lalu
  maju; tidak ada karakter sebelum kursor yang ikut dipindai. Arahkan kursor ke karakter
  pertama kata: di tengah `日本語` hanya `本語` yang dipindai.
- **Staging impor.** Setiap impor menulis versi dataset baru; commit hanya memindahkan
  `activeVersion`, dan versi lama dihapus setelah commit. Impor yang gagal atau terputus tidak
  pernah terlihat sebagai kamus aktif, dan dibersihkan saat startup.
- **Privasi.** Lookup berjalan lokal di IndexedDB; tidak ada analytics, tidak ada server kamus.

## Troubleshooting

**Popup masih memakai tampilan lama.** Popup dirender content script di dalam tab. Extension
yang di-load unpacked tidak menyuntikkan ulang content script ke tab yang sudah terbuka, jadi
tekan F5 pada tab halaman setelah Reload di `chrome://extensions`.

**Impor ditolak dengan "versi schema tidak didukung".** Service worker masih kode lama. Buka
Pengaturan, tab **Umum**, baris **Komponen aktif**, lalu pastikan halaman dan service worker
menampilkan schema dan build yang sama. Bila berbeda: Reload extension, atau hapus lalu Load
unpacked ulang ke `dist/`.

## Catatan legal

Repositori ini tidak menyalin kode atau teks Yomitan, Hachidori, maupun hoshidicts; keduanya
dipakai hanya sebagai referensi perilaku dan arsitektur. Nilai palet tema berasal dari katalog
palet daisyUI 5 (MIT). Lisensi proyek belum ditetapkan, dan lisensi dataset adalah tanggung
jawab pengguna yang mengimpor.
