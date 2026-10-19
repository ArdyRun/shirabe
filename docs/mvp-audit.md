# Audit MVP Shirabe

Dokumen ini mencatat status implementasi terhadap acceptance criteria `PRD.md`,
bukti pengujian yang benar-benar dijalankan, asumsi yang diambil untuk keputusan
terbuka, serta kekurangan yang masih tersisa.

Tanggal audit: 16 Oktober 2026. Basis: commit kerja pada repositori ini, Chromium
156.0.8078.4 (Playwright channel `chromium`), Node 26.10.0.

## 1. Ringkasan status

| Area | Status | Bukti |
|---|---|---|
| Fondasi extension MV3, build, validasi manifest | LULUS | `npm run build` (build + `scripts/validate-build.mjs`) |
| Data model, import staging/rollback, pengelolaan kamus | LULUS | 13 test `tests/data/import.test.ts`, 5 pemeriksaan e2e |
| Search core: NFC, exact, reading, ranking, kandidat, deinflection | LULUS | 26 test `tests/core/search.test.ts`, 12 `tests/core/deinflect.test.ts` |
| Integrasi halaman: hover+modifier, teks terpilih, popup, keyboard | LULUS | 81 pemeriksaan `npm run e2e` (Chromium asli) |
| UI: action popup, kartu entri kamus, halaman pencarian, pengaturan | LULUS | e2e + tangkapan layar di `artifacts/e2e/` |
| Status kosong, error, izin, storage | LULUS (kuota belum diuji) | e2e + test pesan/protokol |
| **P1: impor ZIP Yomitan langsung** (PRD 4.7) | LULUS | 52 pemeriksaan e2e + 24 test adapter/ZIP |
| NFR performa | LULUS pada perangkat uji | `artifacts/benchmark/report.json` |
| Aksesibilitas lanjutan dan browser selain Chromium | BELUM DIUJI | lihat §6 |

Jumlah pengujian otomatis: **260 test Vitest** (`npm test`), **104 pemeriksaan
integration** di Chromium asli (`npm run e2e`), dan **3 pemeriksaan konteks basi**
(`npm run verify:stale`), semuanya lulus pada kondisi terakhir diperiksa.

## 2. Acceptance criteria P0

### 3.1 Checklist MVP

| Kriteria | Status | Catatan/bukti |
|---|---|---|
| Extension Chrome desktop Manifest V3 | LULUS | `dist/manifest.json` tervalidasi; service worker `type: module` |
| Pencarian kontekstual (modifier + hover) dan teks terpilih | LULUS | e2e: hover dengan/tanpa modifier, `GET_SELECTION`, `SHOW_LOOKUP` |
| Popup: bentuk kamus, bacaan, definisi, kelas kata/tag, konteks kalimat | LULUS | e2e membaca isi shadow DOM via CDP `DOM.getDocument{depth:-1,pierce:true}` |
| Pencarian manual dari action popup dan halaman pencarian | LULUS | e2e: action popup (status, Enter, seluruh definisi tampil) + halaman pencarian |
| Deinflection bentuk umum verba/adjektiva + label bentuk | LULUS | corpus 4.4 di `tests/core/search.test.ts`; label tampil di UI |
| Impor/aktivasi/pengurutan/penghapusan kamus JSONL | LULUS | `tests/data/import.test.ts`, e2e pengaturan |
| Kamus + preferensi di storage lokal; pencarian offline | LULUS | e2e `context.setOffline(true)` menampilkan hasil |
| Pengaturan: bahasa, modifier, tema, ukuran popup, daftar situs | LULUS | `src/settings/`; e2e perubahan tema + persistensi |
| Status kosong/tidak ditemukan/izin/dataset rusak/error storage | LULUS (kuota belum diuji) | pesan terstruktur `code`+`message`; kuota: lihat §5 |

### 4.1 Pemindaian dan lookup kontekstual

| Kriteria | Status | Bukti |
|---|---|---|
| Hover + modifier (default `Alt`) menampilkan hasil; tanpa modifier tidak | LULUS | e2e: "Hover dengan modifier menampilkan popup hasil lookup", "Hover tanpa modifier tidak memunculkan popup"; isi popup diverifikasi via CDP `pierce` |
| Pencarian teks terpilih dari action popup atau menu konteks memakai selection | LULUS | e2e `GET_SELECTION` dan `SHOW_LOOKUP` (isi popup = 食べました → 食べる) |
| Escape menutup popup | LULUS | e2e pemeriksaan Escape |
| Tidak ada lookup di input/area editable atau tanpa modifier | LULUS | e2e hover di `<input>`; test `isEligibleElement` |
| Lookup berjalan offline dan tidak membuat request jaringan | LULUS | e2e dengan `context.setOffline(true)` menampilkan hasil; `scripts/validate-build.mjs` menolak `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/`EventSource` pada bundle |
| Cakupan frame pemindaian | LULUS (diperluas) | Content script statis berjalan di iframe http/https (`all_frames: true`) seperti Yomitan/Hachidori; pengecualian situs diperiksa terhadap origin frame, dan seleksi pengguna tetap dibaca dari frame utama (`frameId: 0`) |
| Cuplikan konteks ≤160 code point, tidak dikirim/di-simpan | LULUS | 3 test `buildContextSnippet`; payload `LOOKUP` hanya query + `caretOffset` |

### 4.2 Pencarian manual

| Kriteria | Status | Bukti |
|---|---|---|
| Enter dan tombol Cari menjalankan kueri yang sama | LULUS | e2e "Enter menjalankan pencarian manual yang sama dengan tombol Cari"; form submit pada `action.html` dan `search.html` |
| Kueri kosong tidak diproses; tanpa hasil menampilkan saran kamus aktif | LULUS | `status: empty-query`; e2e "Kamus nonaktif tidak dipakai untuk lookup" menampilkan saran |
| Mengganti kueri tidak menampilkan hasil lama | LULUS | `ResultsView.clear()` + token permintaan; `#results` dikosongkan saat input berubah |
| Hasil maksimum 30 entri dengan indikator hasil lain | LULUS | `DEFAULT_MAX_RESULTS = 30`; `truncated` ditampilkan; test "membatasi jumlah hasil" |

### 4.3 Popup hasil (kartu entri)

| Kriteria | Status | Bukti |
|---|---|---|
| Headword, reading, definisi, kelas kata tanpa tab tambahan | LULUS | e2e isi popup |
| Seluruh definisi tampil langsung tanpa klik/Enter | LULUS | e2e "Popup menampilkan definisi langsung di kartu entri tanpa aksi pengguna" + `tests/ui/render.test.ts` (`.definitions__item` bernilai seluruh sense, tidak ada tombol pada kartu) |
| Tag tidak dikenal tetap ditampilkan tanpa merusak layout | LULUS | chip teks biasa (`tagList()`); fixture `pos-tidak-dikenal` |
| Markup/script pada data kamus tidak dieksekusi | LULUS | validasi impor menolak HTML; renderer memakai `textContent`; 16 test di `tests/ui/render.test.ts` (termasuk asersi tidak ada elemen `img`/`script` yang dibuat) |
| Bacaan sama dengan headword tidak digandakan; tanpa bacaan diberi label | LULUS | `readingLine()`; test `tests/ui/render.test.ts` |

### 4.4 Penguraian kata dan deinflection

| Kriteria | Status | Bukti |
|---|---|---|
| Corpus: 食べました→食べる, 書いて→書く, 高くない→高い, します→する, 来た→来る | LULUS | `tests/core/search.test.ts` (`it.each`) |
| Menampilkan bentuk permukaan dan label transformasi | LULUS | `matchedText` + `steps[].form` dilabeli di UI |
| Kandidat dengan kelas kata tidak sesuai tidak dihasilkan | LULUS | `posCompatible`; test 野かった → kosong |
| Maksimum 32 code point dan batas transformasi | LULUS | `MAX_CANDIDATE_CODE_POINTS`, `MAX_DEINFLECTION_ANALYSES`; test batas |

### 4.5 Impor dan pengelolaan kamus

| Kriteria | Status | Bukti |
|---|---|---|
| File valid dapat diimpor, dibuka ulang, dan dipakai offline | LULUS | test data + e2e restart |
| Impor gagal di baris tengah tidak menampilkan versi parsial | LULUS | e2e "Baris 6 tidak valid"; abort + entry staging dihapus |
| Penggantian berlaku setelah staging selesai; gagal mempertahankan versi lama | LULUS | `commitImport` satu transaksi metadata; test replace |
| Penghapusan menghapus metadata dan semua entry; kamus lain tetap dapat dicari | LULUS | test data + e2e delete |
| Progres dan hasil per file untuk impor batch | LULUS | `importFiles` mengembalikan hasil per file + `IMPORT_PROGRESS` |

### 4.6 Izin situs, preferensi, navigasi

| Kriteria | Status | Bukti |
|---|---|---|
| Pemindaian tidak berjalan tanpa izin host | LULUS (model berubah) | Host permission diminta saat pemasangan (semua situs http/https, seperti Yomitan/Hachidori) — lihat §4.4 penyimpangan PRD |
| Pengguna dapat mencabut/menonaktifkan scan dan mengatur situs | LULUS | Toggle global `scanAllSites` + daftar pengecualian per origin; content script berhenti/mulai tanpa reload (e2e: "Menonaktifkan situs menghentikan pemindaian di tab yang sudah terbuka") |
| Preferensi tetap tersimpan setelah restart | LULUS | e2e restart (tema tersimpan) |

## 3. Keputusan terbuka (PRD §14) — asumsi yang dipilih

| # | Pertanyaan | Keputusan MVP | Alasan |
|---|---|---|---|
| 1 | Dataset demo legal | **Tidak disertakan.** Hanya fixture uji kecil (`tests/fixtures/*.jsonl`, 29 + 12 entry) dengan definisi yang ditulis khusus untuk pengujian dan field lisensi `CC0-1.0 — data uji`. UI menjelaskan bahwa lookup memerlukan dataset dari pengguna. | Menghindari klaim lisensi yang tidak terverifikasi; PRD mengizinkan jalur "impor dataset pengguna" |
| 2 | Batas file/entry | 128 MB per file, 1.000.000 entry, 64 KiB per baris, 64 definisi/tag per entry (`src/core/limits.ts`), ditampilkan di UI sebelum impor | Diambil setelah benchmark impor 100.000 entry (17 s, ≈5.850 entry/detik, ~42–46 MB storage) pada perangkat uji |
| 3 | Kanal rilis | Instalasi developer/unpacked; tidak diajukan ke Chrome Web Store | MVP skripsi; keputusan distribusi butuh lisensi dataset & kebijakan privasi final |
| 4 | Reading-search kana | **Aktif secara default**, dapat dimatikan (`settings.readingSearch`) | Kueri kana perlu menemukan entri kanji; mudah dimatikan bila mengganggu |
| 5 | Format & kode POS | Shirabe JSONL v1; kode POS mengikuti konvensi ekosistem (v1, v5k…v5r, vs, vk, adj-i, adj-na, n) | Memudahkan konversi dataset yang sudah ada tanpa mengklaim kompatibilitas penuh |

Asumsi tambahan yang diambil saat implementasi:

- **Titik awal kandidat hover:** content script mengirim kandidat kata plus `caretOffset`
  (indeks code point), dan search core memilih kandidat terpanjang yang mencakup posisi
  kursor. Ini memenuhi batas kata Jepang tanpa parser (PRD 13) tanpa mengirim cuplikan
  halaman.
- **Penghapusan kamus:** metadata ditandai `pendingDelete` dan dinonaktifkan lebih dahulu,
  lalu entry dihapus; sweep startup menyelesaikan penghapusan yang terputus.
- **Impor dijalankan dari halaman settings** (parsing streaming) sementara penulisan
  database dilakukan service worker; `IMPORT_PROGRESS` dikirim service worker setelah
  setiap batch.
- **Halaman extension** yang dibuka di dalam tab bukan content script: klasifikasi
  pengirim memakai skema URL (`chrome-extension://` vs `http(s)://`).
- **Furigana** disusun dari satu bacaan per entri, jadi kata tanpa jangkar kana (mis.
  大人/おとな) menampilkan furigana di atas seluruh kata, dan bacaan yang tidak dapat
  diselaraskan (mis. okurigana tidak cocok) ditampilkan sebagai baris terpisah.
- **Setelah extension dimuat ulang**, tab yang sudah terbuka harus dimuat ulang sekali
  (batasan Chrome untuk content script statis: tidak ada penyuntikan ulang otomatis).
  Penyuntikan ulang otomatis memerlukan permission `scripting`, yang sengaja tidak
  ditambahkan demi least privilege; popup menjelaskan langkah yang perlu dilakukan.
- **Frame**: PRD 4.1 menyebut pemindaian top-level document saja. Atas permintaan
  pemilik produk (dan untuk menyamai Yomitan/Hachidori), content script kini berjalan di
  semua frame http/https; pengecualian situs dan cek origin dilakukan per frame, serta
  seleksi pengguna tetap dibaca dari frame utama agar tidak tertukar dengan iframe.
- **Tag kelas kata grup.** Dataset seperti JMdict (lewat konversi Yomitan) menandai
  aturan godan sebagai grup `v5`, sedangkan rule Shirabe bekerja per baris (`v5k`,
  `v5u`, …). Validasi kelas kata karena itu menerima kecocokan persis atau kecocokan
  prefix (minimal 2 karakter) dua arah: `v5` ↔ `v5k`, `v5k` ↔ `v5k-s`. Kecocokan
  kelas kata yang berbeda tetap ditolak (`adj-i` vs `adj-na`).
- **Urutan entry di dalam satu kamus.** Ranking hasil memakai `entryId` sebagai
  tie-break terakhir, jadi kunci entry memakai nomor urut ber-padding lebar tetap
  (`<version>:000000123`) supaya urutan leksikografis kunci sama dengan urutan dataset.
  Konverter Yomitan mengurutkan entry berdasarkan `score` (frekuensi) dari sumber,
  sehingga kata umum tampil lebih dahulu tanpa perlu field prioritas di schema v1.
- **Urutan kandidat vs bentuk infleksi.** Exact match tetap diutamakan, tetapi
  deinflection dijalankan untuk kandidat terpanjang **sebelum** turun ke kandidat lebih
  pendek (PRD 6.3 langkah 6). Tanpa aturan ini, kamus besar dengan entry satu karakter
  (食, 書, 高, 行) akan menampilkan `食` untuk kueri `食べました` alih-alih `食べる`;
  regresi ini tertangkap saat verifikasi JMdict dan dikunci oleh test
  "kamus besar dengan entry satu karakter".
- **Konversi Yomitan di luar extension.** PRD 8.4 menolak mengklaim kompatibilitas
  format Yomitan dan PRD 7 melarang membuat parser ZIP sendiri; karena itu adapter
  term bank v3 dijalankan sebagai skrip terpisah (`scripts/yomitan-to-shirabe.mjs`,
  memakai `unzip` sistem) dan hasilnya diimpor sebagai JSONL biasa.

## 4. Hasil build dan pengujian

| Perintah | Hasil |
|---|---|
| `npm run build` | Berhasil; `dist/background.js` 24,6 kB, `dist/content.js` 38,8 kB (self-contained IIFE), halaman + CSS. `scripts/validate-build.mjs`: OK (permission sesuai rencana, tanpa host permission awal, content script bukan ESM, tidak ada `eval`) |
| `npm test` | 12 file, 200 test lulus |
| `npm run verify:stale` | 3/3 pemeriksaan lulus: hover normal, penjelasan setelah extension di-reload, pemindaian berhenti tanpa kegagalan berulang |
| `npm run e2e` | 81/81 pemeriksaan lulus di Chromium 156 headless (extension unpacked, **manifest asli tanpa patch**): impor JSONL & ZIP, lookup, deinflection, action popup, hover+modifier, modifier tanpa gerakan, kata terbelah antar text node, open Shadow DOM, iframe http, penempatan popup (jarak dari kursor, sisi atas saat ruang bawah habis, determinisme, batas viewport), tema gelap default + popup bertema gelap, furigana, tab sumber kamus (dua kamus aktif), kartu entri (seluruh definisi langsung tampil tanpa klik, baris sense digabung jadi satu kartu bernomor), pemindaian semua situs, pengecualian situs, toggle global, offline, teks terpilih, popup menu konteks, restart, nonaktif/hapus kamus, arsip rusak |
| `npm run bench` | Lihat `artifacts/benchmark/report.json` |
| `npm run typecheck` | Lulus tanpa error (`strict`, `noUncheckedIndexedAccess`, tanpa `any`) |

### 4.1 Pengukuran NFR pada perangkat uji

Perangkat: Intel Core i5-11400H (12 thread), 15,7 GB RAM, Linux 7.2.9, Chromium
156.0.8078.4. Corpus: 100.029 entry (16,9 MB JSONL) + fixture MVP 29 entry.

| Metrik | Target PRD | Hasil |
|---|---|---|
| Lookup p95 (exact, deinflection, kana, banyak hasil) | ≤100 ms | 22–27 ms (JSONL) / 11–14 ms dengan corpus JMdict |
| Lookup no-hit p95 | — | 4–6 ms |
| Lookup pertama setelah worker dingin | — | 10–17 ms |
| Aktivasi hover hingga popup terlihat p95 | ≤300 ms | 100–104 ms (p50 98 ms) |
| Impor 100.000 entry (JSONL sintetis) | tidak ada jeda UI berkelanjutan | **6,6 s (≈15.100 entry/detik)**, turun dari 17,1 s sebelum optimasi; puncak JS heap halaman 57 MB (dibatasi ukuran batch × batch paralel; setelah impor proses renderer stabil di ≈49 MB termasuk cache IndexedDB) |
| Impor 527.409 entry JMdict | — | **42,8 s langsung dari ZIP 14,9 MB** (12.300 entry/detik, storage 140 MB) dan **43,9 s dari JSONL 87 MB** (12.400 entry/detik); sebelum optimasi jalur JSONL 119 s |

Optimasi yang dilakukan, berdasarkan profiling (bukan tebakan): profiling menunjukkan
waktu impor 527k entry terbagi decompress 0,7 s, `JSON.parse` 1,4 s, konversi+validasi
5,6 s, dan 41 s pada kirim batch + penulisan IndexedDB. Perbaikan yang diterapkan:
batch besar (≤30.000 entry / 6 MB) dengan pipelining enam batch sekaligus, validasi entry
di service worker memakai validator yang sama tanpa `JSON.stringify`/`JSON.parse` ulang,
progres di-throttle 250 ms, `pushMany` (satu `await` per bank, bukan per entry),
penghapusan index `by_version` yang tidak pernah di-query (migrasi database v1→v2), serta
estimasi ukuran entry tanpa alokasi array per entry. Sisa bottleneck adalah throughput
penulisan IndexedDB (±15.000 entry/detik) — lompatan berikutnya memerlukan format
penyimpanan biner/OPFS seperti Hachidori (di luar scope sekarang).
| Startup popup/action | tanpa memuat seluruh kamus ke memori | halaman settings 2,95 MB sebelum impor; kamus tidak dimuat penuh (lookup memakai index) |

Catatan: latensi lookup diukur dari halaman extension ke service worker dan kembali
(batas atas waktu di dalam worker). Heap service worker tidak dapat diukur lewat
Playwright (CDP hanya untuk Page/Frame) — perlu dibaca manual dari Chrome Task Manager.

### 4.2 Verifikasi dataset nyata (JMdict terkonversi)

Uji tambahan di luar fixture: `JMdict_english.zip` (Yomitan format 3, 53 term bank)
dikonversi dengan `scripts/yomitan-to-shirabe.mjs` menjadi 527.409 entry (87,3 MB
JSONL) dan diimpor ke extension pada Chromium asli dengan `scripts/verify-dataset.mjs`.

| Aspek | Hasil |
|---|---|
| Impor 87,3 MB / 527.409 entry | 119 s (≈4.400 entry/detik), tanpa error impor |
| Storage setelah impor | ≈166 MB dari kuota 8,2 GB |
| Latensi lookup (median / max, 5 sampel per kueri) | 4,9–30,8 ms / maksimum 36 ms |
| Exact | 食べる → *to eat*; 学生 → *student*; 日本語; 東京都 |
| Reading kana | はし → 橋; たべる → 食べる; がくせい → 学生 |
| Deinflection | 食べました → 食べる; 書いて → 書く; 高くない → 高い; します → する; みて → 見る; 行った → 行う/行く |
| Bentuk permukaan juga terdaftar | 来た menampilkan entry exact 来た **dan** bentuk kamus 来る |

Dua regresi nyata tertangkap oleh uji ini dan sudah diperbaiki: (1) exact match satu
kanji (食) mengalahkan deinflection kandidat terpanjang — diperbaiki dengan urutan
per-kandidat; (2) tie-break `entryId` memakai kunci tanpa padding, sehingga urutan
dataset rusak (`:10` sebelum `:2`) — diperbaiki dengan nomor urut ber-padding. Keduanya
dikunci oleh test di `tests/core/search.test.ts` dan `tests/data/import.test.ts`.

Hasil pengukuran dan daftar query lengkap ada di `artifacts/dataset-verify/report.json`.
Lisensi JMdict/EDRDG adalah CC BY-SA 4.0: atribusi wajib dan data turunan yang
didistribusikan harus memakai lisensi yang sama. Berkas hasil konversi disimpan di
`datasets/` (tidak disertakan ke repositori).

### 4.3 Fitur P1 yang diimplementasikan: impor ZIP Yomitan langsung

Acceptance criteria PRD 4.7 untuk "Import subset Yomitan":

| Kriteria | Status | Bukti |
|---|---|---|
| Fixture valid menghasilkan entry sesuai field mapping | LULUS | e2e "ZIP Yomitan dapat diimpor langsung"; 18 test `tests/core/yomitan.test.ts` |
| Bank/tag/field tak didukung dinyatakan jelas | LULUS | e2e "Komponen arsip yang diabaikan dilaporkan (tag/kanji bank)"; pesan UI menyebut daftar komponen |
| Arsip invalid mempertahankan dataset lama | LULUS | e2e "Arsip ZIP rusak ditolak ... kamus lama tetap utuh" |
| UI tidak mengklaim kompatibilitas penuh | LULUS | pesan impor menyebut subset + komponen diabaikan; dokumen ini menyatakan adapter subset |

Penyimpangan dari PRD yang perlu dicatat:

- PRD §3.1/§8.4 menempatkan impor ZIP pada pengembangan setelah MVP, dan §7 menyatakan
  "jangan mengimplementasikan parser ZIP sendiri". Atas permintaan pemilik produk, impor
  ZIP langsung kini ada di MVP, dan pembacaan struktur ZIP (central directory + local
  header) ditulis sendiri di `src/core/zip.ts` (±200 baris) **tanpa dependency runtime
  baru**; dekompresi tetap memakai primitif platform `DecompressionStream('deflate-raw')`,
  bukan implementasi inflate sendiri. Alasan memilih ini dibanding dependency ZIP:
  menghindari dependency runtime tambahan pada extension (PRD §10 Maintainability).
- Karena adapter berjalan di extension, skrip `scripts/yomitan-to-shirabe.mjs`
  (konverter CLI) dihapus supaya hanya ada satu implementasi pemetaan field.

### 4.4 Perubahan setelah analisis Yomitan & Hachidori

Analisis kedua repo (kloning dangkal, read-only; GPL — hanya perilaku/arsitektur yang
dipakai, bukan kode) menghasilkan perubahan berikut:

| Temuan referensi | Perubahan di Shirabe |
|---|---|
| Yomitan: `scanWithoutMousemove` — `keydown` memakai posisi pointer terakhir untuk scan. Hachidori: `scanActivatedPointer()` pada `keydown`. | Menahan modifier **tanpa menggerakkan kursor** kini memicu lookup (posisi kursor terakhir). Ini penyebab kedua popup "tidak muncul". |
| Hachidori: host popup + Shadow DOM + `all: initial` + z-index maksimum. | Sudah sama; dipertahankan (closed shadow root). |
| Yomitan/Hachidori: konten popup tetap terbaca, scroll hanya reposisi (Yomitan `frontend.js` scroll/resize → reposisi). | `#onViewportChange` kini hanya **reposisi**; sebelumnya render ulang menghapus pilihan yang sedang dibaca. |
| Yomitan: `elementFromPoint` dipakai memastikan text node berada di elemen hit; kontrol formulir ditangani khusus. | `pointedTextAt` memvalidasi node caret terhadap `elementFromPoint` menembus shadow DOM, sehingga teks internal `<input>` tidak pernah dipindai. |
| Hachidori: kalimat dikumpulkan lintas text node dalam blok yang sama (`SENTENCE_SCAN_EXTENT`). | Cuplikan kalimat dikumpulkan dari text node tetangga dalam blok yang sama (batas 1.200 code point / 200 node). |
| Hachidori: lattice kandidat per posisi, diurutkan longest-first, dipilih dengan DP. | Kandidat lookup kini dari beberapa titik awal (maksimum 8) dengan anggaran 48 pembacaan index, diurutkan panjang menurun; tetap tanpa parser sintaksis. |
| Yomitan/Hachidori: content script statis di semua situs. | Model izin diubah ke host permission semua situs + content script statis (lihat catatan penyimpangan). |

### 4.5 Penyimpangan PRD (model izin & pemindaian semua situs)

PRD §4.6/§6.1 menghendaki izin host diminta **per situs** saat pengguna mengaktifkan
pemindaian, dan tidak meminta akses semua situs pada instalasi awal. Atas permintaan
pemilik produk (agar berperilaku seperti Yomitan/Hachidori), MVP sekarang:

- meminta `host_permissions` untuk semua origin http/https saat pemasangan,
- menjalankan content script statis (`content_scripts`) di semua halaman,
- menyediakan kontrol pengganti: toggle global `scanAllSites` dan daftar pengecualian
  per origin (keduanya langsung berlaku tanpa reload),
- menghapus izin `scripting` dan `activeTab` yang tidak lagi diperlukan (least privilege
  tetap dijaga: hanya `storage` + `contextMenus` + host access).

Konsekuensi yang dicatat: dialog izin muncul sekali saat pemasangan ("baca dan ubah data
di semua situs web"), dan pemindaian otomatis aktif di semua situs sampai pengguna
mematikannya. Ini juga menghapus seluruh kelas bug "popup tidak muncul karena situs belum
diaktifkan / tab belum di-reload".

### 4.6 Perbaikan UI dan kompatibilitas pemindaian

Masukan pemilik produk: tampilan dinilai belum layak dan pemindaian gagal di sebagian
situs. Perubahan yang dikerjakan (semua diverifikasi di Chromium asli):

**UI**
- Skala tipografi dan ukuran tab disamakan dengan acuan Hachidori (expression 32px,
  glosarium 16px, judul kamus 13px, tag 12px, tab 13px/tinggi 34px, lebar popup 560px);
  lihat tabel pada §4.9.
- Token warna/tipografi baru untuk semua permukaan (action popup, pengaturan, halaman
  pencarian) dengan hierarki judul, kartu ber-shadow, dan tab pill sticky.
- Popup definisi ditata ulang seperti panel kamus: header tetap (query + sumber +
  tombol tutup), badan bergulir berisi kartu entri, dan footer petunjuk; lebar default
  390 px, tinggi maksimum 72vh.
- Action popup 380 px: header status, baris pencarian, tombol aksi, hasil bergulir, dan
  footer storage/pengaturan.

**Penempatan popup (disamakan dengan Yomitan)**
- Aturan lama menambatkan popup pada rect rentang kandidat lalu memakai ambang
  "muat/tidak muat" dengan fallback ketiga (popup digeser ke tepi bawah viewport).
  Akibatnya popup meloncat: kandidat yang memanjang/memendek menggeser titik tambat, dan
  gerakan kecil di dekat tepi viewport membalik sisi atas/bawah.
- Sekarang aturan dan titik tambatnya sama seperti Yomitan:
  - **Titik tambat = posisi kursor.** Untuk bahasa tanpa spasi (`ja`, `zh`, `yue`, `ko`)
    Yomitan tidak menggeser offset awal ke awal kata
    (`SCAN_RESOLUTION_EXCLUDED_LANGUAGES` di `text-scanner.js:28`), sehingga rect yang
    dipakai adalah karakter di bawah kursor. Shirabe memakai range kosong di posisi
    kursor (`caretRangeAt`) dan rect baris pertama (`anchorFromRange`).
  - **Sisi ditentukan sekali per posisi**, seperti `_getConstrainedPositionBinary`:
    default di bawah; berpindah ke atas hanya bila luapan bawah lebih besar daripada
    luapan atas.
  - **Tinggi dipangkas ke ruang tersedia** (isi digulir) sehingga popup tidak pernah
    keluar viewport dan tidak pernah "dilipat" ke sisi lain hanya karena tinggi.
  - **Sumbu horizontal** `×+10 px` dari kursor lalu digeser ke kiri bila melewati tepi
    kanan (offset default Yomitan `popupHorizontalOffset`/`popupVerticalOffset` = 10).
  - Lookup ulang sekarang dibandingkan pada **(query, posisi kursor)**, bukan query saja:
    memindahkan kursor ke karakter lain pada kata yang sama tetap memindahkan popup
    seperti Yomitan, sedangkan mengulang posisi yang sama tidak memuat ulang apa pun.

**Kompatibilitas pemindaian (penyebab "tidak bisa scan di beberapa web")**
1. **Batas elemen**: sebelumnya node caret harus strict-descendant elemen hasil
   `elementFromPoint`; pada markup dengan tautan/span bertingkat atau overlay transparan,
   ini menolak teks yang sebenarnya valid. Sekarang elemen hit divalidasi, dan node caret
   ditolak hanya bila elemennya sendiri editable/diabaikan.
2. **Kata terbelah antar text node**: kandidat kini dibentuk dari *text window* yang
   menyatukan text node tetangga dalam blok yang sama (seperti `TextSourceRange` Yomitan
   dan `collectScanEntries` Hachidori), bukan dari satu text node saja.
3. **Open Shadow DOM**: `caretPositionFromPoint` dipanggil dengan daftar shadow root
   (pola `text-source-generator.js:435-471` Yomitan), sehingga teks di dalam komponen web
   dapat dipindai.
4. **Iframe**: content script statis berjalan di semua frame http/https
   (`all_frames: true`, sama seperti Yomitan/Hachidori); origin pengecualian diperiksa per
   frame, dan aksi menu konteks dikirim ke frame tempat klik terjadi.
5. **Pointer events**: pemindaian memakai `pointermove`/`pointerdown` dengan capture
   (pola Yomitan) sehingga perangkat pointer/halaman yang hanya memancarkan event pointer
   tetap berfungsi, dan klik dengan modifier langsung memicu lookup.

Bukti pengujian penempatan (`npm run e2e`, blok "Penempatan popup"): jarak popup dari
karakter di bawah kursor tetap 10 px pada dua karakter berbeda, popup ikut berpindah saat
kursor bergerak (bukan terpaku pada satu kata), hasil identik untuk posisi kursor yang
sama, popup berpindah ke atas saat tidak ada ruang di bawah, digeser ke kiri di tepi kanan
viewport, dan selalu berada di dalam viewport. Catatan: uji banding langsung dengan extension Yomitan di Chromium headless
tidak dapat diselesaikan karena popup Yomitan tidak dirender pada lingkungan itu
(content script-nya aktif — terbukti menjawab `chrome.tabs.sendMessage` — tetapi popup
tidak dibuat); perbandingan dilakukan pada kode sumber Yomitan (`ext/js/app/popup.js`,
`ext/js/language/text-scanner.js`).

### 4.7 Halaman yang tertinggal setelah extension dimuat ulang

**Gejala yang dilaporkan:** setiap popup menampilkan kata terakhir yang dipindai dengan
"Terjadi kesalahan internal." dan tidak pernah ada hasil.

**Penyebab (direproduksi di Chromium asli):** halaman yang sudah terbuka tidak lagi
memiliki content script yang valid setelah extension di-**Reload** dari
`chrome://extensions` (Chrome hanya menyuntikkan content script statis ke tab baru).
Content script lama tetap ada di halaman, tetapi `chrome.runtime.sendMessage` melempar
"Extension context invalidated.", sehingga setiap lookup gagal. Pesan protokol untuk
keadaan itu sebelumnya dipetakan ke kode `INTERNAL` dan ditampilkan sebagai
"Terjadi kesalahan internal." tanpa penjelasan.

**Perbaikan:**
- Kode error baru `CONTEXT_INVALIDATED` (`src/messaging/protocol.ts`) beserta deteksinya
  (`isExtensionContextInvalidated`): pesan dari Chrome ("Extension context invalidated.",
  "Could not establish connection…") atau `chrome.runtime.id` yang hilang.
- Content script memakainya untuk berhenti memindai dan menampilkan penjelasan yang dapat
  ditindaklanjuti: "Extension baru saja dimuat ulang. Muat ulang halaman ini (F5) untuk
  mengaktifkan pemindaian kembali." Popup tetap bisa dibaca (dan ditutup) setelah
  pemindaian dihentikan.
- Halaman extension (action popup, pengaturan, halaman pencarian) memakai kode yang sama
  lewat `src/ui/page.ts`.
- Kesalahan `INTERNAL` sekarang menampilkan pesan aslinya di UI, sehingga sebab yang belum
  terduga dapat langsung dibaca.

**Regresi:** `npm run verify:stale` (`scripts/verify-stale-context.mjs`) memverifikasi
hover berfungsi, lalu `chrome.runtime.reload()`, lalu hover berikutnya menampilkan
penjelasan tersebut (bukan kesalahan internal) dan tidak mengulang permintaan.

### 4.8 Penyajian data kamus di kartu entri (acuan Hachidori/Yomitan)

Masukan pemilik produk: definisi lengkap tidak boleh menuntut klik/Enter lebih dahulu.
Sebelumnya daftar hasil hanya menampilkan satu definisi ringkas per entri dan menyembunyikan
sisanya di tampilan "detail entri" yang dibuka dengan Enter/klik.

**Acuan dari repo Hachidori** (`~/Project/hachidori-ext`, popup turunan Yomitan):

| Aspek | Hachidori | Shirabe sekarang |
|---|---|---|
| Definisi | Semua sense dirender langsung (`render/popup.js:3708-3761`: `.gsm-hoshidicts-definitions > .definition-item` → `.gloss-list > .gloss-item`, tanpa pelipatan/`line-clamp`) | Semua sense langsung tampil sebagai `.definitions > li`; tidak ada tampilan detail terpisah |
| Pengelompokan | Satu kartu per kamus (`.gsm-hoshidicts-glossary-card` + judul kamus) | Nama kamus menjadi judul kelompok (`.entries__group`) sekali per kamus, kartu per entri |
| Sense bernomor | Daftar `<ol>` per kamus | `<ol>` bernomor bila sense > 1; tanpa nomor bila tunggal |
| Tag | Chip berjenis warna (kelas kata = aksen, ekspresi = sekunder, frekuensi = info) — `render/reader.css:1097-1119` | Chip `tag--pos` (aksen) dan `tag` (netral); chip tak dikenal tetap teks biasa |
| Ukuran popup | 560×420 px, radius 14px, dasar 16px/1.5 (`render/reader.css:1096-1127`) | Lebar 560px, radius 14px; tinggi mengikuti isi (bukan 420px tetap) dengan batas `min(72vh, 520px)` |
| Tipografi | expression 32px/1.22 + furigana 15px (`reader.css:1618-1679`), glosarium 16px/1.5 (`:2447-2450`), judul kartu kamus 13px (`:2411`), tag 12px (`:2249-2255`), tag sense 11px (`:2271`), ringkasan 13px/1.35 (`:1741-1754`) | `--fs-headword` 32px, `--fs-gloss` 16px/1.5, `--fs-label` 13px, `--fs-tiny` 12px, furigana `0.47em` (±15px) — sama dengan Hachidori; nama kamus tidak lagi kapital semua |
| Ukuran tab kamus | `.gsm-hoshidicts-tab` 13px/600, min-height 34px, padding 6px 13px, radius 7px, `max-width: min(150px, 58vw)` + elipsis, `gap: 6px` (`reader.css:1337-1443`) | Sama: 13px/600, min-height 34px, padding 6px 12px, radius 6px, elipsis 150px + atribut `title`, `gap: 6px` |
| Bentuk infleksi | Disclosure `<details>` jalur deinflection | Tidak ditampilkan: kartu hanya memuat data kamus (lihat §4.10) |
| Tema | Token `--hoshidicts-*` (gelap: base `#272630`, primary `#a89ce4`; terang: OKLCH) di `:host([data-hoshidicts-theme])` | Token Shirabe yang sudah ada (`--bg/--fg/--muted/--border/--card/--accent/--accent-soft`) dengan tema terang/gelap/sistem; tidak meniru palet Hachidori |

**Perubahan kode**
- `src/ui/results.ts`: satu renderer kartu entri menggantikan `renderMatchList` +
  `renderEntryDetail`. Kartu berisi headword, bacaan, badge bentuk, chip kelas kata/tag,
  dan seluruh definisi; `renderEntries` menambahkan judul kelompok kamus.
- Tampilan "detail entri" dihapus dari popup dalam halaman, action popup, dan halaman
  pencarian (termasuk tombol Kembali dan penanganan Escape dua tingkat), karena seluruh
  data sudah tampil di kartu. Tombol/menu yang tidak lagi dipakai ikut dihapus dari
  katalog string.
- Cuplikan kalimat dipindah ke atas kartu agar tetap terlihat pada hasil yang panjang.
- `src/styles/results.css` menjadi satu-satunya sumber gaya kartu entri, diimpor oleh
  `base.css` (halaman extension) dan `popup.css` (popup dalam shadow DOM).

**Verifikasi**
- Unit: 16 test `tests/ui/render.test.ts` (seluruh sense tampil, tanpa tombol pada kartu,
  tidak menomori sense tunggal, pengelompokan kamus, badge bentuk, keamanan teks).
- e2e: popup hover menampilkan definisi + kelas kata langsung, tepat satu kartu terpilih,
  panah menelusuri kartu; action popup dan halaman pencarian menampilkan seluruh definisi
  tanpa klik serta tidak lagi memiliki elemen detail/Kembali.
- Chromium asli dengan JMdict (527k entri): hover 詠唱 → 2 entri dengan 2 dan 3 sense
  semuanya tampil; hover 取る → 18 entri dengan 2-7 sense tampil dan popup dapat digulir.

### 4.9 Redesign UI/UX dengan acuan popup Hachidori

Permintaan pemilik produk: tampilan popup dibuat sematang Hachidori (tema gelap, padat,
terstruktur) tanpa mengubah logika pencarian, data, atau fitur.

**Acuan visual (repo `~/Project/hachidori-ext`)**

| Prinsip Hachidori | Penerapan di Shirabe |
|---|---|
| Header entri: headword besar + reading sebagai furigana, metadata badges di bawahnya (`render/popup.js:3285-3375`, `3647-3660`) | Header kartu: `.entry__expression` (23 px) dengan `<ruby>` furigana, badge kelas kata/tag dari dataset |
| Panel definisi per kamus dengan judul sumber (`.gsm-hoshidicts-glossary-card` + `.glossary-card-title`) | `.dict-panel` + `.dict-panel__title` per `dictionaryId`, dipisah jarak `--s5` |
| Tab kamus (`.gsm-hoshidicts-dictionary-tabs`, `render/popup.js:1545`) | `.dict-tabs` segmented (`role="tablist"`), tab `Semua` + satu per kamus beserta jumlah entri |
| Metrik: `--hd-space-*` 2/4/6/8 px, `--hd-font-gloss: 16px`, `--hd-line-gloss: 1.5`, `--hd-card-padding: 7px 9px 8px` | `tokens.css`: `--s1`…`--s6` (2/4/6/8/12/16), `--fs-gloss: 14.5px`, `--lh-gloss: 1.5`, padding kartu `--s4`/`--s5` |
| Tema gelap charcoal + aksen lavender (`--hoshidicts-palette-base-100: #272630`, `primary: #a89ce4`) | Tema gelap default: `--bg #16171c`, `--surface #212228`, `--card #23242b`, `--accent #a89ce4` |
| Badge berjenis warna (kelas kata = aksen, tag lain netral) | `.badge--pos` (lavender), `.badge` (netral) — hanya untuk nilai dari dataset |
| Konten popup bergulir tanpa memotong definisi | `.panel__body` bergulir, tinggi dipangkas ke ruang viewport (aturan penempatan Yomitan) |

**Yang berubah**
- `src/styles/tokens.css` (baru): token warna/jarak/radius/tipografi yang dipakai bersama
  halaman extension dan popup; tema diterapkan lewat atribut `data-theme` (halaman:
  `html`, popup: `.panel`).
- `src/styles/base.css` dan `src/content/popup.css`: ditulis ulang mengikuti sistem token
  (sebelumnya berisi dua generasi gaya yang saling menimpa); scrollbar, fokus, hover,
  aktif, disabled, dan mode kontras dipusatkan.
- `src/styles/results.css`: komponen hasil (konteks kalimat, tab kamus, panel kamus, kartu
  entri, badge) sebagai satu sumber gaya untuk semua permukaan.
- `src/ui/furigana.ts` (baru): penyelarasan bacaan ↔ kanji untuk furigana (murni tampilan,
  ada fallback bila tidak dapat diselaraskan).
- `src/ui/results-panel.ts` (baru) menggantikan `src/ui/results-view.ts`: panel hasil
  bersama (konteks, tab kamus, pesan status, catatan) dipakai popup dalam halaman, action
  popup, dan halaman pencarian.
- `src/content/popup.ts`: memakai panel bersama; header menjadi identitas + toolbar ikon
  (tombol tutup); tidak ada lagi mesin render sendiri.
- Tema default diubah dari `system` menjadi `dark` (`src/core/preferences.ts`).

**Yang tidak berubah:** logika pencarian, deinflection, akses IndexedDB, validasi impor,
skema dataset, penempatan popup berbasis kursor, serta seluruh fitur yang sudah ada.
Pemfilteran sumber kamus hanya menyaring daftar hasil di UI.

**Header popup = kanji utama, bukan kalimat**
- Header popup sebelumnya menampilkan kueri hasil pemindaian (bisa berupa potongan kalimat
  seperti `学生は毎日勉強します`). Sekarang header menampilkan kanji/kosakata **entri utama**
  beserta furigananya (`#renderHeader` memakai `alignFurigana`), sedangkan kalimat yang
  diparsing tetap ada di blok konteks. Perilaku ini mengikuti pola Hachidori: header utama
  popup berisi headword, dan kartu pertama tidak mengulang headword tersebut
  (`hideFirstHeadword` + `onPrimaryEntry` pada `ResultsPanel`).
- Bila hasil belum ada (memuat/gagal/kosong), header memakai kueri sebagai penanda
  sementara karena headword belum diketahui.

**Verifikasi**
- Unit: 196 test (12 berkas), termasuk 8 test furigana, test tab/filter kamus, test panel
  (konteks di atas kartu, pemilihan kartu, pesan status, headword dipindah ke header,
  laporan entri utama saat tab berganti).
- e2e: 78/78 lulus — termasuk pemeriksaan baru: tema gelap default pada halaman extension
  (`rgb(22, 23, 28)`), popup bertema gelap + furigana, tab sumber kamus pada skenario dua
  kamus aktif (menyaring panel dan kembali ke `Semua`), header menampilkan kanji utama +
  furigana tanpa kalimat yang diparsing, headword tidak diulang pada kartu pertama,
  kalimat tetap di blok konteks, serta header lookup menu konteks menampilkan bentuk kamus
  (bukan teks terpilih).
- Chromium asli + JMdict (527k entri): tidak ada overflow horizontal pada `.panel__body`,
  panel kamus, maupun kartu entri (diperiksa melalui `scrollWidth`/`clientWidth`);
  tangkapan layar tema gelap dan terang diperiksa manual.

### 4.10 Kartu entri hanya menampilkan data dari kamus

Permintaan pemilik produk: keterangan turunan seperti "bentuk lampau · 思った" tidak perlu
ditampilkan — cukup data yang benar-benar berasal dari kamus.

**Yang dihapus dari tampilan** (semuanya keterangan turunan Shirabe, bukan data kamus):

| Elemen | Sumbernya sebelumnya | Status |
|---|---|---|
| Badge `bentuk lampau · 思った` | `match.steps` hasil deinflection (rule `v5u.past.った`) + label UI `FORM_LABELS.past` | dihapus dari kartu, `title`-nya juga |
| Label `cocok bacaan` / `bentuk terurai` | `match.matchType` | dihapus |
| Catatan `kelas kata tidak terverifikasi` | `match.partOfSpeechVerified` | dihapus |

**Yang tetap ditampilkan** (semuanya berasal dari dataset): expression, reading/furigana,
kelas kata (`partOfSpeech`), tag (`tags`), seluruh definisi, nama kamus, serta cuplikan
kalimat halaman (konteks, bukan anotasi kata).

**Yang tidak berubah:** deinflection tetap bekerja sebagai bagian pencarian — memindai
`思った` tetap menemukan entri `思う` (rule `v5u.past.った`, `思う` → `思った`) dan hasilnya
tetap diurutkan setelah exact match. Yang hilang hanya keterangan visualnya. Kode dan
string yang menjadi mati ikut dihapus: `formBadge()`, `matchTypeLabel()`,
`inflectionFormLabel()`, `FORM_LABELS`, `MATCH_TYPE_KEYS`, dan enam kunci string
(`results.inflatedFrom`, `results.deinflectionNote`, `results.matchExact`,
`results.matchReading`, `results.matchDeinflected`, `results.posUnverified`).

**Deviasi dari PRD:** kriteria "popup menampilkan informasi bentuk infleksi jika tersedia"
(PRD 4.3) tidak lagi ditampilkan atas permintaan pemilik produk; kemampuan deinflection
tetap ada dan diuji (`npm run dataset:verify`, test `src/core/deinflection`).

**Satu kartu per kata (penggabungan baris sense):** kamus seperti JMdict menyimpan satu
baris per sense dengan `expression` + bacaan yang sama. Sebelumnya setiap baris menjadi
kartu sendiri (mis. 傾ける tampil sebagai 4 kotak dengan chip `v1 vt` dan nomor berulang);
sekarang `mergeEntries()` (`src/ui/results.ts`) menggabungkannya menjadi **satu kartu**:
setiap baris menjadi satu *sense* dalam daftar bernomor (1…n) dan definisi baris itu
ditulis di dalam nomornya (sinonim per baris, tanpa nomor sendiri), kelas kata/tag
digabung tanpa duplikat, dan tag yang hanya berisi angka (penanda nomor sense dari
dataset) tidak ditampilkan sebagai chip karena `ol` sudah memberi nomor. Satu sense saja
tidak dinomori. Perilaku ini mengikuti tampilan
Hachidori (satu kotak per entri dengan sense bernomor). Bukti e2e: fixture
`tests/fixtures/demo-multi-sense.jsonl` (4 baris 傾ける/かたむける) dirender sebagai 1 kartu
`data-rows="4"` dengan 4 sense bernomor (6 glosarium: 2+1+2+1) dan badge `v1 vt ichi`;
diuji juga dengan JMdict asli (527k entri) untuk 傾ける → satu kartu berisi **4 sense**
(7+3+3+1 glosarium) sama seperti tampilan Hachidori.

**Verifikasi:** test `tests/ui/render.test.ts` kini memastikan kartu memuat data kamus dan
**tidak** memuat kata "bentuk", "cocok", atau "terverifikasi"; e2e memastikan lookup dari
menu konteks (`食べました`) menampilkan entri `食べる` beserta definisinya tanpa keterangan
bentuk.

**Susunan kartu (pola header utama Hachidori):** kata yang di-lookup tampil sekali di
header popup. Kartu yang `expression` **dan** `reading`-nya sama dengan headword header
tidak menuliskan headword lagi (langsung chip kelas kata/tag lalu definisi), sedangkan
entri dengan bacaan berbeda tetap menampilkannya. Aturannya berbasis nilai
(`hideHeadwordFor` di `src/ui/results.ts`), bukan posisi kartu, sehingga berlaku untuk
semua kamus yang aktif. Bukti e2e: dengan dua kamus aktif (JSONL + ZIP), bacaan `がくせい`
muncul **sekali** di popup, dua panel kamus tetap tampil dengan definisinya masing-masing
(`pelajar; mahasiswa` dan `student`).

## 5. Kekurangan, keterbatasan, dan pekerjaan tersisa

**Belum diuji (perlu pengujian manual):**

1. Pembaca layar (screen reader) dan kontras warna tergadap WCAG 2.2 AA; struktur
   heading/focus sudah dibuat (label ARIA, focus-visible, `prefers-reduced-motion`,
   `forced-colors`), tetapi belum diuji dengan alat bantu.
2. Zoom 200%, viewport kecil (mis. 800×600), dan forced colors.
3. Kegagalan kuota storage (QuotaExceededError) — jalur kode ada (abort + pesan
   `STORAGE_QUOTA`), belum disimulasikan.
4. Edge Chromium, Chrome versi utama sebelumnya, Firefox/Safari/Android — hanya satu
   build Chromium yang diuji; browser lain tidak diklaim didukung.
5. Perilaku halaman dengan CSS ekstrem/z-index tinggi dan DOM yang berubah dinamis
   (popup memposisikan ulang pada scroll/resize; belum diuji pada kasus ekstrem).
6. Pencabutan izin host dari `chrome://extensions` saat halaman terbuka (logika
   reconcile ada, diuji lewat unit test klasifikasi sender; belum diuji end-to-end).

**Keterbatasan desain yang diketahui:**

1. Batas kata Jepang didekati secara heuristik (rangkaian kanji/kana) karena MVP tidak
   memakai parser. Pada teks tanpa partikel pemisah, kandidat bisa lebih panjang dari kata
   yang dimaksud; search core memilih kandidat terpanjang yang mencakup kursor dan
   menampilkan alternatif homonim.
2. Deinflection hanya satu langkah per rule (tanpa rantai pasif/kausatif), dan tidak
   menangani bentuk dialek, kata tidak baku, atau bahasa sopan khusus.
3. Pencarian manual bersifat prefix (bukan pencarian substring bebas), sesuai PRD 4.2.
4. Tidak ada kamus personal, riwayat lookup, kanji/audio/Anki (P1/P2, belum
   diimplementasikan). Impor ZIP Yomitan sudah ada sebagai adapter subset, dengan
   batasan: hanya format 3, tanpa ZIP64/arsip terenkripsi, dan tanpa media/kanji bank.
5. Ikon dan UI diuji pada Chromium Linux; rendering font Jepang bergantung sistem.

**Pekerjaan tersisa menuju "release candidate" (PRD tahap 6):**

- Pengujian aksesibilitas dan browser matriks di atas.
- Simulasi kegagalan kuota dan uji pemulihan storage.
- Dokumentasi pengguna singkat (panduan impor kamus) dan penetapan lisensi proyek.
- `score` Yomitan dipakai sebagai tie-break prioritas ranking (disimpan di record,
  bukan di schema JSONL v1). Urutan masih mengikuti dataset bila prioritas tidak ada
  atau sama.

## 6. Dependency dan lisensi

Tidak ada dependency runtime: seluruh bundle hanya berisi kode Shirabe (manifest tanpa
`content_security_policy` khusus, tidak ada script eksternal).

| Dependency | Versi | Lisensi | Peran |
|---|---|---|---|
| typescript | 6.0.3 | Apache-2.0 | Kompilasi/type check |
| vite | 8.3.4 | MIT | Bundler halaman + content script |
| vitest | 5.0.5 | MIT | Unit/integration test |
| @types/chrome | 0.3.5 | MIT | Tipe Chrome API |
| @types/node | 26.6.5 | MIT | Tipe Node untuk skrip/test |
| fake-indexeddb | 6.2.5 | Apache-2.0 | IndexedDB in-memory pada test |
| happy-dom | 21.0.3 | MIT | Lingkungan DOM pada test |
| playwright | 1.64.1 | Apache-2.0 | Pengujian browser asli + benchmark |

Yomitan dan Hachidori dipakai hanya sebagai referensi perilaku/arsitektur (sesuai PRD §2);
tidak ada kode, CSS, aset, atau transform rule yang disalin, sehingga kewajiban lisensi
GPL sumber tersebut tidak berlaku pada repositori ini.

### 4.11 Dukungan structured content (schema v2): tabel bentuk kata

Permintaan pemilik produk: lookup kanji 俺 menampilkan glosarium `forms` sebagai **sederet
teks** (`俺 己 ∅ おれ ★ 🅁 …`), sedangkan di Hachidori glosarium itu tampil sebagai **tabel**.

**Penyebab.** Kamus JMdict (Yomitan, format 3) menyimpan glosarium `forms` sebagai
structured content: `table > tr > (th|td)` dengan gaya `textAlign`. Adapter Shirabe
sebelumnya meratakan **seluruh** structured content menjadi teks (`definitionsFromGlossary`
+ `plainTextOf`), jadi batas baris/kolom hilang dan hanya urutan teks yang tersisa.
Glosarium seperti itu tidak dapat dinyatakan sebagai array string pada schema v1.

**Perubahan**

| Lapisan | Perubahan |
|---|---|
| Schema (`src/core/jsonl.ts`) | `schemaVersion: 2` didukung; `definitions` boleh berisi string atau simpul `{tag, content, style, lang, data, title, colSpan, rowSpan}`. v1 tetap dibaca dan tetap menolak simpul dengan pesan yang menunjuk versi 2. |
| Validasi (`src/core/structured.ts`, baru) | Daftar putih tag (tabel, daftar, penekanan, ruby, `details`) dan properti gaya (`textAlign`, `verticalAlign`, `fontWeight`, `fontStyle`, `listStyleType`). `listStyleType` menolak nilai dengan `url(`/tanda kurung supaya dataset tidak dapat memicu permintaan jaringan; markup HTML di dalam teks ditolak; batas 256 simpul/definisi, 12 tingkat sarang, 2.000 code point per teks. |
| Konverter (`src/core/yomitan.ts`) | Glosarium teks tetap menjadi string ringkas (tampilan tidak berubah), sedangkan konten berstruktur (tabel, daftar catatan/rujukan dengan penanda, ruby) menjadi simpul yang divalidasi. Tautan `a` diratakan menjadi teks dan dilaporkan; gambar/media dibuang dan dilaporkan (label `media atau elemen \`img\`` dan `gambar (\`image\`)`) di ringkasan impor. |
| Renderer (`src/ui/structured.ts`, baru) | Membangun DOM tanpa `innerHTML`; tag dibuat hanya bila ada di daftar putih, gaya disaring ulang saat render, tabel dibungkus `.sc-table-wrap` yang dapat digulir horizontal. |
| Gaya (`src/styles/results.css`) | Tabel dengan `border-collapse`, garis `--border`, sel `th` berlatar `--raised` (mengikuti `render/reader.css:2730-2741` Hachidori); daftar catatan/rujukan dibedakan warna; penanda emoji dari dataset dipertahankan. |

**Hasil dengan dataset nyata** (JMdict_english.zip, Chromium headless): entri 俺 → 1 tabel
`table.sc-table` 5 baris × 4 kolom, `th` = `['', '俺', '己', '∅']`, sel memuat `★`, `🅁`,
`⛬`, `㊒`, `style.textAlign` = `center`, ditambah 5 daftar catatan berpenanda `📝` —
sebanding dengan tampilan Hachidori. Fixture `tests/fixtures/demo-structured.jsonl`
(kutipan kecil JMdict, atribusi CC BY-SA 4.0) menguji hal yang sama di `npm test` dan
`npm run e2e` (tabel + penanda catatan).

**Batasan yang masih ada:** tautan rujukan silang (`see: お手`) tampil sebagai teks, belum
dapat diklik; gambar kamus dan media tidak didukung (dibuang dan dilaporkan) — sesuai batas
MVP PRD 8.4. Tag di luar daftar putih ditolak saat impor JSONL; konverter Yomitan menjaga
isi anaknya agar informasi tidak hilang.

**Verifikasi:** `tests/core/structured.test.ts` (13 test: daftar putih, gaya, batas ukuran,
pesan versi), `tests/core/yomitan.test.ts` (tabel dan daftar catatan dipertahankan; gaya tak
didukung dibuang dan dilaporkan), `tests/ui/render.test.ts` (tabel asli, penanda daftar,
data di luar daftar putih tidak pernah menjadi elemen), e2e 83 pemeriksaan termasuk
`Definisi berstruktur dirender sebagai tabel asli dengan seluruh selnya` dan
`Daftar catatan tetap membawa penandanya`.

### 4.12 Komponen extension yang tidak seragam (halaman baru + service worker lama)

Gejala yang dilaporkan: impor ditolak dengan `Header dataset tidak valid: versi schema 2
tidak didukung; versi yang didukung: 1` padahal berkasnya sah. Penyebabnya bukan berkas:
halaman Pengaturan sudah memakai kode baru (konverternya menulis header `schemaVersion: 2`)
sementara **service worker masih kode lama** karena extension belum dimuat ulang setelah
`npm run build` — service worker memvalidasi header impor, dan versi yang dilaporkannya
(`versi yang didukung: 1`) adalah versi kode lama, bukan versi schema di berkas.

**Perbaikan**

| Aspek | Perubahan |
|---|---|
| Kode | Halaman Pengaturan membandingkan schema versi yang dipakai halaman dengan balasan `PING` dari service worker; bila berbeda, muncul catatan tindakan di area impor (`data-role="component-mismatch"`): "Buka chrome://extensions, klik Reload pada Shirabe, lalu muat ulang tab ini sebelum mengimpor." |
| Data | `src/data/imports.ts` menyimpan `schemaVersion` dari header dataset ke record kamus (sebelumnya angka tetap `1`, salah untuk dataset v2). `ImportJobRecord.header` ikut membawa field ini. |

**Audit lanjutan (error tetap muncul setelah reload).** Penelusuran berkas menemukan
penyebab pastinya, bukan sekadar dugaan:

| Bukti | Temuan |
|---|---|
| `~/.config/net.imput.helium/Default/Preferences` | Browser yang dipakai adalah **Helium**; Shirabe dimuat unpacked dari `/home/nexsal/perkuliahan/skripsi/shirabe/dist` (path benar). |
| `Default/Service Worker/ScriptCache/` | Entri `background.js` (24.629 byte, mtime **2026-10-17 00:46:55**) mengimpor `assets/jsonl-DWtrFK-Y.js` — chunk **lama**; chunk build sekarang adalah `jsonl-89NVnxzV.js`. Entri itu juga tidak memuat batas v2 (`maxStructuredNodesPerDefinition`), jadi kode service worker yang berjalan memang build pra-v2. |
| `dist/assets/jsonl-89NVnxzV.js` | Build di disk sudah benar: `if(!a.includes(n)) … versi yang didukung: ${a.join(', ')}` dengan `a=[1,2]`. |
| `Default/Cache` | Chunk halaman tidak ada di cache (halaman dibaca segar dari disk), sehingga **halaman baru + service worker lama** — persis pola error yang dilaporkan. |

Pelajaran: cache `ScriptCache` milik browser dapat terus menyajikan skrip service worker
lama untuk extension unpacked. Karena itu halaman kini menampilkan **identitas komponen**
(`settings.aboutComponents`): `Komponen aktif: halaman schema v2 (2026-10-17T04:05:35Z) ·
service worker schema v2 · 2026-10-17T04:05:35Z`. Identitas build disuntikkan build
(`define: { __BUILD_ID__ }` di `vite.config.ts`), dilaporkan service worker lewat `PING`,
dan dibandingkan di e2e — pemeriksaan `Halaman dan service worker melaporkan build yang
sama` akan gagal bila ada komponen basi, jadi kasus ini tertangkap otomatis.

**Verifikasi.** Simulasi worker lama pada build nyata (balasan `PING` dipatch menjadi
`schemaVersion: 1`): catatan peringatan muncul dengan teks di atas. e2e memastikan
**tidak ada** peringatan saat komponen seversi dan identitas build halaman = worker
(85 pemeriksaan lulus). Diuji juga arah sebaliknya: worker baru + dataset v1 lama tetap
diterima (header v1 masih didukung). Salinan extension lama di `/tmp/shirabe-*` (sisa
proses uji lama) dibersihkan agar tidak termuat secara keliru.

### 4.13 Sorotan kata yang sedang di-lookup di halaman

Permintaan pemilik produk: kata yang sedang di-lookup harus terlihat tersorot/terpilih.
Sebelumnya yang tersorot hanya kata di dalam **cuplikan kalimat pada popup**; kata pada
halaman tidak ditandai, sehingga pada teks rapat (mis. `彼は毎日手伝いをします。`) sulit
memastikan kata mana yang sedang dipindai.

**Cara kerja** (`src/content/highlight.ts`)

| Aspek | Keputusan |
|---|---|
| Mekanisme | CSS Custom Highlight API: rentang kata didaftarkan ke `CSS.highlights` sebagai `shirabe-match` (`src/content/highlight.ts`), gaya `::highlight(shirabe-match)` ditulis ke satu `<style data-shirabe="highlight">` milik kita di dokumen (aturan `::highlight()` hanya berlaku pada dokumen pemilik rentang, bukan di shadow root popup — sama seperti catatan di `content.css` Hachidori) |
| Tanpa mutasi DOM halaman | Tidak ada `<mark>`/kelas yang disisipkan; halaman tidak melihat perubahan struktur dan tetap dapat memakai CSS-nya sendiri. Rentangnya hidup, jadi sorotan mengikuti teks saat digulir/di-zoom (tidak perlu hitung ulang) |
| Warna | Mengikuti tema popup (`light`/`dark`, termasuk `system` lewat `prefers-color-scheme`): latar aksen Shirabe 26%/34% transparan, warna teks tetap `inherit` |
| Siklus hidup | Ditampilkan saat lookup dimulai (hover, teks terpilih, menu konteks), dihapus saat popup ditutup/Escape/klik di luar, dan dilepas saat pemindaian dihentikan; API tidak tersedia → sorotan dilewati tanpa mengubah perilaku lain |

**Bug yang ditemukan dan diperbaiki sekaligus** (`src/content/index.ts`): rentang kata hasil
pindai selalu **lebih pendek** dari kandidatnya (mis. `手伝い` → rentang `手伝`), karena
`WindowSegment` memetakan offset potongan teks langsung sebagai offset text node padahal satu
node dipecah menjadi potongan sebelum/sesudah kursor. `domPointAtCodePoint()` kini memakai
`nodeOffset` per potongan (termasuk saat potongan depan dipangkas). Dampaknya bukan hanya
sorotan: rentang fallback untuk penempatan popup juga sebelumnya bergeser. Bukti sesudah
perbaikan (probe Chromium): hover `手伝い` → sorotan `手伝い`, header popup `手伝い`, cuplikan
menyorot `手伝い`; hover `学生` → sorotan `学生`.

**Verifikasi:** e2e `Kata yang di-lookup disorot di halaman tanpa mengubah DOM halaman`
(teks sorotan = kata yang dicari, `mark`/kelas = 0, gaya sorotan = 1) dan `Sorotan kata
hilang saat popup ditutup`, serta `Sorotan menyempit ke kata yang cocok, bukan seluruh
rangkaian huruf` (kueri tanpa spasi `彼は学生です。` → sorotan `学生`). Status popup kini juga
dipublikasikan sebagai `data-state` pada host (`loading`/`ready`/`empty`/`error`) sehingga
pengujian menunggu keadaan nyata, bukan menduga dari tinggi popup.

### 4.14 Popup tanpa kalimat sumber (deviasi PRD atas permintaan pemilik produk)

Permintaan pemilik produk: kalimat di bawah kosakata yang di-lookup pada popup tidak perlu
ditampilkan.

**Yang dihapus** (semuanya bagian fitur cuplikan konteks, bukan data kamus):

| Bagian | Sebelumnya | Status |
|---|---|---|
| Blok `.context` di popup (`data-role="context"`) | Kalimat halaman dengan kata yang dicari di-`mark`, tampil di atas kartu entri | dihapus dari popup |
| `renderSnippet()` + `SnippetView` (`src/ui/results-panel.ts`) | Renderer blok konteks | dihapus |
| `buildContextSnippet()` + `src/content/context.ts` | Perhitungan cuplikan (maks. 160 code point, batas kalimat) | modul dihapus |
| Argumen `snippet` pada alur lookup (`src/content/index.ts`, `src/content/popup.ts`) | Dihitung saat hover lalu diteruskan ke panel | dihapus dari seluruh tanda tangan |
| Gaya `.context`, `.context__text`, `.context mark`, token `--mark-bg`/`--mark-fg` | Gaya blok konteks | dihapus |
| 6 test cuplikan (`tests/content/scan.test.ts`, `tests/ui/render.test.ts`) | Perilaku blok konteks | dihapus, diganti pemeriksaan bahwa blok itu **tidak** ada |
| Dugaan tinggi popup pada harness e2e (`offsetHeight > 120`) | Bergantung pada tinggi blok konteks; popup menjadi lebih pendek setelah blok itu dihapus | diganti atribut `data-state` pada host popup (`loading`/`ready`/`empty`/`error`) |

**Yang tidak berubah:** kata yang dipindai tetap **disorot di halaman** (CSS Custom
Highlight, §4.13) — jadi pengguna tetap melihat kata mana yang sedang di-lookup, hanya
tanpa mengulang kalimatnya di popup. Pencarian tetap hanya mengirim kueri kata ke service
worker; teks halaman tidak pernah dikirim maupun disimpan (klaim privasi tetap berlaku,
kini tanpa perhitungan cuplikan sama sekali).

**Deviasi dari PRD:** acceptance kriteria "popup hasil ... dan konteks kalimat bila
tersedia" (PRD §3.1) serta §4.1 ("membatasi cuplikan konteks hingga 160 code point ... hanya
dipakai pada popup") tidak lagi dipenuhi atas permintaan pemilik produk — pola yang sama
dengan penghapusan label bentuk infleksi pada §4.10. Tidak ada kemampuan pencarian yang
hilang karena cuplikan tidak pernah dipakai untuk lookup.

**Verifikasi:** e2e `Popup tidak menampilkan kalimat sumber di bawah kosakata` (tidak ada
node `data-role="context"`, teks popup tidak memuat kalimat halaman) dan unit test panel
`tidak menampilkan blok kalimat sumber di panel hasil`; 87 pemeriksaan e2e dan 215 test
Vitest lulus.

### 4.15 Kandidat kata di tengah kalimat tanpa spasi (batas kelas karakter)

Laporan pemilik produk: pada kalimat `陸上部だったので髪型はベリィショート`, lookup `だった`
tidak menghasilkan apa pun — padahal Hachidori menemukan entri `だった` di kamus yang sama
(JMdict memang punya entri `だった`).

**Penyebab (dua lapis, keduanya terukur)**

1. **Content script** (`src/content/scan.ts`): kursor pada kana membuat kandidat mundur
   melewati rangkaian kanji sebelumnya (aturan okurigana: `食べる`, `手伝い`) dan maju
   selama karakter masih "huruf kata" — di teks tanpa spasi, maju itu berjalan sampai
   akhir kalimat. Hasilnya kueri = `陸上部だったので髪型はベリィショート` dengan kursor di
   indeks 4.
2. **Search core** (`src/core/search.ts`): enumerasi kandidat menghasilkan jendela untuk
   tiap posisi awal 0…kursor, lalu **diurutkan panjang menurun dan dipotong 48**. Dengan
   kueri 17 karakter, seluruh jendela panjang mengisi kuota, sehingga `だった`
   (mulai 4, panjang 3) tidak pernah diuji. Uji langsung: hover `だ`/`っ` di JMdict asli
   menghasilkan status `empty` dengan saran "Tidak ada hasil untuk
   “陸上部だったので髪型はベリィショート”".

**Perbaikan**

| Lapisan | Perubahan |
|---|---|
| `src/core/text.ts` | Fungsi baru `characterClass()` (kanji/hiragana/katakana/latin/lainnya) + tipe `CharacterClass`: batas antar-kelas adalah petunjuk awal/akhir kata terkuat tanpa parser morfologi (PRD 13) |
| `src/core/search.ts` | `candidateWindows()` kini: (a) tetap memakai jendela terpanjang (kata majemuk), (b) menambah jendela yang **berakhir di batas kelas terdekat**, (c) menambah **prefix di dalam segmen pertama** (mis. `だった` di dalam `だったので`, `私立` di dalam `私立大学`), dengan kuota per titik awal (6 jendela; 2 batas akhir; 3 prefix segmen) sehingga kandidat pendek tidak lagi kalah oleh kandidat panjang. Perilaku pencarian manual (`caretOffset = null`) tidak berubah |

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Unit (`tests/core/search.test.ts`, 6 test baru) | Kueri `陸上部だったので髪型はベリィショート` dengan kursor di `だった` → `candidateWindows()` memuat `だった` dan `だったので`; lookup menemukan `だった`, `ので`, `髪型`, `ベリィショート`; kursor di `だった` **tidak** memilih `陸上部` (tidak memuat posisi kursor) |
| JMdict asli (527k entri, Chromium) | hover `だ`/`っ` → header `だった`; hover `た`/`の` → `ので`; hover `は` → partikel `は`; hover di dalam `陸上部` → entri `陸上部` |
| e2e baru | `Kata di tengah kalimat tanpa spasi tetap ditemukan (だった)` — halaman uji memuat kalimat asli, popup menampilkan entri `だった` beserta definisinya (dictionary uji `demo-mini` ditambah 2 entri: `だった`, `陸上部`, sehingga hitungan entri uji menjadi 31) |
| Regresi | Seluruh e2e (88) dan unit test (221) lulus; kasus lama (学生 di `私は毎日学生です`, 日本語 di `毎日日本語を勉強します`, 私立 di `私立大学に通う`, 東京 di `東京タワー`, deinflection `食べました` → `食べる`) tetap lulus |

### 4.16 Perbandingan model pemotongan kandidat dengan Hachidori/Yomitan

Keluhan lanjutan pemilik produk: parsing masih sering mengambil satu kalimat penuh.
Untuk itu model pemotongan Hachidori dan Yomitan dibaca langsung dari kodenya
(`~/Project/hachidori/extension/content.js`, `~/Project/yomitan/ext/js/…`), lalu
diselaraskan.

**Apa yang sebenarnya dilakukan Hachidori/Yomitan**

| Aspek | Hachidori / Yomitan | Konsekuensi |
|---|---|---|
| Teks yang dipindai | Hachidori: `collectScanEntries()` mulai **dari posisi kursor** lalu maju karakter per karakter sampai `scanLength` (default 16) code point, spasi runtuh (`pushCollapsedSpace`) dan segment break CJK dibuang (`dropCjkSegmentBreaks`) | Kueri selalu ≤ ±16 code point, tidak pernah satu kalimat |
| Yomitan | `TextScanner` memindahkan awal rentang ke **awal kata** (batas spasi, `setStartOffset(scanLength, …, stopAtWordBoundary=true)`), lalu `getTextSourceContent(textSource, scanLength)` | Sama-sama dibatasi `scanLength` |
| Penentuan kata | Tidak ada parser morfologi di content script: kandidat ditentukan **oleh mesin kamus** (`hoshidicts` WASM / `Translator._getAlgorithmDeinflections`) yang mengenumerasi substring/prefix teks itu dan mendeinfleksi tiap kandidat (`_getNextSubstring(searchResolution)`) | Content script hanya menyediakan teks; "kata" ditentukan oleh kecocokan kamus, bukan tebakan batas kata |
| Panjang kunci panjang | `scan.idx` + `longKeyScan` memperpanjang hanya bila teks **berawalan** kunci panjang | Kasus khusus, bukan perilaku default |
| Teks yang ditampilkan | Hachidori menampilkan teks pindai dari kursor; Yomitan menampilkan **entri yang cocok**, bukan kueri | Query mentah tidak pernah jadi judul besar di UI |

**Selisih dengan Shirabe sebelum §4.16 ini**

1. Kandidat Shirabe sengaja **lebar** (mundur melewati kanji sebelum kana untuk dasar kata
   seperti `食べる`, maju selama karakter masih "huruf kata") → di teks tanpa spasi kueri
   menjadi satu kalimat. Kueri itu juga **ditampilkan** di header dan di pesan
   "tidak ada hasil", sehingga terlihat seperti parsing yang salah meski pencarian sudah
   mencoba kandidat pendek (§4.15).
2. Shirabe tidak punya mesin kamus yang mengenumerasi substring; enumerasi dilakukan
   `candidateWindows()` di search core (§4.15), jadi teks yang dikirim menentukan batas
   atas kandidat yang mungkin.

**Perubahan yang menyelaraskan**

| Lapisan | Perubahan |
|---|---|
| `src/content/scan.ts` | `ScanCandidate` menambah `segment`: segmen kelas karakter di sekitar kursor (hiragana/katakana dibedakan, kanji dasar kata disertakan bila rentetan kananya ≤ 4 code point = okurigana, dibatasi 12 code point). Ini padanan "teks pindai dari kursor" milik Hachidori untuk **tampilan** |
| `src/content/index.ts` | Kueri yang **dikirim** ke service worker tetap lebar (kandidat tetap lengkap), tetapi yang **ditampilkan** (header popup dan pesan "tidak ada hasil") memakai `segment`. Hasil kosong memakai kueri tampilan tersebut |
| `src/core/search.ts` + `src/core/text.ts` (§4.15) | Enumerasi kandidat dibatasi batas kelas karakter (`characterClass`) dengan kuota per titik awal — pendekatan setara dengan enumerasi prefix mesin Hachidori/Yomitan, tetapi tetap menemukan kata yang dimulai sebelum kursor |

**Verifikasi**

| Bukti | Hasil |
|---|---|
| JMdict asli (Chromium) pada `陸上部だったので髪型はベリィショート。` | kursor di `だった` → entri `だった`; di `た` → `ので`; di `髪型` → `髪型`; di `ベリィショート` → `ショート` (kata kamus terdekat); di `陸上部` → `陸上部` — semuanya `state=ready`, tidak ada lagi kueri satu kalimat |
| e2e | `Kata di tengah kalimat tanpa spasi tetap ditemukan (だった)` dan `Pesan tanpa hasil memakai segmen kursor, bukan satu kalimat penuh` (`Tidak ada hasil untuk “ベリィショート”`) |
| Unit | `tests/content/scan.test.ts`: 5 test segmen tampilan (kalimat tanpa spasi → `だったので`; okurigana → `食べる`; kanji → `学生`; hiragana/katakana dipisah → `ベリィショート`; batas 12 code point) |
| Regresi | 226 unit + 89 e2e + 3 konteks basi lulus |

### 4.17 Kata pendek di dalam rentetan panjang (がな) dan pengumpulan semua kandidat

Laporan pemilik produk: pada `俺がなんでそんなことを、とも思った。`, hover di **がな** memindai
`がなんでそんなことを` dan entri `がな` (ada di kamus) tidak muncul; sebutkan juga bahwa masih
banyak kasus serupa. Hachidori memindai kasus yang sama dengan normal.

**Dua penyebab, keduanya terbukti lewat pengujian langsung**

| # | Penyebab | Uji pembuktian |
|---|---|---|
| 1 | **Enumerasi jendela hanya menghasilkan jendela panjang.** Untuk titik awal `が` pada rentetan kana `がなんでそんなことを`, `candidateWindows()` hanya memuat jendela yang berakhir di batas kelas terdekat (indeks 12) dan 3 prefix di dekat batas itu — `がな` = `[1,3)` tidak pernah masuk daftar | Simulasi daftar jendela: hanya `がなんで…`, `がなんで…、`, `がなんでそ`, … tanpa `がな` |
| 2 | **Lookup berhenti pada jendela pertama yang cocok.** `for (const window of windows) { … return buildResult(…) }` — pada kasus ini `なんで` (mulai di kursor) cocok lebih dahulu, sehingga `がな` tidak pernah dilaporkan walau jendelanya diuji | Hasil e2e sebelum perbaikan: popup hanya memuat `なんで` |

**Perbaikan**

| Lapisan | Perubahan |
|---|---|
| `candidateWindows()` (`src/core/search.ts`) | Setiap titik awal kini menyumbang: **jendela pendek** (panjang minimum dan 3 panjang setelahnya — `がな`, `なので`, `だった`), jendela yang **berakhir di batas kelas** terdekat (kata majemuk `食べました`, `髪型は`), dan **jendela terpanjang**. Pengambilan dilakukan **bergilir antar titik awal**, jadi hipotesis terpendek setiap titik awal selalu ikut dan tidak kalah oleh kandidat panjang. Konstanta: 8 jendela/titik awal, 8 titik awal, 48 jendela total |
| `lookup()` (`src/core/search.ts`) | **Seluruh** kecocokan dari semua jendela dikumpulkan (bukan berhenti di jendela pertama), lalu dipadatkan dan diperingkat; `span` diambil dari jendela kecocokan peringkat teratas. Deinflection dibatasi 8 kueri jendela per lookup agar biaya CPU tetap terkendali |
| `rankMatches()` (`src/core/search.ts`) | Urutan kandidat: prioritas kamus → **panjang kecocokan** → jenis kecocokan → POS terverifikasi → prioritas entry → id. Panjang didahulukan atas jenis kecocokan karena seluruh jendela kini dikumpulkan: bentuk infleksi lebih panjang (`食べました` → `食べる`) harus tetap mengalahkan kecocokan exact satu karakter (`食`). Sesuai PRD 4.2 ("prioritas kamus aktif dan panjang kecocokan") |
| `scripts/benchmark.mjs` | Jumlah entri fixture dihitung dari berkas (bukan angka tetap 29) supaya fixture boleh bertambah |

**Verifikasi**

| Bukti | Hasil |
|---|---|
| JMdict asli (Chromium), kalimat pemilik produk | kursor di `が` → popup memuat entri `がな` (dan `なんで`); kursor di `そんな` → `そんな`; `思った` → bentuk kamus terkait; tidak ada lagi kueri satu kalimat |
| e2e baru | `Kata pendek di rentetan kana panjang tetap dilaporkan (がな)` — popup memuat definisi `がな` **dan** `なんで` (fixture uji ditambah entri `がな`, `なんで`; total fixture 33 entri) |
| Unit baru | `menemukan kata pendek di dalam rentetan kana panjang (がな)`: jendela memuat `がな` dan lookup mengembalikannya bersama `なんで`; `menghasilkan kandidat pendek dan panjang di sekitar kursor` |
| Regresi | 227 unit + 90 e2e + 3 konteks basi lulus; `lookup('東京都に行く')` kini melaporkan `東京都` **dan** `東京` (terpanjang dahulu) — kontrak diperbarui pada test |
| NFR (diukur ulang setelah perubahan, `npm run benchmark`) | lookup p95 2,6–17,4 ms (target ≤100 ms), hover→popup p95 114,6 ms (target ≤300 ms) — tidak ada regresi |

### 4.18 Rantai pembentukan bentuk kamus (disclosure infleksi)

Permintaan pemilik produk: bila bentuk di halaman berinfleksi (`聞こえてきた`), popup harus
menampilkan **cara kembali ke bentuk kamus** beserta keterangan tiap langkah, seperti
Hachidori/Yomitan:

```text
聞こえてきた → 聞こえる
-た   1. Indicates a reality that has happened in the past. … Usage: Attach た to the 連用形 …
-くる 1. Action towards speaker. … Usage: Attach くる after the て-form of verbs.
-て   て-form. … Usage: Attach て to the continuative form (連用形) of verbs after euphonic change form, くて …
```

**Temuan pada repo referensi** (dibaca langsung dari `/home/nexsal/Project/…`):

| Aspek | Hachidori (`Project/hachidori`) | Yomitan (`Project/yomitan`) |
|---|---|---|
| Tabel rule | `hoshidicts` C++: `Rule { from, to, conditions_in, conditions_out, group_id }` + `TransformGroup { name, description }`; kondisi = bitmask (`V1`, `V5*`, `VK`, `VS`, `TE`, `TA`, `MASU`, `BA`, …) | `ext/js/language/ja/japanese-transforms.js`: `{ name, description, conditions, rules }`; kondisi bitmask; `Rule { type, isInflected, deinflect, conditionsIn, conditionsOut }` |
| Rantai | Rekursif; tiap keadaan antara disimpan sebagai hasil; trace = urutan rule diterapkan. `聞こえてきた` → `-た`(きた→くる) → `-くる`(てくる→て) → `-て`(て→る) | BFS (`language-transformer.js`) tanpa `maxDepth`, sadar siklus; `trace` serupa; `inflectionRuleChainCandidates[{source, inflectionRules:[{name, description}]}]` |
| Sumber teks keterangan | **Literal C++** di `hoshidicts/src/deinflector.cpp` (`-て` L379-401, `-くる` L725-735, `-た` L763-786) — bukan data kamus, bukan file JSON/TSV | **Literal JS** di `japanese-transforms.js` (`-て` L629-631, `-た` L1159-1166); tidak ada `deinflect.json` |
| Tampilan | `<details>` **tertutup** di bawah headword; ringkasan “Why this matched: X became Y”; `<ol>` langkah (nama + deskripsi), maks 31 langkah + `…`, batas wire 32 langkah; teks via `textContent` | Chain inline di bawah headword: nama transformasi + `title` berisi deskripsi (dibuka lewat notifikasi klik); ikon sumber `algorithm`/`dictionary` |

**Implementasi Shirabe**

| Lapisan | Perubahan |
|---|---|
| `src/core/rules.ts` | Tabel rule kini berkondisi: `POS_CONDITIONS` (kelas kata + grup `v5`, `adj-ix`), `FORM_CONDITIONS` (`ta`, `te`, `masu`, `masen`, `ba`, `ya`, `nn`, `imp`, `copula`), `ALL_CONDITIONS`; setiap rule punya `transform`, `conditionsIn`, `conditionsOut`. Kondisi awal = seluruh kondisi, sehingga rule mana pun boleh menjadi langkah pertama |
| Tabel transformasi | 43 nama transformasi (`-た`, `-て`, `-くる`, `-ます`, `-ませんでした`, `-くありません`, `-ではありません`, …) masing-masing dengan `descriptionKey`; modul gagal saat dimuat bila ada transformasi tanpa kunci deskripsi |
| Transformasi majemuk | Linker `-いる`, `-くる`, `-いく`, `-しまう`, `-おく`, `-みる`, `-ある` (`てくる→て`, `でいる→で`, …) dengan `conditionsIn` = kelas kata verba bantu dan `conditionsOut` = bentuk te, sehingga rantai berlanjut ke `-て` |
| Koreksi | vk (くる) lampau diperbaiki dari `た→る` menjadi `きた→くる` (+ `来た→来る`, `来て→来る`), dan bentuk progresif gabungan (`ています→る`) dihapus agar terurai menjadi `-ました`/`-ません` + `-いる` + `-て` seperti referensi |
| `src/core/deinflect.ts` | BFS berkondisi dengan dedup keadaan (`text`+kondisi) sebagai pelindung siklus, dedup hasil (lema + kelas kata), `MAX_DEINFLECTION_DEPTH = 4`, `MAX_DEINFLECTION_ANALYSES = 128`; setiap analisis membawa `steps[{transformId, from, to}]` |
| `src/core/types.ts` | `DeinflectionStep` = `{ transformId, from, to }`; union `InflectionForm` dihapus karena label kini berasal dari tabel transformasi |
| `src/ui/inflection.ts` + `results.css` | Disclosure `<details>` tertutup (pola Hachidori): ringkasan jalur `bentuk permukaan → bentuk kamus`, daftar bernomor langkah (nama + deskripsi), maks `MAX_INFLECTION_STEPS = 31` + `…`; hanya muncul bila lookup benar-benar memakai deinflection; seluruh teks `textContent` |
| `src/ui/results.ts` | `MergedEntry.inflection` (bentuk permukaan + langkah) diisi dari kecocokan deinflection pertama pada kartu; disclosure dirender tepat di bawah headword |
| `src/ui/strings.ts` | Label `results.inflectionWhy`/`results.inflectionSteps` + 18 kunci deskripsi (`inflect.desc.*`) dalam `id` dan `en` |

**Keputusan lisensi teks keterangan**: teks panjang di Hachidori dan Yomitan adalah literal
berlisensi (Yomitan: GPL-3.0; deskripsi hoshidicts identik). Shirabe **tidak menyalin teks
tersebut**; deskripsi ditulis sendiri (Bahasa Indonesia + Inggris) dengan isi gramatikal yang
sama, sedangkan nama transformasi (`-た`, `-て`, `-くる`) dan daftar rule mengikuti model
konjugasi Jepang umum yang juga dipakai proyek-proyek itu. Hal ini juga menghindari
pencampuran bahasa Inggris ke UI berbahasa Indonesia.

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Unit `tests/core/deinflect.test.ts` | `聞こえてきた`→`聞こえる` = `[-た, -くる, -て]`; `書いてしまった`→`書く` = `[-た, -しまう, -て]`; `読んでいる`→`読む` = `[-いる, -て]`; `食べていました`→`食べる` = `[-ました, -いる, -て]`; lema antara (`聞こえてくる`) tetap kandidat; `maxDepth` membatasi rantai; kondisi keluar menentukan kelas kata lema |
| Unit render | Disclosure `open=false`, jalur + atribut `data-steps`/`data-surface`/`data-lemma`, urutan langkah `-た`, `-くる`, `-て`, deskripsi per langkah, batas 31 langkah + `…`, transformasi tak dikenal hanya menampilkan nama, dan nama berisi markup tetap teks |
| e2e | `Rantai deinfleksi tampil tertutup dengan langkah dan keterangannya` — popup memuat `聞こえてきた → 聞こえる`, langkah `-くる`, deskripsi `Bentuk lampau`/`Bentuk -て`, tanpa atribut `open`; fixture uji ditambah entri `聞こえる` (34 entri) |
| JMdict asli (Chromium, 527k entri, kursor tepat di karakter pertama kata) | `聞こえてきた` → `聞こえてきた → 聞こえる` langkah 3 (persis kasus pemilik produk); `食べてしまった` → `食べる` (3); `読んでいる` → `読む` (2); `食べていました` → `食べる` (3); `行ってしまった` → kartu `行く` (3 langkah), plus kartu `行う` — keduanya peluruhan yang sah dari bentuk te 行って. Semua disclosure `open=false`, waktu popup 283–289 ms (kasus `読んでいる` pada probe lebih lama karena penantian probe, bukan latensi lookup) |
| Regresi | 238 unit + 91 e2e + 3 konteks basi lulus; `npx tsc --noEmit` bersih; `npm run build` → “Validasi build MV3: OK” |
| NFR (`npm run benchmark`, diukur ulang setelah perubahan) | lookup p95 6,3–17,9 ms (target ≤100 ms), no-hit p95 6,3–6,5 ms, hover→popup p95 123 ms (target ≤300 ms) — sama dengan sebelum perubahan (p95 114,6 ms hover), jadi rantai multi-langkah tidak menambah biaya berarti: maksimum 7 analisis per jendela kandidat |

**Batas yang masih terbuka**

- **Rantai dari kamus belum dipakai**: kamus Yomitan dapat membawa deinflection sendiri
  (definisi berbentuk `[bentuk_dasar, [nama_rule, …]]`, schema term-bank v3). Importer Shirabe
  belum membaca bentuk itu (baru `rules` per definisi sebagai tag validasi kelas kata).
- **Penguraian berbeda pada sebagian akhiran**: bentuk sopan/negatif majemuk tetap satu langkah
  bernama jujur (`-ませんでした`) alih-alih dipecah menjadi `ません` + `でした` seperti sisi
  referensi; rantai majemuk verba bantu (`-いる`, `-くる`, `-いく`, `-しまう`, `-おく`, `-みる`,
  `-ある`) sudah setara.
- **Deskripsi ringkas**: 18 keluarga deskripsi menutup 43 nama transformasi (mis. `-くありません`,
  `-じゃありませんでした`, dan `-ません` berbagi keluarga sopan/negatif), jadi keterangan
  menyebut aturan pemakaian keluarga tersebut, bukan daftar bernomor panjang seperti Yomitan.

### 4.19 Katalog tema (adaptasi sistem tema Hachidori/GSM)

Permintaan pemilik produk: menganalisis bagian desain/tema Hachidori, melakukan reverse
engineering, lalu mengadaptasinya ke Shirabe. Catatan: tidak ada tema bernama "JL" pada
repo referensi (satu-satunya kemunculan `jl` adalah proyek benchmark C# di `benchmark/jl`);
yang ada adalah **katalog 42 tema** dalam grup Automatic/Dark/Light/High contrast. Katalog
itu yang diport seluruhnya (42 palet katalog + 4 palet Shirabe + `auto` = 47 pilihan), jadi
apa pun tema yang dimaksud sudah termasuk.

**Temuan pada repo referensi** (`/home/nexsal/Project/hachidori`):

| Aspek | Temuan |
|---|---|
| Katalog | `extension/reader-options.js` `POPUP_THEME_GROUPS` (L186-197): grup Automatic/Dark/Light/High contrast, 43 id termasuk `auto`; label diturunkan dari id (`default` → "Hachidori (default)") |
| Palet | `extension/render/reader.css` (L33-800): satu blok per tema berisi 18 variabel `--hoshidicts-palette-*` (`base-100/200/300`, `base-content`, `primary(+content)`, `secondary(+content)`, `accent(+content)`, `neutral(+content)`, `info(+content)`, `success`, `warning`, `error`, `color-scheme`); nilai mengikuti palet daisyUI 5 (sumber GSM PR #549) |
| Turunan semantik | Satu blok bersama (L1000-1090): `text = base-content`, `text-muted = content 76% + base-100`, `text-faint = 56%`, `border = content 16%`, `border-strong = 30%`, `accent-soft = primary 16% + base-100`, `card = base-100 72% + base-200`, `link = primary 72% + content`, `scrollbar = content 45% + base-200`, `+ opacity` popup 85%; sorotan halaman = `primary 34%` (56% pada kontras tinggi) |
| Penerapan | Atribut `data-hoshidicts-theme` pada `html` (halaman extension) atau pada host shadow DOM (popup); `auto` diselesaikan lewat `matchMedia('(prefers-color-scheme: dark)')`; skrip kecil di `<head>` menyetel atribut dan `data-hoshidicts-theme-pending` (CSS menyembunyikan antarmuka) supaya halaman tidak berkedip dengan palet salah |
| Pengujian referensi | `test/autumn-theme.test.mjs` menghitung luminans/kontras dari nilai CSS; `test/popup-theme.test.mjs` memverifikasi `auto` mengikuti perubahan preferensi dan pendengarnya dilepas kembali |

**Implementasi Shirabe**

| Lapisan | Perubahan |
|---|---|
| `src/core/themes.ts` (baru) | Katalog 47 pilihan: `auto` + 4 palet Shirabe (`shirabe-dark`, `shirabe-light`, `ereader-dark`, `ereader-light`) + 42 palet katalog referensi; tiap palet punya 18 nilai + skema; `THEME_GROUPS`, `PALETTE_VARIABLES`, `resolveThemeId()` (auto/legacy), `paletteFor()`, `normaliseThemePreference()` |
| `src/styles/tokens.css` | Ditulis ulang: palet bawaan (`--pal-*`) + **satu blok turunan** `color-mix` ke token Shirabe (`--bg`, `--bg-elevated`, `--surface`, `--card`, `--raised`, `--border(-strong)`, `--fg`, `--muted`, `--faint`, `--accent(-strong/-soft/-fg)`, `--success/--warning/--danger/--info`, `--hl-*`, bayangan, `color-scheme`). Rasio turunan mengikuti referensi; tidak ada satu blok per tema |
| `src/ui/theme.ts` | `applyPalette()` memasang variabel palet **inline** + `data-theme` (skema) + `data-theme-name` (id) pada elemen target; `themeFor()`; `markThemePending()`/`clearThemePending()` untuk anti-kedip |
| `src/core/preferences.ts` | `theme` kini id katalog; nilai lama `system`/`light`/`dark` dinormalisasi (menjaga tampilan lama), default tetap gelap |
| Halaman extension | `settings.html`, `search.html`, `action.html` mulai dengan `data-theme-pending`; `initPage()` menerapkan tema lalu melepas atribut (dan melepasnya juga bila pembacaan preferensi gagal) |
| Pengaturan | Pemilih tema diisi dari katalog dengan `<optgroup>` per grup; label grup melalui i18n (`settings.theme.group*`), label tema dari katalog/kunci i18n (grup terisi 1/19/24/1) |
| Sorotan halaman | `src/content/highlight.ts` tidak lagi memakai warna tetap: gaya `::highlight()` ditulis dari aksen palet aktif (`color-mix` dengan nilai mentah palet, termasuk oklch) |

**Keputusan & deviasi**

- PRD 3.1 hanya menyebut “tema terang/gelap/sistem”; katalog 46 tema adalah permintaan
  pemilik produk. Pilihan `light`/`dark`/`auto` tetap ada (dan `auto` tetap mengikuti
  sistem), jadi perilaku yang dijanjikan PRD tidak hilang.
- Tampilan asli Shirabe dipertahankan sebagai default (`shirabe-dark`, dan `shirabe-light`):
  preferensi lama `dark`/`light` dipetakan ke palet ini supaya pengguna yang sudah menyetel
  tema tidak berubah tampilan, sementara katalog referensi tetap tersedia sebagai pilihan.
- Peleburan dua tema tidak dilakukan: palet katalog dengan id `light`/`dark` **bukan**
  palet Shirabe; keduanya ada di daftar dengan labelnya sendiri ("Light", "Dark").
- Palet katalog memakai format `oklch()` sebagian, sehingga tidak ada perhitungan warna di
  JavaScript; seluruh pencampuran warna terjadi di CSS (`color-mix`).

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Unit `tests/core/themes.test.ts` | id unik; hanya `auto` tanpa palet; 18 nilai palet lengkap untuk 46 tema; setiap tema punya label; pengelompokan sesuai `THEME_GROUPS`; `PALETTE_VARIABLES` menutup semua kunci palet; `resolveThemeId` untuk `auto`/legacy/`miku`/`autumn`/tak dikenal; `normaliseThemePreference`; kontras teks vs `base-100`/`base-200` ≥ 4.5 untuk palet Shirabe; kontras token turunan (`muted` 76%, `faint` 56%) + tab aktif + warna status ≥ 4.5 untuk palet pembaca (§4.23) |
| Unit `tests/ui/theme.test.ts` | variabel palet inline + `data-theme`/`data-theme-name`; `auto` mengikuti perubahan `prefers-color-scheme` dan pendengarnya dilepas (`dispose`); tema eksplisit tidak memasang pendengar; legacy `system`/`light`; `themeFor()`; atribut `data-theme-pending` |
| e2e (Chromium) | pemilih tema menampilkan 4 grup (Otomatis 1, Gelap 19, Terang 24, Kontras tinggi 1); memilih `autumn` mengubah palet (`data-theme=light`, `data-theme-name=autumn`, latar `rgb(251, 246, 233)`, `--pal-primary=#596b3b`); popup dalam halaman memakai palet yang sama (`--pal-base-100: #fbf6e9` pada panel di shadow DOM tertutup, bukti `artifacts/e2e/hover-popup-autumn.png` dan `artifacts/e2e/settings-theme-autumn.png`); preferensi tema tetap tersimpan setelah browser dimulai ulang |
| Regresi | 256 unit + 95 e2e + 3 konteks basi lulus, `npx tsc --noEmit` bersih, `npm run build` → “Validasi build MV3: OK”. Termasuk perbaikan kecil yang tampak saat verifikasi visual: label versi di kartu Umum tidak lagi berulang (“Versi Versi 0.1.0” → “Versi 0.1.0”), dengan pemeriksaan e2e baru |
| NFR | perubahan hanya menambah penetapan ~18 variabel CSS inline per penerapan tema (tanpa perhitungan warna di JS), jadi tidak mengubah anggaran latensi lookup |

### 4.20 Perbaikan: popup transparan tanpa kartu (token tidak cocok di shadow DOM)

Laporan pemilik produk setelah §4.19: “tampilannya rusak, hanya ada text putih transparan
tanpa ada apa-apa”.

**Reproduksi** (Chromium, extension dari `dist/`, halaman uji dengan latar gelap; panel
diperiksa lewat CDP karena shadow DOM-nya tertutup):

| Properti panel popup | Sebelum perbaikan | Sesudah perbaikan |
|---|---|---|
| `background-color` | `rgba(0, 0, 0, 0)` (transparan) | `rgb(22, 23, 28)` (base-100 tema) |
| `color` | `rgb(0, 0, 0)` (mewarisi halaman; di situs gelap jadi putih) | `rgb(237, 238, 244)` (base-content tema) |
| `--bg` / `--fg` / `--card` | kosong | `#16171c` / `#edeef4` / `color-mix(...)` |
| `--pal-base-100` (inline dari JS) | `#16171c` (benar) | `#16171c` |

Halaman extension tidak terpengaruh (latar `rgb(22, 23, 28)` normal) — kerusakan hanya pada
popup dalam halaman.

**Akar masalah**: blok token ditulis dengan selektor `:root`, dan **`:root` tidak cocok di
dalam shadow tree** (root shadow bukan elemen; yang cocok adalah `:host` atau selektor
elemen). Sebelum §4.19, `tokens.css` mendefinisikan seluruh token di blok
`:root, [data-theme='light'] { … }` dan `[data-theme='dark'] { … }` — bagian selektor
atributnya cocok dengan `.panel` di dalam shadow root, sehingga popup bekerja. Setelah
ditulis ulang, palet berada di `:root` (terang) / `[data-theme='dark']` (gelap) dan
**turunan token (`--bg`, `--fg`, `--card`, `--s*`, `--r*`, `--fs*`) hanya di `:root`**,
sehingga tidak ada satu pun yang terpasang pada panel: `background: var(--bg)` menjadi
tidak valid (transparan) dan `color: var(--fg)` mewarisi warna halaman.

**Mengapa pemeriksaan sebelumnya lolos (dan ini penting untuk proses)**: verifikasi visual
§4.19 memakai halaman uji berlatar **putih**. Panel transparan di atas halaman putih terlihat
“normal” dan teks yang mewarisi warna halaman tampil gelap, jadi tangkapan layar tampak
benar. Karena itu pemeriksaan pengganti tidak lagi memakai tangkapan layar sebagai bukti
utama, melainkan **gaya terhitung** dari node panel di dalam shadow DOM.

**Perbaikan** (`src/styles/tokens.css`):

| Perubahan | Alasan |
|---|---|
| Palet bawaan: `:root, [data-theme='light'] { … }` dan `[data-theme='dark'] { … }` | selektor atribut ikut cocok pada `.panel` di shadow root; inline `--pal-*` dari `theme.ts` tetap menang |
| Turunan token, bayangan, jarak, radius, dan tipografi: `:root, [data-theme] { … }` | token kini selalu ada pada elemen bertema mana pun, termasuk panel popup |
| Komentar peringatan di berkas | mencegah penulisan ulang berikutnya mengembalikan bug yang sama |
| Token `--hl-*` dihapus | tidak terpakai: sorotan halaman menulis warna dari nilai palet langsung (`src/content/highlight.ts`) |

**Penjagaan regresi**

| Bukti | Isi |
|---|---|
| `tests/ui/tokens.test.ts` (baru, 4 pemeriksaan) | (1) tidak ada blok token yang hanya memakai selektor tanpa `[data-theme]`/`:host`; (2) palet `light`/`dark` tersedia lewat selektor atribut; (3) 32 token yang dipakai popup (termasuk `--s*`, `--r*`, `--fs*`) tersedia di dalam shadow DOM; (4) token semantik benar-benar diturunkan dari `--pal-*` |
| e2e “Panel popup memakai warna palet tema, bukan latar transparan” | gaya terhitung panel di shadow DOM tertutup: `background-color = rgb(22, 23, 28)`, `color = rgb(237, 238, 244)` |
| e2e “Panel popup memakai palet tema katalog terang” | tema `autumn`: `background-color = rgb(251, 246, 233)`, `color = rgb(47, 49, 39)` |
| Audit permukaan lain | hanya ada satu shadow root di proyek (`src/content/popup.ts`); sorotan halaman menulis gayanya di dokumen dan memakai nilai palet langsung, jadi tidak terpengaruh |

Uji regresi di atas **gagal** pada berkas `tokens.css` sebelum perbaikan (blok turunan
`:root` saja), sehingga cacat ini tidak dapat kembali tanpa terdeteksi.

### 4.21 Tata letak popup mengikuti design system `jl-*` Hachidori/GSM

Permintaan pemilik produk: “berdasarkan HTML ini … buat agar UI Shirabe menjadi seperti
itu”. HTML acuan memakai kelas `jl-*` (header, tabs, scroll, entry, top, spelling, reading,
dictionary, glossary-content) bersama kelas `gsm-hoshidicts-*`. Catatan penting: kelas
`jl-*` **tidak ada** di checkout Hachidori di mesin ini (hanya muncul pada cache ekstensi
yang terpasang, tanpa stylesheet), jadi tata letak diadaptasi dari struktur DOM acuan +
bahasa visual yang sudah ada di `extension/render/reader.css`.

**Pemetaan struktur**

| Acuan (`jl-*`) | Shirabe | Catatan |
|---|---|---|
| `.gsm-hoshidicts-popup` | `.panel` (shadow DOM tertutup) | tetap `data-shirabe="popup"` + `data-state` untuk observasi |
| `.jl-header` > `.jl-nav` + `.jl-tabs` | `.panel__header` > `.panel__nav` (kueri, status, tutup) + `.panel__tabs` | tab sumber kamus kini di header, bukan di badan hasil |
| `.jl-tab` (`aria-pressed`) | `.dict-tab` (`aria-pressed`) | grup tombol, `role="group"`, bisa digulir mendatar |
| `.jl-scroll` > `article.jl-entry` | `.panel__body` > `article.entry` dalam `.results` | **daftar datar**: panel per kamus dihapus |
| `.jl-top` > `.jl-spelling` + `.jl-reading` + `.jl-dictionary` | `.entry__top` > `.entry__spelling` + `.entry__reading` + `.entry__dictionary` | headword 32px, bacaan inline, label kamus sebagai chip kanan |
| `.gsm-hoshidicts-kanji-link` | `button.entry__kanji` (`data-kanji`) | klik kanji = lookup kanji tunggal (baru) |
| `.gsm-hoshidicts-definitions` > `.jl-glossary-content` | `.entry__definitions` > `.entry__glossary` | metadata sense inline `[n, ⭐, ichi]`, glosarium dengan bullet `•` |
| `.gsm-hoshidicts-resize-handle` | `.panel__resize` | tarik untuk mengubah lebar; hasilnya disimpan ke preferensi `popupWidth` |
| `.gsm-hoshidicts-audio-control`, `.gsm-hoshidicts-mine-button`, `.gsm-hoshidicts-anki-feedback` | — | **tidak diadopsi**: audio dan Anki di luar cakupan MVP (PRD §8.4) |
| `data-definition-blur`, `data-toolbar-position`, `.jl-deconj`, `.jl-frequency`, `.jl-mora` | — | fitur yang datanya belum ada di Shirabe (blur definisi, posisi toolbar, penanda frekuensi/pitch). Rantai deinfleksi Shirabe tetap ada sebagai disclosure `details.inflection` (§4.18) |

**Perubahan perilaku yang disengaja**

- **Headword kartu selalu tampil** (kebalikan aturan §4.10/§4.13): header popup memuat
  *kata yang dipindai*, sedangkan kartu memuat *bentuk kamus entri* — keduanya bukan hal
  yang sama (memindai `聞こえてきた` menampilkan entri `聞こえる`). Ini juga syarat tombol
  kanji dan bacaan inline bisa tampil seperti acuan. Aturan `hideHeadwordFor`/`primaryHeadwordInHeader`
  dihapus; pemeriksaan e2e terkait diperbarui.
- **Metadata kelas kata per sense** ditulis inline `[v5n, vi]` (bukan baris chip), sesuai
  acuan; tag penanda nomor sense tetap dibuang karena nomor sudah diberikan daftar berurut.
- **Klik kanji** mengirim lookup sumber `kanji` (jenis sumber baru, divalidasi juga di
  service worker) memakai anchor popup yang sedang terbuka.

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Unit (257 lulus) | kartu: headword polos + bacaan inline + label kamus; tombol per kanji dibuat hanya bila callback ada dan memanggil callback; metadata per sense `[n, umum]`; sense tunggal tanpa nomor; `data-role="definitions"` tetap; tidak ada chip/badge; daftar datar (tanpa `dictionary-panel`); navigasi panah pada `.results`; tab `aria-pressed` |
| e2e (99 lulus) | struktur kartu & label kamus; tab header popup (3 tab untuk 2 kamus) dan pemfilteran di halaman pencarian; klik kanji menjalankan lookup (`header=聞`, pesan kosong `Tidak ada hasil untuk “聞”`); pegangan ubah ukuran (420px → 510px, ≤720px) |
| Struktur DOM nyata (Chromium + CDP, JMdict + fixture) | `panel > panel__header (panel__nav + panel__tabs > dict-tabs > dict-tab)`, `panel__body > article.entry > entry__top (entry__spelling + button.entry__kanji + entry__reading + entry__dictionary)`, `entry__definitions > entry__glossary > ol.definitions > li.definitions__item > definitions__meta`, `panel__resize` — setara acuan `jl-*` |
| Screenshot | `artifacts/jl/popup-nutaorejinu.png` (野垂れ死ぬ dengan JMdict: 2 kartu, sense bernomor, glosarium bullet) dan `artifacts/jl/popup-gakusei-tabs.png` (学生: disclosure deinfleksi + tabel bentuk kata) |
| Regresi | `npx tsc --noEmit` bersih, `npm run build` → “Validasi build MV3: OK”, 99 e2e dijalankan berulang lulus, verify:stale 3/3 |

**Batas yang masih terbuka**: audio, Anki, blur definisi, posisi toolbar, dan penanda
frekuensi/pitch belum ada (butuh sumber data baru, di luar MVP). Label status popup untuk
lookup kanji memakai kata `kanji` (bukan teks Indonesia) karena jenis sumber dikirim apa
adanya ke service worker; pelokalan label ini bisa ditambahkan bila perlu.

### 4.22 Tag prioritas/frekuensi (`⭐`, `ichi`, `spec`, `news7k`) disembunyikan

Laporan pemilik produk setelah §4.21: “banyak banget bintangnya pada lookup kotoba
tersebut, tapi waktu aku lookup di Hachidori dengan theme JL lookupnya tidak ada bintang”,
disertai contoh baris sense `[v5r, vt, ⭐, ichi, news7k]`.

**Akar masalah (bukan bug, tetapi perilaku yang keliru menurut acuan)**

| Fakta | Bukti |
|---|---|
| Bintang berasal dari data kamus, bukan dari UI | Term-bank Yomitan baris ke-8 (`termTags`) memuat `"⭐ spec"`; importer menggabungkannya ke `entry.tags` (`src/core/yomitan.ts` L565) |
| Kategorinya resmi dari kamus | `tag_bank_1.json` JMdict: `['⭐','popular',-10,'high priority term',10]`, `['ichi','frequent',…]`, `['news7k','frequent',…]`, `['spec','frequent',…]`, `['gai','frequent',…]` |
| Hachidori tidak menampilkannya | HTML popup Hachidori yang dikirim pemilik produk hanya menulis kelas kata (`1. [v5n, vi] • …`) walau kamus yang sama memuat tag prioritas |
| Glyph `★`/`🅁`/`⛬`/`⚠️`/`➡️` berbeda urusan | Itu isi *definisi* (sense `[forms]` dan daftar rujukan) dan tetap ditampilkan apa adanya, sama seperti acuan |

**Perbaikan**

| Perubahan | Alasan |
|---|---|
| `isPriorityTag()` di `src/ui/results.ts`: tag yang hanya berisi `⭐`/`★` (kategori **popular**) dan pola `ichi`, `news…`, `nf…`, `spec…`, `gai…` (kategori **frequent**) tidak ikut ke metadata sense | Menyelaraskan baris sense dengan acuan; tag itu bukan kelas kata maupun keterangan pemakaian |
| Penyaringan hanya di penyajian | Data di storage tetap utuh (termasuk tag prioritas), sehingga tampilan frekuensi bisa ditambahkan nanti tanpa impor ulang |
| Field gabungan `MergedEntry.partOfSpeech`/`tags` dihapus | Tidak lagi dipakai setelah baris chip kartu digantikan metadata per sense (§4.21) — dead weight |

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Unit `tests/ui/render.test.ts` | `isPriorityTag` benar untuk `⭐`, `⭐⭐`, `★`, `ichi`, `ichi1`, `news1`, `news7k`, `nf24`, `spec1`, `gai2` dan salah untuk `n`, `vt`, `v5r`, `arch`, `uk`, `col`, `forms`, `adv-to`, `1`; entri dengan tag `['⭐','ichi','news7k','arch']` tampil sebagai `[v5r, vt, arch]` dan bersih dari bintang |
| e2e | Fixture `学生` diberi tag asli (`⭐`, `ichi`, `spec`, `umum`) → popup tetap menampilkan `[n, umum]`, dan pemeriksaan baru memastikan `⭐`/`ichi`/`spec` tidak muncul; pemeriksaan sense majemuk `傾ける` kini menyatakan `[v1, vt]` (tanpa `ichi`) |
| JMdict asli (Chromium) | Entri yang datanya memuat `"⭐ spec"` (mis. `Ｔシャツ`, `ＣＤプレーヤー`) kini tampil `[n]`, `[n, abbr, col]`, dst. — tanpa bintang; bukti `artifacts/jl/search-tag-priority-hidden.png` |
| Regresi | 259 unit + 100 e2e + 3 konteks basi lulus, `npx tsc --noEmit` bersih, `npm run build` → “Validasi build MV3: OK” |

**Lanjutan yang tersedia** (belum dikerjakan): impor `tag_bank_*.json` sehingga saringan ini
berbasis kategori resmi kamus (bukan pola nama) dan tag yang tersisa bisa diberi tooltip
(mis. `arch` → “archaism”, `uk` → “usually kana”), seperti yang dilakukan Yomitan.

### 4.23 Tema pembaca monokrom (`ereader-light`/`ereader-dark`) dan font bacaan serif

| Fakta | Bukti |
|---|---|
| Permintaan pemilik produk | Popup dapat diganti tema gelap dan terang dengan gaya hitam putih seperti pembaca buku elektronik |
| Jalur yang dipakai | Katalog tema yang sudah ada (bukan mekanisme baru): dua palet ditambahkan pada grup Terang dan Gelap, jadi popup, action popup, halaman pencarian, dan halaman pengaturan ikut berubah tanpa kode render tambahan |
| Masalah yang ditemukan saat memilih palet | Token turunan `tokens.css` memakai rasio tetap (`--muted` 76%, `--faint` 56% dari `content`). Dengan tinta #000… di atas kertas #fff, `--faint` jatuh ke 4.35:1 di atas `--bg` dan 4.24:1 di atas kartu, di bawah ambang AA 4.5:1 (kelas kegagalan yang sama dengan `shirabe-light`, lihat §5) |
| Keputusan | Palet pembaca memakai tinta pekat (#000000 konten di atas #ffffff untuk terang; #ececec di atas #111111 untuk gelap) supaya `--faint` = #707070 di atas #fcfcfc tetap 4.83:1. Rasio global 76%/56% tidak diubah, jadi tema lain tidak bergeser |
| Warna status | Tetap monokrom: `info`/`success`/`warning`/`error` dibedakan lewat tangga keabuan, bukan hue. Teksnya tetap membawa arti (mis. "Siap" vs pesan gagal), jadi warna bukan satu-satunya penanda |
| Font bacaan | Token baru `--font-reading` (bawaan `inherit`, jadi tema lain tidak berubah). Diterapkan pada kepala entri, baris bacaan, glosarium, dan kueri header popup, sedangkan tab, tombol, status, dan metadata sense tetap sans supaya tetap terbaca sebagai kontrol. Penimpaan serif memakai selektor `[data-theme][data-theme-name='ereader-*']` di `tokens.css` karena popup hidup di shadow DOM tertutup |

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Rasio kontras (alat `check_contrast`) | terang: konten/kertas 19.03:1, `--muted` di kartu 10.59:1, `--faint` di `bg-elevated` 4.83:1, tab aktif 21.0:1, `warning` 8.24:1; gelap: 15.98:1, 9.42:1, 5.48:1, 15.98:1, 8.79:1; semua ≥ 4.5:1 |
| Unit `tests/core/themes.test.ts` | pemeriksaan baru menghitung sendiri campuran `color-mix` (76%/56%) lalu memastikan `muted`/`faint` ≥ 4.5:1 di atas `base-100`, kartu, dan `bg-elevated`, plus tab aktif dan empat warna status untuk kedua palet pembaca |
| Unit `tests/ui/tokens.test.ts` | `--font-reading` didefinisikan pada selektor yang cocok di dalam shadow DOM (`[data-theme]`), jadi invarian §4.20 tidak dilanggar |
| e2e (Chromium) | 4 pemeriksaan baru: panel popup gelap `rgb(17,17,17)` + teks `rgb(236,236,236)`; panel popup terang `rgb(255,255,255)` + teks `rgb(0,0,0)`; kepala entri memakai daftar font serif; pada tema `dark` kepala entri tetap `Inter, ui-sans-serif, …` (serif tidak bocor ke tema lain) |
| Tangkapan layar | `artifacts/e2e/hover-popup-ereader-dark.png`, `artifacts/e2e/hover-popup-ereader-light.png` |
| Regresi | 260 unit + 104 e2e + 3 konteks basi lulus, `npx tsc --noEmit` bersih, `npm run build` → “Validasi build MV3: OK” |

**Lanjutan yang tersedia** (belum dikerjakan): ukuran huruf bacaan yang bisa diatur
pengguna dan pemilihan tinggi baris, seperti pengaturan tipografi pembaca buku.

### 4.24 Progres impor yang terukur dan status sibuk saat kamus dihapus

| Aspek | Sebelum | Sesudah |
|---|---|---|
| Bilah progres impor | Persentase tetap per fase (`reading` 10, `validating` 25, `writing` 60, `committing` 90), jadi bilah berhenti di 60% selama fase tulis yang memakan sebagian besar waktu | Dihitung dari byte: JSONL memakai byte berkas yang sudah dibaca, ZIP memakai ukuran bank + media yang benar-benar dibaca. Bilah hanya mencapai 100 pada commit |
| Penulisan yang mengejar pembacaan | Pembacaan 120.000 baris selesai dalam ~1 s, lalu bilah dan hitungan entry berhenti beberapa detik selama batch terakhir ditulis | Persentase memakai bagian terkecil dari byte terbaca dan entry tersimpan; batch yang selesai ditunggu satu per satu (`#drain`) sehingga bilah dan hitungan bergerak sampai akhir |
| Nilai bilah mundur | — | Dijaga tidak pernah turun (`nextProgressPercent`): batch baru menambah pekerjaan yang diketahui sehingga rasio "selesai dibagi diketahui" bisa turun, dan bilah yang bergerak mundur lebih membingungkan daripada berhenti sejenak |
| Teks progres | `nama berkas · N baris · X entri tersimpan dari N baris diproses` (tanpa persen/fase) | `Membaca · JMdict_english.zip · 82% · 378.468 entri tersimpan · 450.000 baris diproses` |
| Penghapusan kamus | Baris kamus tidak berubah sampai penghapusan selesai (kamus 527k entry: ±24 s tanpa umpan balik) | Baris menampilkan indikator tak-tentu "Menghapus kamus…" dan seluruh tombol baris dinonaktifkan; pesan sukses hanya muncul bila permintaan benar-benar berhasil (`mutate` kini melaporkan keberhasilan) |

Penghapusan tidak memakai persentase karena `deleteDictionary` menghapus seluruh versi
dataset dalam satu transaksi IndexedDB (range delete per store), yang tidak dapat
melaporkan kemajuan; indikator tak-tentu adalah bentuk yang jujur untuk itu.

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Unit `tests/settings/import-progress.test.ts` (5 test) | persentase dari byte; bagian terkecil byte vs entry; tidak pernah 100 sebelum commit; `committing`/`failed` = 100; total byte 0 tidak menghasilkan NaN; bilah tidak mundur saat queue bertambah |
| Smoke Chromium (120.000 entry JSONL, profil sementara) | bilah monoton naik dan terus bergerak di ekor impor: `Menyimpan · … · 43% · 51.904 entri tersimpan` → `… · 85% · 103.112 entri tersimpan · 120.001 baris diproses`; baris sibuk terlihat 23 ms setelah konfirmasi (`Menghapus kamus…`, indikator tak-tentu, tombol nonaktif), baris hilang setelah selesai |
| Smoke Chromium (JMdict ZIP nyata, 15,6 MB / 527.409 entry) | bilah 0→98% dalam 41 nilai berbeda, monoton: `… 56% · 202.577 entri tersimpan` → `82% · 378.468` → `98% · 521.876/527.409`; penghapusan 527k entry memakan 23,6 s dan baris sibuk terlihat 17 ms setelah konfirmasi |
| Regresi | 316 unit (21 berkas), 115 e2e, `npx tsc --noEmit` bersih, `npm run build` → “Validasi build MV3: OK” |
| Throughput impor | `npm run bench` pada sesi ini: 100.000 entry 13,7–16,4 s, hover→popup p95 139–160 ms. Angka `artifacts/benchmark/report.json` sekarang berasal dari sesi ini (mesin sedang 15–30% lebih lambat: hover→popup yang tidak tersentuh perubahan ikut naik dari 123 ms); perbandingan mikro jalur dekode (TextDecoderStream vs TextDecoder manual) menunjukkan selisih ±10% pada 31 MB, jadi perubahan ini tidak menambah biaya bermakna |

### 4.25 Kamus frekuensi/pitch: progres berhenti di 0% karena satu bank besar

Laporan pemilik produk: impor kamus frekuensi (`[Freq] JPDB (Recommended).zip`) "lama banget"
dan bilah progres berhenti di 0%.

**Reproduksi** (Chromium, extension `dist/`, profil sementara, arsip 6,4 MB):

| Pengukuran | Hasil |
|---|---|
| Total impor | 69,6 s |
| Bilah progres | **0% sepanjang 69,5 s**, teks tetap "0 entri tersimpan · 0 baris diproses" |
| Ringkasan impor | "0 entri dalam 1 m 10 s (baca+validasi 1 m 10 s, tulis 12 ms)" |

**Penyebab (dua, keduanya terukur dengan instrumentasi sementara pada `performance.now()`)**

1. Arsip ini hanya memuat **satu** bank meta: `term_meta_bank_1.json` 47,9 MB (515.231 baris,
   478.044 record unik). Bank kanji/meta ditulis langsung oleh halaman (`writeKanjiBatch`,
   `writeMetaBatch`), dan progres dilaporkan **setelah seluruh bank selesai** — untuk arsip
   satu bank, artinya setelah seluruh impor. Fase banknya sendiri:
   baca (dekompresi 48 MB) **0,3 s**, `JSON.parse` **0,9 s**, konversi **3,2–3,9 s**,
   penulisan 478.044 record dalam 16 transaksi **≈64–70 s** (92% waktu).
2. Rincian durasi menyesatkan: penulisan data turunan berjalan di dalam rentang yang dihitung
   sebagai "baca+validasi", sehingga laporan menyebut "tulis 12 ms" untuk 64 s penulisan.

**Perbaikan**

| Perubahan | Alasan |
|---|---|
| `reportBank()`: byte bank dihitung bertahap mengikuti potongan penulisan (bukan hanya setelah bank selesai) | Bank besar tunggal membuat progres hanya dilaporkan sekali |
| Fase dilaporkan per bank: `reading` → `validating` → `writing` | Fase baca+parse+konversi (±5 s) tidak dapat dilaporkan byte-nya; label fase membuat tahapannya tetap terlihat |
| Baris dihitung setelah parse, bukan setelah penulisan | Tanpa ini teks tetap "0 baris diproses" selama 70 s penulisan |
| `AUX_WRITE_BATCH = 10.000` (kanji/meta) | Langkah progres ~1,5 s per transaksi, bukan ~4 s. Diukur tidak menambah durasi total (75,5 s vs 76,4 s untuk 30.000) karena biaya didominasi per record, bukan per transaksi |
| Teks progres tanpa bagian "entri" bila kamus tidak punya term bank | Kamus frekuensi tidak menulis entry sama sekali; "0 entri tersimpan" selama 500.000 baris meta hanya membingungkan |
| `ImportSession.writeWaitMs` + `auxWriteMs` untuk memisahkan durasi baca/validasi dan tulis | Menjadikan laporan durasi benar untuk jalur JSONL maupun ZIP |

**Yang tidak berhasil (diuji, bukan diduga):** menulis batch meta secara berpipeline (6 batch
sekaligus, pola yang dipakai penulisan entry) **tidak** mempercepat apa pun — 76,3 s vs
69,6–75,2 s — karena IndexedDB menyerialkan transaksi pada satu koneksi. Biaya tulis
(~100 µs/record untuk commit + ~27 µs untuk pembuatan record) adalah batas desain penyimpanan
saat ini: satu record per pasangan ekspresi+bacaan dengan index ekspresi.

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Smoke Chromium, JPDB (setelah perbaikan) | total 75 s; bilah **48 nilai berbeda** (0,2,4,…,98), monoton; urutan teks: `Membaca 0%` (52 ms) → `Memvalidasi 0%` (4,2 s) → `Menyimpan 2% · 515.231 baris` (5,5 s) → 98% (~72 s); waktu di 0% turun dari **69,5 s → 5,3 s** |
| Ringkasan impor setelah perbaikan | "0 entri dalam 1 m 13 s (baca+validasi 4,7 s, tulis 1 m 8 s)" — cocok dengan instrumentasi (baca+parse+konversi ≈5,1 s, penulisan ≈69 s) |
| Smoke Chromium, JSONL 120.000 entri | bilah naik dari byte lalu bergerak mengikuti entry yang tersimpan (24% → 85%); ringkasan "120.000 entri dalam 16,9 s (7.105 entri/detik; baca+validasi 4,2 s, tulis 12,7 s)" |
| Smoke Chromium, JMdict ZIP 527.409 entri | tetap monoton 0→98% (multi-bank), penghapusan 527k entry menampilkan baris sibuk 17 ms setelah konfirmasi |
| Regresi | 317 unit (21 berkas), 115 e2e, `npx tsc --noEmit` bersih, `npm run build` → "Validasi build MV3: OK" |

### 4.26 Riset percepatan impor dan record pack untuk meta (skema v4)

Permintaan pemilik produk: percepat impor kamus secara signifikan **tanpa** mengubah hasil
lookup. Riset dilakukan dalam 9 ronde pengukuran di Chromium (konteks nyata ekstensi),
lalu diterapkan pada store meta.

**Temuan riset: biaya tulis IndexedDB adalah per *record*, bukan per byte**

| Varian (100.000 record kecuali disebut lain) | µs/record | Kesimpulan |
|---|---:|---|
| Konteks: halaman ekstensi / service worker / halaman http | 101 / 110 / 100 | konteks tidak berpengaruh |
| Skema: 1 store vs 6 store (skema Shirabe) vs database nyata | 103 / 118 / 119 | bentuk skema tidak berpengaruh |
| Izin `unlimitedStorage` | 103 (dari 102,7) | tidak berpengaruh |
| `durability: 'relaxed'` | 105–112 | tidak berpengaruh |
| 1 transaksi 100k vs 30k vs 10k per transaksi | 107 / 103 / 112 | ukuran transaksi tidak berpengaruh |
| Tanpa index ekspresi | 97 dari 103 (ronde lain 38 dari 47) | index hanya −6…−19% |
| Urutan tulis mengikuti kunci index / terbalik / key di luar record | 47,3 / 49,1 / 47,7 | tidak berpengaruh |
| Record minimal 2 field vs penuh 7 field | 106 vs 101 | ukuran nilai tidak berpengaruh |
| Skala 10k → 50k → 100k → 200k record | 47,2 / 47,6 / 47,9 / 46,5 | **datar**: biaya per request |
| Membangun record (2× NFC + objek bersarang) | 1,9–3,3 | kerja JS sudah kecil |
| Menahan 515k baris JSON + 478k entri di heap | +5–10% | GC bukan penyebab |
| **Digabung menjadi record pack (200 item/record)** | **4,99** | **17× lebih cepat** |

Konsekuensi: selama satu baris = satu record, impor 478.044 baris tidak dapat dipercepat
secara berarti (batas bawah terukur 100 µs × 478.044 ≈ 48 s). Percepatan signifikan hanya
mungkin dengan mengubah granularitas — yang disetujui pemilik produk.

**Implementasi (skema v4)**

| Aspek | Sebelum (v3) | Sesudah (v4) |
|---|---|---|
| Store | `meta`: satu record per (ekspresi, bacaan) + index `by_expression` | `meta_packs`: satu record memuat ≤1.000 item; kunci `${version}:${bucket}:${seq}` |
| Bucket | — | `packBucket()` = FNV-1a 32-bit dari ekspresi NFC mod 2048; kueri menghitung sendiri bucket-nya, jadi lookup cukup satu range read per versi aktif (`getAll` pada awalan kunci), tanpa index per baris |
| Penulisan | satu `put` per baris | item dibuffer per bucket, ditulis saat anggaran 250.000 item tercapai atau satu bucket mencapai 1.000 item; flush terakhir sebelum commit |
| Penghapusan versi | range delete pada store `meta` | range delete pada `meta_packs` (kunci tetap berawalan versi) |
| Migrasi | — | upgrade v3 → v4 menghapus store `meta` dan menandai kamus ber-`metaCount > 0` dengan `metaStale` (daftar kamus menampilkan "data pitch/frekuensi perlu impor ulang") |

Batas memori impor dijaga oleh anggaran item (±250.000 item ≈ 120 MB), bukan oleh ukuran
kamus, sehingga PRD §10 ("hindari salinan corpus penuh di heap") tetap dipenuhi.

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Prototipe Chromium, 478.044 baris | 2.048 `put` = 2,5 s (buckets 1024), 4.096 `put` = 3,0 s (2048); baca 1–2 ms per kueri |
| Impor JPDB nyata (`[Freq] JPDB (Recommended).zip`, 515.231 baris) | **9,1–11,2 s** dengan "tulis 3,7–4,0 s" (sebelumnya 75 s dengan tulis 64–70 s) → **±8×** |
| Data meta terbaca dari layout pack | LOOKUP `学生` → `meta[0].values = [{freq 2095}, {freq 106087㋕}]`; daftar kamus menampilkan "478.044 meta" |
| Unit | 321 test (21 berkas): pack menulis >1 record per bucket saat bucket penuh, lookup menyaring bacaan, bucket tidak tercampur, migrasi v3 → v4 menghapus store lama + menandai kamus |
| Regresi | 115 e2e (termasuk kontur nada pitch dari ZIP fixture), `npx tsc --noEmit` bersih, `npm run build` → "Validasi build MV3: OK" |

**Belum dipadatkan (pekerjaan berikutnya):** store `entries` (kamus istilah seperti JMdict,
527.409 baris) masih satu record per baris, jadi impornya masih ±86 s. Penyebabnya berbeda
dengan meta: entry punya **dua** kunci lookup (ekspresi dan bacaan), sehingga pemadatan
memerlukan peta reading → bucket tambahan, dan penulisannya lewat service worker
(`IMPORT_APPEND` berpipeline) yang harus diubah agar bucket ditulis utuh, bukan per batch.

### 4.27 Audit "impor macet di 0%" pada kamus besar dan konversi berpotongan

Laporan pemilik produk: impor 10 berkas berurutan menampilkan
`Reading · [Bilingual] sanseido sankoku8-… .zip · 0% · 0 entries stored · 0 lines processed`
dan tidak tampak bergerak.

**Reproduksi** dengan berkas yang sama (`[Bilingual] sanseido sankoku8-gpt-5.6-luna v2 en-jp.zip`,
34,6 MB ZIP → 229,6 MB tidak terkompresi: 47 term bank berisi 199,9 MB JSON, 93.091 entri,
395 gambar): impor **selesai dalam 47,3–49,4 s**, bukan macet permanen.

| Fase (instrumentasi sementara `performance.now()`) | Waktu | Bagian |
|---|---:|---:|
| Baca anggota arsip (dekompresi + decode) | 1,4 s | 3% |
| `JSON.parse` per bank | 3,8 s | 9% |
| **`convertTermBank` (konversi + validasi structured content)** | **28,0 s** | **65%** |
| Penulisan entry (pipelined ke service worker) | 4,8 s | 11% |
| Yield/progres/GC | ±9 s | 12% |

**Penyebab tampilan "0%"**

1. Setiap bank dikonversi dalam satu blok sinkron, dan progres hanya dilaporkan setelahnya.
   Untuk kamus satu-bank (mis. kamus frekuensi JPDB, atau Jitendex), jendela buta itu adalah
   **seluruh impor** — inilah yang membuat bilah tampak berhenti.
2. `rowsRead` baru dihitung setelah konversi, sehingga teks menampilkan "0 baris" selama
   fase termahal.
3. Tidak ada progres tingkat batch: untuk 10 berkas, teks hanya menampilkan berkas yang
   sedang diproses dan kembali ke 0% setiap berkas baru, tanpa penanda "berkas 3 dari 10".
4. "0 entri tersimpan" di awal adalah perilaku normal: penghitung entry berasal dari balasan
   service worker yang berpipeline, jadi selalu tertinggal dari jumlah baris yang diproses.

**Perbaikan yang diterapkan**

| Perubahan | Alasan |
|---|---|
| `convertTermBankChunks()`: konversi bank sebagai generator per 2.000 baris (core, dipakai importer) | Menghapus jendela buta: progres dilaporkan dan frame digambar per potongan. `convertTermBank()` tetap ada sebagai pembungkus tipis agar pemanggil lama/tests tidak berubah |
| Baris dihitung tepat setelah `JSON.parse` | Teks menampilkan jumlah baris selama konversi, bukan nol |
| Entry yang sudah dikonversi langsung dikirim (`pushMany`) per potongan | Konversi dan penulisan saling tumpang tindih; puncak memori per bank turun (tidak lagi menahan seluruh `entries` bank) |

**Verifikasi**: transisi progres setiap ±0,8 s sejak detik pertama (sebelumnya 1 langkah per
bank, ±1 s, dan jendela buta di bank pertama); waktu total 47,3 s (sebelum 47,8 s — tidak ada
regresi); 321 unit test, 115 e2e, `tsc --noEmit`, build MV3.

**Evaluasi usul "10 impor paralel dengan 10 bilah"**

| Fakta terukur | Konsekuensi |
|---|---|
| Penulisan IndexedDB tidak dapat diparalelkan: pipeline 6 batch tidak menambah throughput, dan biaya per record ±100 µs sama di halaman, service worker, maupun halaman http (§4.26) | Menjalankan 10 impor sekaligus tidak mempercepat fase tulis; antreannya justru menumpuk |
| Parse + konversi = 74% waktu berkas ini dan berjalan di thread utama (JS) | Paralelisme nyata menuntut **Web Worker**, bukan sekadar promise bersamaan |
| Satu berkas 93.091 entri = 93.091 `put` ≈ 9 s waktu IDB yang terserialisasi | Setelah parse diparalelkan, justru fase tulis yang menjadi plafon: 10 berkas ≈ 93 s |
| Setiap berkas yang sedang diproses menahan bank hasil parse + entry hasil konversi (±200 MB) | 10 paralel penuh ≈ 2 GB RAM; konkurensi harus dibatasi (3–4) |

Rencana yang diusulkan karena itu: (1) padatkan store `entries` seperti `meta` (satu record
per baris → record pack; ±100× lebih sedikit `put`, menghapus plafon tulis), lalu (2) worker
pool dengan konkurensi terbatas 3–4 dan UI satu baris per berkas aktif + baris "menunggu"
untuk sisanya, plus progres batch "berkas k dari n". Perkiraan: 10 berkas ±480 s (berurutan)
→ ±120 s.

### 4.28 Impor paralel berbasis Web Worker dan batas penulisan entry

Usul pemilik produk: impor banyak kamus sekaligus, satu bilah progres per berkas, berjalan
real-time. Diterapkan sebagai worker pool dengan konkurensi terbatas (3).

**Implementasi**

| Bagian | Perubahan |
|---|---|
| `src/settings/import-worker.ts` (baru) | Worker menjalankan `importFiles` yang sama; akses `chrome.*` tidak ada di Web Worker, jadi `IMPORT_BEGIN/COMMIT/ABORT` dan dialog konfirmasi penggantian diteruskan lewat halaman (`postMessage` berpola request/reply) |
| `src/settings/import-pool.ts` (baru) | Antrean berkas + slot worker (3), relai permintaan, agregasi status; `cancel()` meneruskan pembatalan ke worker yang sedang berjalan |
| `src/settings/importer.ts` | `request` diinjeksi (`setImportRequestHandler`) agar modul yang sama dipakai halaman dan worker; batch entry kini ditulis **langsung** dari worker lewat `appendImportBatch` (sebelumnya lewat pesan `IMPORT_APPEND`), sehingga data tidak disalin dua kali dan halaman tidak menjadi titik serial |
| Pesan `IMPORT_APPEND` + validator payload-nya | Dihapus (tidak ada lagi data kamus yang menyeberang batas pesan); `appendImportBatch` memperbarui heartbeat job di transaksi yang sama |
| UI pengaturan | Satu baris per berkas (`#import-files`) dengan status menunggu/berjalan/selesai + bilah batch "Berkas k dari n · m berjalan"; dialog konfirmasi diserialkan karena `<dialog>` hanya satu |

**Pengukuran (Chromium, mesin ini; 3 kamus besar: sanseido sankoku8 93k entry, JMdict 527k, JMnedict 666k)**

| Konfigurasi | Waktu |
|---|---:|
| Berurutan (`DEFAULT_IMPORT_CONCURRENCY = 1`) | **238,6 s** |
| Paralel 3 worker, batch entry lewat pesan halaman→service worker | 253,0 s |
| Paralel 3 worker, batch entry ditulis langsung dari worker | **228,8 s** |

Kesimpulan: paralelisme CPU **tidak memberi percepatan** untuk kamus berbasis istilah.
Penyebabnya terukur: satu entry = satu `put` (±100 µs), 1,29 juta entry ≈ 129 s waktu IDB
murni, dan di bawah tiga penulis bersamaan throughput efektif turun lagi (transaksi
menyerialkan) sehingga total tetap ±230 s. Parse + konversi memang paralel, tetapi tidak
lagi menjadi penentu.

**Langkah yang diperlukan untuk target 4×**: padatkan store `entries` seperti `meta` pada
§4.26 (satu record memuat banyak entry + peta `reading → bucket` untuk kunci lookup kedua).
Perkiraan: waktu tulis 1,29 juta entry turun ke ±2–3 s, sehingga batch menjadi CPU-bound
(±40–60 s untuk tiga kamus di atas) — yaitu ±4×. Biayanya: skema v5, migrasi yang menghapus
store `entries` lama (semua kamus istilah perlu diimpor ulang — preseden yang sama dengan
v4 untuk meta), dan pembacaan lookup per bucket (±130 entry ≈ 20–270 KB per lookup).

**Verifikasi saat ini**: 321 unit test, 115 e2e (impor JSONL/ZIP, media, replace, baris
rusak, hapus, restart), `npx tsc --noEmit`, build MV3. Progres per berkas dan pembatalan
diuji lewat pengukuran impor 10 berkas (3 berjalan bersamaan, 8 berkas selesai dalam 420 s).

### 4.29 Aksi kamus tanpa panel Detail, mode pilih, dan aksi massal

Permintaan pemilik produk: aksi aktif/nonaktif, urutan, dan hapus tidak boleh tersembunyi di
balik tombol **Detail**; tambahkan checkbox yang, saat dinyalakan, memunculkan aksi hapus,
aktif/nonaktif, dan pilih semua. Dikerjakan dengan mode antislop **during**.

**Yang berubah**

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Aksi per kamus | ↑ ↓, aktif/nonaktif, hapus berada di dalam `dictionary__detail` (harus klik **Detail** dulu) | Berada langsung di baris (`dictionary__actions`); panel **Detail** tinggal metadata (lisensi, atribusi, tanggal impor) |
| Pemilihan | tidak ada | Checkbox **Pilih kamus** di kepala kartu. Saat aktif: checkbox per baris, bilah aksi massal (**Pilih semua**, **Aktifkan**, **Nonaktifkan**, **Hapus**), dan jumlah terpilih (`aria-live`) |
| Fokus saat mode pilih | — | Aksi per baris disembunyikan sehingga baris hanya soal memilih; aksi massal jadi satu-satunya titik aksi. Karena bersifat merusak, mode ini eksplisit (bukan checkbox yang selalu tampil) |
| Konfirmasi hapus massal | — | Satu dialog menyebut jumlah dan sampai tiga nama kamus; dialog diserialkan agar dua permintaan bersamaan tidak berebut satu elemen `<dialog>` |

**Alasan desain (R-31)**: aksi harian ada di tempat kerjanya (baris), jadi tidak perlu dua
langkah untuk satu tugas; mode pilih dipisah karena aksi massal merusak dan harus disengaja;
aksen `--accent-soft` dipakai hanya untuk menandai baris terpilih (keadaan nyata, bukan
dekorasi). Tidak ada warna, ikon, atau animasi baru: seluruhnya memakai token yang sudah ada
(`--surface`, `--border`, `--accent`, `--accent-soft`, `--danger`, `--muted`).

**Verifikasi**

| Bukti | Hasil |
|---|---|
| e2e (Chromium) | 6 pemeriksaan baru lulus: aksi terlihat tanpa Detail; mode pilih via keyboard (fokus + Space) menampilkan checkbox dan bilah; **Pilih semua** mencentang 5/5 dengan jumlah "5 dipilih"; aksi massal nonaktifkan (5/5 baris nonaktif) dan aktifkan (5/5 baris aktif); mematikan mode menyembunyikan checkbox + bilah; aksi massal hapus menghapus 2 kamus setelah konfirmasi |
| Layout | Tidak ada overflow horizontal pada viewport 420 px saat mode pilih aktif (isi 420 px / tampak 420 px) |
| Kontras (alat `check_contrast`) | tema gelap: teks baris terpilih 11,8:1, ringkasan pada baris terpilih 7,06:1, teks bilah massal 8,19:1; tema terang `shirabe-light`: 13,49:1 dan 6,81:1 — semuanya ≥ 4,5:1 |
| Regresi | 121 e2e (sebelumnya 115) + 321 unit test + `tsc --noEmit` + build MV3 |

#### Aksi baris memakai glyph (lanjutan §4.29)

Permintaan pemilik produk: tombol aktif/nonaktif, hapus, dan detail cukup memakai simbol.

| Tombol | Glyph | Alasan pemilihan |
|---|---|---|
| Aktif/nonaktif | `⏻` (U+23FB) | Ter-render monokrom di sistem ini dan berarti on/off; status baris (`Aktif`/`Nonaktif`) di sebelahnya memberi konteks aksi |
| Hapus | `✕` (U+2715) | Konvensi "buang dari daftar"; tetap dijaga warna bahaya + dialog konfirmasi |
| Detail | `▾` (U+25BE) | Glyph *disclosure*; berputar 180° saat panel terbuka (`aria-expanded`) sebagai umpan balik keadaan |
| Urutan | `↑` `↓` | Sudah glyph sejak awal |

Glyph **ditolak** setelah diuji render: `⛔` (U+26D4) tampil sebagai emoji merah (bukan monokrom) dan `⊘` (U+2298) tampil sebagai tofu — glyph hilang lebih buruk daripada teks.

Konsekuensi aksesibilitas: setiap tombol glyph tetap punya `aria-label` (nama untuk pembaca layar) **dan** `title` (tooltip untuk pengguna tetikus); e2e memeriksa kelimanya. Warna bahaya pada Hapus kini hanya muncul saat hover/fokus — di daftar padat, satu tombol merah per baris menjadi titik paling mencolok dan mengalahkan hierarki nama+status; dialog konfirmasi tetap menjaga tindakannya.

| Bukti | Hasil |
|---|---|
| e2e | "Tombol glyph tetap punya nama aksesibel dan tooltip": `↑→Naikkan prioritas · ↓→Turunkan prioritas · ⏻→Nonaktifkan · ✕→Hapus · ▾→Detail`; seluruh pemeriksaan sebelumnya tetap lulus (125) |
| Kontras (alat `check_contrast`) | glyph hapus saat hover: `#cf878b` di atas `#30272c` = **5,16:1** (≥4,5:1) |
| Tangkapan layar diperiksa | baris normal (glyph seragam, ↑ baris pertama nonaktif), baris saat hover (Hapus menyala bahaya), lebar 480 px (aksi turun ke baris kedua, tanpa overflow) |

### 4.30 Popup terasa lambat saat menyapu kursor: debounce → throttle

Laporan pemilik produk: menahan modifier lalu menyapu kursor ke beberapa kata terasa ngelag,
sementara Hachidori "fast banget" pada gerakan yang sama.

**Penyebab (perilaku, bukan mikro-optimasi)**: `#scheduleHover` memakai pola **debounce** —
timer di-`cancel` dan dimulai ulang pada setiap `pointermove`. Selama kursor terus bergerak,
pemindaian tidak pernah berjalan, sehingga popup baru muncul setelah kursor berhenti 90 ms.
Hachidori memakai **throttle** yang tidak di-restart (`extension/content.js`:
*"Trailing-edge throttle: at most one scan per hoverDelayMs, always at the pointer's latest
position"*, `hoverDelayMs` default 0).

**Perbaikan**

| Perubahan | Alasan |
|---|---|
| `createThrottle()` (`src/content/throttle.ts`, baru): satu timer per interval, tidak di-restart, `run` membaca posisi pointer terbaru | Menyapu kursor tetap memindai pada laju tetap, seperti Hachidori |
| `SCAN_THROTTLE_MS = 40` menggantikan `HOVER_DEBOUNCE_MS = 90` | Satu pemindaian dapat memicu lookup service worker + render popup; 40 ms membatasi ±25 scan/detik, cukup untuk mengikuti sapuan sambil menjaga service worker |
| Hit-test (`elementFromPoint` + `caretPositionFromPoint`) dipindah dari `pointermove` ke dalam pemindaian | Biaya layout per event pointer hilang; hit-test hanya sekali per interval (pola yang sama dengan Hachidori: `scanPointer` dijalankan dari timer) |

**Pengukuran** (Chromium, 15 kata berbeda dari JMdict, kata yang tersorot dibaca dari
`CSS.highlights` di halaman dengan cap waktu yang sama seperti gerakan kursor):

| Sapuan | Debounce (sebelum) | Throttle (sesudah) |
|---|---|---|
| jeda 10 ms antar gerakan | **3/15** kata tersorot, median 97 ms | **14/15**, median 56 ms |
| jeda 10 ms, lintasan kedua | **0/15** (popup tidak pernah muncul selama menyapu) | **15/15**, median 56 ms |
| jeda 45 ms | 15/15, median 57 ms | 15/15, median 57 ms |
| long task di thread utama | 0 | **0** (tidak ada jeda UI) |

**Verifikasi**: `tests/content/throttle.test.ts` (4 test; termasuk kasus yang membedakan
throttle dari debounce: penjadwalan berulang tiap 30 ms selama 300 ms harus tetap memanggil
≥5 kali) dan e2e `Menyapu kursor antar kata tetap memperbarui sorotan/popup selama bergerak`
(sorotan berubah 3–6 kali selama sapuan). Regresi: 325 unit test, 126 e2e, `tsc --noEmit`,
build MV3.

### 4.31 Peringkat lintas kamus dan fragmen deinflection

Laporan pemilik produk: pada halaman ada `呼んだ`; Hachidori menampilkan `呼ぶ` (JMdict) sebagai
hasil utama, sedangkan Shirabe menampilkan entri **nama keluarga `呼` dari JMnedict** lebih
dahulu (kamus itu ditempatkan lebih awal), dan saat kursor berada di dalam kata, daftar hasil
dipenuhi entri palsu ("berlaku juga ke beberapa kanji").

**Dua penyebab, keduanya diperbaiki**

| # | Penyebab | Perbaikan |
|---|---|---|
| 1 | `rankMatches` mengurutkan **prioritas kamus lebih dahulu** daripada panjang kecocokan, sehingga entri `呼` dari kamus yang lebih awal (cocok 1 code point) mengalahkan `呼ぶ` (cocok 3 code point dari `呼んだ`) | Panjang kecocokan diurutkan lebih dahulu; prioritas kamus tetap menentukan urutan untuk kecocokan sepanjang sama (homonim, mis. 橋/箸) dan menjadi tie-break berikutnya |
| 2 | Seluruh jendela kandidat dikumpulkan (§4.17), sehingga jendela pendek `んだ` (kursor di `ん`) ikut terurai menjadi む/ぬ/ん dan—karena pencarian bacaan aktif—mencocokkan entri bacaan satu kanji: 無, 不, 六, ６, 陸, 无 … 12 kartu palsu | Fragmen **deinflection** yang merupakan *akhiran* dari jendela lebih panjang yang juga cocok dibuang. Kecocokan exact/reading tetap ditampilkan (itu bukti apa yang tertulis, bukan inferensi), dan fragmen **awalan** tetap dipertahankan (`東京` pada `東京都`) sesuai kontrak §4.17 |

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Unit (`tests/core/search.test.ts`) | `呼んだ` dengan JMnedict (order 0, entri `呼`) + JMdict (order 1, `呼ぶ`) → `呼ぶ` peringkat pertama; homonim sepanjang sama tetap mengikuti prioritas kamus; `んだ`-derived `無`/`六` tidak muncul; `東京` tetap tampil bersama `東京都` |
| Kamus nyata di Chromium (JMnedict + JMdict, urutan JMnedict lebih dulu) | kursor di `呼`: **1. `呼ぶ` (JMdict, `呼んだ→呼ぶ`), 2. `呼` (JMnedict, nama keluarga)** — sebelumnya nama keluarga itu yang pertama. Kursor di `ん`: 3 kartu (呼ぶ, んだ, ん) — sebelumnya 13 kartu dengan 12 entri bacaan satu kanji palsu |
| Regresi | 329 unit test, 126 e2e, `tsc --noEmit`, build MV3 |

**Pelajaran verifikasi**: probe yang memakai **profil Chromium yang sama** dapat menjalankan
*service worker lama* (masalah cache yang sama dengan §4.12), sehingga perubahan baru tampak
"tidak berpengaruh". Verifikasi akhir memakai profil bersih; unit test tidak terpengaruh karena
tidak melewati service worker.

**Catatan batas**: entri `呼` (nama keluarga) tetap muncul di bawah hasil utama karena ia
memang cocok dengan karakter yang sama — sama seperti `東京` tetap muncul saat menelusuri
`東京都`. Menyembunyikannya berarti preferensi baru (mis. "sembunyikan kamus nama dari tab
Semua"), bukan perbaikan peringkat.

### 4.32 Pemindaian mulai dari karakter di bawah kursor

Laporan pemilik produk: menyapu `んだ` di dalam `呼んだ` tetap memindai `呼んだ`; yang
diinginkan adalah pemindaian tidak menyertakan huruf **sebelum** kursor.

**Perilaku referensi** (dibaca dari kode, bukan dari kesan): Hachidori membatasi pemindaian
pada karakter di bawah pointer lewat dua langkah — `alignToCharacter` (`extension/content.js`)
menggeser caret mundur satu karakter bila pointer berada di dalam kotak karakter sebelum
caret, lalu `collectScanEntries` berjalan **maju saja** dari caret. Yomitan tidak menggeser
offset awal ke awal kata untuk bahasa tanpa spasi (`SCAN_RESOLUTION_EXCLUDED_LANGUAGES`).

**Perubahan di Shirabe**

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Awal kandidat (`src/content/scan.ts`) | Mundur dari anchor: sepanjang kanji bila kursor di kanji, sepanjang kana + kanji tepat sebelumnya bila kursor di kana (`startForAnchor`) | Kandidat dimulai **pada karakter di bawah kursor**, lalu maju sampai batas 32 code point |
| Caret (`src/content/index.ts`) | Dipakai apa adanya dari `caretPositionFromPoint` (posisi sisipan, bergantung separuh glyph mana yang kena) | Digeser ke karakter yang benar-benar berada di bawah pointer (`pointedTextAtOffset`/`alignCaretToPoint`), pola `alignToCharacter` Hachidori |
| Segmen tampilan | Menyertakan kanji dasar kata sebelum kana | Rentetan kelas karakter dari kursor saja |
| Kode mati | `startForAnchor`, `isSameScript`, `isKana`, `MAX_LOOKBACK_CODE_POINTS`, cabang okurigana | Dihapus |

**Verifikasi**

| Bukti | Hasil |
|---|---|
| Kamus nyata (JMnedict + JMdict) | kursor di `ん` (separuh kiri **dan** separuh kanan): kartu pertama `んだ`; `呼ぶ`/`呼んだ` tidak lagi muncul. Kursor di `呼`: `呼ぶ` lalu `呼` (JMnedict). Kursor di `だ`: `だ` |
| Unit (`tests/content/scan.test.ts`, 17 test) | kandidat mulai dari karakter di bawah kursor (`私は学生です。` kursor di 生 → `生です`), kanji sebelum kursor tidak disertakan (`食べたい` kursor di べ → `べたいです`), kursor di kanji tetap mencakup okurigana (`食べる` dari 食), batas 32 code point, segmen tampilan dari kursor |
| e2e (127 pemeriksaan) | pemeriksaan baru: "Hover di karakter pertama kata tanpa spasi menemukan kata itu" dan "Kursor di tengah kata memindai dari karakter itu, bukan dari awal kata" (`日本語` → `本語`, tanpa hasil). Pemeriksaan lain disesuaikan ke aturan yang sama (だった dari だ, がな dari が, sorotan menyempit dari 学, penempatan popup memakai dua kata) |

**Konsekuensi yang perlu diketahui**: kursor harus diarahkan ke **karakter pertama** sebuah
kata — di tengah `日本語` hanya `本語` yang dipindai, dan `なんで` di dalam `がなんで…` tidak
lagi muncul saat kursor di `が` (keduanya sama dengan perilaku Hachidori/Yomitan). Deinflection
dari teks yang benar-benar dipindai tetap berjalan (`んだ` → `む`/`ぶ`), jadi entri seperti
`無` masih bisa muncul di bawah hasil utama `んだ` — itu konsekuensi pencarian bacaan atas teks
tersebut, bukan sisa pemindaian ke belakang.
