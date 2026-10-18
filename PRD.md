# Product Requirements Document (PRD) — Shirabe

| Properti | Nilai |
|---|---|
| Produk | Shirabe — browser extension kamus bahasa Jepang kontekstual |
| Status dokumen | Spesifikasi awal untuk MVP |
| Tanggal | 16 Oktober 2026 |
| Platform target MVP | Google Chrome desktop berbasis Chromium, Manifest V3 |
| Bahasa antarmuka awal | Bahasa Indonesia; istilah/definisi kamus mengikuti dataset |

## 1. Product Overview

### 1.1 Tujuan

Shirabe membantu pembelajar memahami kosakata bahasa Jepang saat membaca halaman web. Pengguna dapat mencari kata di tempat kata itu muncul, melihat bentuk kamus, bacaan, definisi, dan informasi gramatikal tanpa menyalin teks ke situs kamus lain.

### 1.2 Visi

Menjadi kamus baca kontekstual yang ringan, privat, dan mudah dipasang untuk pembelajar bahasa Jepang. Shirabe mengutamakan alur baca yang tidak terputus, hasil yang dapat dipahami, serta pengelolaan kamus yang transparan.

### 1.3 Pengguna sasaran

| Pengguna | Kebutuhan utama |
|---|---|
| Pembelajar pemula–menengah | Mengetahui arti, bacaan kana, dan bentuk dasar kata yang ditemui di web |
| Pembelajar mandiri | Menggunakan kamus tanpa berpindah tab atau mengirim teks bacaan ke layanan jarak jauh |
| Pengajar/pembuat materi | Membaca teks Jepang dan menjelaskan kosakata serta kelas katanya |
| Pengembang/pengelola dataset | Memasang dan mengganti dataset lokal dengan format yang terdokumentasi |

### 1.4 Masalah yang diselesaikan

- Pencarian dengan menyalin kata ke kamus terpisah memutus alur membaca.
- Bentuk kata dalam teks sering berinfleksi sehingga tidak sama dengan bentuk lema kamus.
- Pembelajar membutuhkan bacaan dan informasi gramatikal, bukan hanya padanan arti.
- Layanan kamus daring dapat mengirim kueri atau konteks bacaan ke server pihak ketiga.

### 1.5 Indikator keberhasilan produk

- Pengguna dapat membuka definisi kata dari halaman web tanpa meninggalkan tab.
- Pengguna dapat memahami hasil tanpa harus mengetahui bentuk kamus terlebih dahulu.
- Lookup kamus berjalan lokal setelah dataset dipasang; permintaan lookup tidak memerlukan koneksi jaringan.
- Impor kamus yang valid memberi hasil yang sama sebelum dan sesudah browser dimulai ulang.

## 2. Temuan Referensi dan Keputusan Adaptasi

Temuan berikut didasarkan pada README, dokumentasi, dan berkas repositori primer yang ditautkan pada [Sumber dan status verifikasi](#15-sumber-dan-status-verifikasi). Ini adalah analisis produk/arsitektur, bukan klaim bahwa seluruh kode atau seluruh perilaku runtime telah diuji.

| Referensi | Terverifikasi dari repositori | Keputusan untuk Shirabe |
|---|---|---|
| [Yomitan](https://github.com/yomidevs/yomitan) | README menggambarkannya sebagai popup dictionary extension; mencantumkan popup definisi, audio, kanji, AnkiConnect, halaman pencarian, dan dukungan format kamus. Manifest sumber menggunakan MV3 untuk Chrome, service worker, content script, halaman pengaturan, dan permission. Dokumentasi kamus mendeskripsikan `index.json`, term/kanji/meta/tag banks dalam ZIP. | **Diadaptasi sebagai pola produk:** pemindaian teks, popup, halaman pencarian, urutan hasil kamus, pengelolaan kamus. **Dikembangkan ulang:** pencarian lokal, penguraian konteks, antarmuka, impor dan penyimpanan Shirabe. **Dibatasi:** MVP hanya bahasa Jepang dan istilah; tidak mengadopsi Anki, audio, sistem kanji, parser MeCab, atau semua format Yomitan. |
| [Hachidori](https://github.com/bee-san/hachidori) | README menyebut kamus personal, lookup blur/hitungan lookup, sharing, dan engine [hoshidicts](https://github.com/Manhhao/hoshidicts). Dokumen arsitektur menjelaskan MV3, service worker, offscreen document, WebAssembly engine, OPFS/IDBFS fallback, impor transaksi, dan pemrosesan lookup di engine. README menyebut port renderer/structured-content dari ekosistem GameSentenceMiner, Hoshi Reader, dan Yomitan. | **Diadaptasi sebagai gagasan:** istilah personal dan fitur untuk membantu mengingat kata. **Dikembangkan ulang:** manajemen data pengguna dan sistem lookup. **Ditunda:** statistik/blur, sharing, Anki, update terkelola, MDX, engine C++/WASM, multithreading dan OPFS. Kompleksitas engine Hachidori tidak diperlukan sebelum benchmark Shirabe membuktikannya. |

Klaim benchmark Hachidori di dokumentasinya adalah hasil pengukuran proyek tersebut dengan corpus, perangkat, dan konfigurasi tertentu; angka itu tidak dijadikan target atau klaim performa Shirabe.

## 3. Ruang Lingkup MVP

### 3.1 Wajib pada rilis pertama

- [ ] Extension Chrome desktop Manifest V3.
- [ ] Pencarian kontekstual pada teks halaman web dengan aktivasi yang disengaja oleh pengguna (modifier + hover) dan pencarian dari teks terpilih.
- [ ] Popup hasil dengan bentuk kamus, bacaan, definisi, kelas kata/tag, dan konteks kalimat bila tersedia.
- [ ] Pencarian manual dari popup toolbar/halaman pencarian Shirabe.
- [ ] Penguraian bentuk infleksi Jepang umum untuk verba dan adjektiva; hasil menampilkan lema dan label bentuk yang dikenali.
- [ ] Impor, aktivasi/nonaktivasi, pengurutan, dan penghapusan kamus lokal melalui satu format JSONL Shirabe.
- [ ] Penyimpanan kamus dan preferensi di penyimpanan extension lokal; pencarian offline setelah instalasi dataset.
- [ ] Pengaturan bahasa UI, modifier scan, tema terang/gelap/sistem, ukuran popup, dan daftar situs yang diberi akses.
- [ ] Status kosong, tidak ditemukan, izin belum diberikan, dataset rusak/parsial, dan error storage ditangani dengan pesan yang dapat ditindaklanjuti.

### 3.2 Pengembangan setelah MVP

- Kamus personal yang dibuat/diedit langsung dari teks halaman.
- Riwayat dan statistik lookup yang dapat dimatikan/dihapus.
- Impor ZIP kompatibel dengan subset format Yomitan (term bank v3 dan metadata yang didukung).
- Ekspor/impor backup kamus personal dan preferensi.
- Tampilan informasi kanji khusus dan data stroke order.
- Audio pelafalan, AnkiConnect, parser kalimat yang lebih akurat, pencarian frasa lanjutan.
- Firefox, browser seluler, dan browser selain Chromium setelah pengujian platform.
- Distribusi dataset rekomendasi atau katalog kamus setelah sumber, lisensi, serta kebijakan pembaruan diverifikasi.

### 3.3 Tidak termasuk ruang lingkup awal

- Sinkronisasi akun/cloud, server lookup, analitik, iklan, atau pengiriman teks halaman ke layanan eksternal.
- Integrasi Anki, media mining, screenshot, lookup blur, sharing antar-browser, dan update otomatis katalog.
- Dukungan **seluruh** bank/fitur format Yomitan, EPWING, MDX/MDD, atau kamus gambar/rich HTML. Bank term, bank kanji, bank meta istilah (pitch accent/frekuensi), dan berkas gambar yang direferensikan definisi sudah didukung (8.4); audio, Anki, template kamus, dan custom CSS belum.
- Segmentasi linguistik tingkat parser MeCab/furigana analyzer penuh atau terjemahan kalimat berbasis AI.
- Klaim bahwa hasil morfologi selalu benar untuk semua bentuk, dialek, atau kata tidak baku.

## 4. Feature Specification

Prioritas: **P0** wajib MVP, **P1** dituju setelah alur inti stabil, **P2** pengembangan lanjutan. Acceptance criteria menjadi kondisi lulus fitur.

### 4.1 Pemindaian dan lookup kontekstual — P0

- **Input:** teks halaman di bawah pointer; teks terpilih; posisi pointer; keadaan tombol modifier; izin akses situs.
- **Proses:** content script mengabaikan input yang dapat diedit, mengambil text node pada posisi pointer, membatasi cuplikan konteks hingga 160 code point di sekitar kandidat, lalu mengirim query saja ke service worker untuk pencarian lokal. Cuplikan tetap di content script dan hanya dipakai pada popup; tidak disimpan atau dikirim ke jaringan.
- **Output:** popup di dekat kata dengan lema/hasil dan cuplikan sumber jika tersedia. Kata yang dipilih pengguna diprioritaskan atas kata di bawah pointer.
- **Kondisi khusus:** tidak aktif sebelum izin situs tersedia; MVP memindai top-level document saja, bukan iframe; tidak memindai password, input, `textarea`, `contenteditable`, halaman internal browser, atau elemen tanpa teks DOM; tutup dengan Escape, klik di luar, atau scan kata baru; jika tidak ditemukan tampilkan status kosong, bukan popup kosong.
- **Acceptance criteria:**
  - [ ] Dengan izin situs dan modifier scan (default `Alt`) ditahan, hover pada kata Jepang menampilkan hasil; hover tanpa modifier tidak memunculkan popup.
  - [ ] Setelah memilih teks, pengguna dapat memilih **Cari teks terpilih** dari action popup atau menu konteks browser; hasil memakai selection, bukan kata di bawah pointer.
  - [ ] Escape menutup popup; fokus keyboard kembali ke kontrol pemicu bila relevan.
  - [ ] Tidak ada pesan lookup ketika pointer berada di input/area editable atau modifier tidak ditekan.
  - [ ] Lookup dapat digunakan setelah jaringan dimatikan dan tidak membuat request jaringan saat kata dicari.

### 4.2 Pencarian manual — P0

- **Input:** string Jepang yang dimasukkan di action popup atau halaman pencarian Shirabe.
- **Proses:** normalisasi Unicode NFC, pencarian exact/prefix berbasis index, kemudian deinflection terhadap kandidat jika pencarian exact tidak memadai.
- **Output:** daftar hasil dengan lema, bacaan, definisi, dan label kelas kata; klik hasil membuka detail.
- **Kondisi khusus:** input kosong menonaktifkan pencarian; teks non-Jepang tetap boleh dicari untuk mendukung nama/romaji yang memang terdapat di dataset; hasil maksimal 30 entri per query dengan indikator jika ada hasil lain.
- **Acceptance criteria:**
  - [ ] Enter dan tombol Cari menjalankan query yang sama.
  - [ ] Query kosong tidak diproses dan query tanpa hasil menampilkan saran memeriksa kamus aktif.
  - [ ] Mengganti query tidak menampilkan hasil lama sebagai hasil query baru.

### 4.3 Popup hasil dan detail entri — P0

- **Input:** satu atau lebih hasil lookup, cuplikan sumber lokal opsional, status bentuk infleksi.
- **Proses:** UI mengurutkan hasil sesuai prioritas kamus aktif dan panjang kecocokan; konten definisi ditampilkan sebagai teks aman, bukan HTML mentah dari dataset.
- **Output:** headword/kanji, bacaan kana, definisi, kelas kata/tag, kamus asal, kecocokan permukaan, label deinflection bila berlaku, dan cuplikan sumber maksimum 160 code point bila lookup berasal dari halaman. Detail menampilkan seluruh definisi untuk satu entri.
- **Kondisi khusus:** jika bacaan sama dengan headword, UI tidak menggandakan informasi; entri tanpa bacaan menampilkan label “bacaan tidak tersedia”; satu lema dengan banyak definisi tetap dapat dibedakan.
- **Acceptance criteria:**
  - [ ] Popup menampilkan headword, reading, definisi, dan kelas kata yang tersedia tanpa memerlukan tab tambahan.
  - [ ] Memilih hasil membuka detail dan tombol Kembali mengembalikan daftar/query sebelumnya.
  - [ ] Tag tidak dikenal tetap ditampilkan sebagai teks tanpa merusak layout.
  - [ ] Markup/script yang terkandung dalam data kamus tidak dieksekusi.

### 4.4 Penguraian kata dan deinflection — P0 (cakupan terbatas)

- **Input:** rentang teks Jepang di posisi pointer atau query manual serta aturan kelas kata pada entry.
- **Proses:** enumerasi prefiks kandidat dari posisi awal dengan batas maksimum 32 code point; untuk tiap kandidat dari yang terpanjang, lakukan exact lookup lalu deinflection jika bentuk permukaannya tidak ditemukan. Aturan berbasis data mencoba bentuk umum verba godan/ichidan/suru/kuru dan adjektiva-i. Setiap transformasi membawa label bentuk dan kelas kata; kandidat dibatasi untuk menghindari kombinasi berulang.
- **Output:** lema kamus beserta bentuk yang cocok dan label seperti bentuk te, lampau, negatif, atau sopan bila dapat ditentukan.
- **Kondisi khusus:** exact match didahulukan; beberapa lema yang sah ditampilkan sebagai alternatif; jangan mengubah teks yang dikirim untuk pencarian manual secara diam-diam; bila transformasi ambigu atau gagal, tampilkan hasil exact saja atau status tidak ditemukan.
- **Acceptance criteria:**
  - [ ] Test corpus MVP meliputi, minimal, 食べました→食べる, 書いて→書く, 高くない→高い, します→する, dan 来た→来る; entry target disediakan pada corpus uji.
  - [ ] Hasil menampilkan bentuk permukaan dan label transformasi; sistem tidak mengklaim parsing sintaksis kalimat.
  - [ ] Kandidat yang tidak diizinkan oleh tag kelas kata tidak menghasilkan false positive dari aturan kelas kata yang berbeda.
  - [ ] Maksimum 32 code point dan batas jumlah transformasi mencegah lookup memanjang pada teks sangat panjang.

### 4.5 Impor dan pengelolaan kamus — P0

- **Input:** satu file `.jsonl` UTF-8 dengan baris metadata pertama dan satu objek entri per baris berikutnya.
- **Proses:** validasi schema dan ukuran, proses berbaris/chunk, simpan sebagai dictionary berstatus `staging`, bangun index persisten, lalu aktifkan hanya setelah semua baris berhasil. Impor gagal menghapus staging dan tidak mengganti kamus versi lama.
- **Output:** ringkasan nama, jumlah entri, lisensi/atribusi, ukuran, dan status; pengguna dapat mengaktifkan, menonaktifkan, mengurutkan, atau menghapus kamus.
- **Kondisi khusus:** ID yang sama meminta konfirmasi replace; baris invalid menghasilkan nomor baris dan alasan; tabrakan nama tidak menghapus kamus yang sudah terpasang; kuota storage ditampilkan dengan arahan menghapus kamus.
- **Acceptance criteria:**
  - [ ] File valid dapat diimpor, ditutup/dibuka kembali, dan digunakan offline.
  - [ ] Impor yang gagal pada baris tengah tidak membuat versi parsial tampil sebagai kamus aktif.
  - [ ] Penggantian kamus baru berlaku setelah staging selesai; kegagalan mempertahankan versi sebelumnya.
  - [ ] Penghapusan kamus menghapus metadata dan semua entry terkait; kamus lain tetap dapat dicari.
  - [ ] Pengguna mendapat progres dan hasil per file untuk impor batch.

### 4.6 Izin situs, preferensi, dan navigasi — P0

- **Input:** aksi pengguna dari tombol extension, halaman pengaturan, dan kontrol popup.
- **Proses:** izin host diminta saat pengguna mengaktifkan scan pada situs; preferensi disimpan lokal; settings dapat dibuka dari action popup.
- **Output:** pengguna mengetahui situs mana yang dapat dipindai, konfigurasi scan, serta status kamus.
- **Kondisi khusus:** izin dicabut dari browser menyebabkan scan berhenti dan UI menerangkan cara mengaktifkan ulang; tidak meminta akses clipboard atau izin yang tidak diperlukan.
- **Acceptance criteria:**
  - [ ] Tidak ada pemindaian sebelum izin host diberikan.
  - [ ] Pengguna dapat mencabut/nonaktifkan scanning dan menyesuaikan izin situs dari pengaturan Shirabe/browser.
  - [ ] Preferensi tetap tersimpan setelah browser dimulai ulang.

### 4.7 Fitur lanjutan yang diprioritaskan — P1/P2

| Fitur | Prioritas | Perilaku, input/proses/output, kondisi khusus | Acceptance criteria saat fitur dikerjakan |
|---|---:|---|---|
| Kamus personal | P1 | Input pilihan teks dan field expression/reading/definisi/tag; simpan lokal sebagai entry terpisah; hasil lookup memberi label “Personal”. Duplikasi expression/reading ditampilkan untuk ditinjau, tidak menimpa diam-diam. Terinspirasi gagasan custom dictionary Hachidori, dengan implementasi Shirabe sendiri. | Entry dapat dibuat, diedit, dihapus, ditemukan melalui lookup, dan bertahan setelah restart; pengguna mengonfirmasi penghapusan; data personal dapat diekspor sebelum ada fitur sinkronisasi. |
| Riwayat lookup | P1 | Jika pengguna mengaktifkan pencatatan, input query yang berhasil menyimpan expression/reading dan waktu lokal; output daftar dan jumlah lookup. URL, kalimat, dan nama situs tidak disimpan secara default. Default nonaktif. | Pengguna dapat opt-in/out, menghapus satu atau seluruh riwayat; opt-out menghentikan pencatatan baru; pemeriksaan storage membuktikan tidak ada URL/konteks halaman pada record. Terinspirasi lookup count Hachidori. |
| Import subset Yomitan | P1 | Input ZIP dengan `index.json` dan term bank v3; proses validasi dan konversi hanya field yang didukung; output ringkasan entri impor dan komponen yang diabaikan. Tolak arsip/schema rusak tanpa mengganti kamus aktif; tidak merender atau mengeksekusi rich content. | Fixture valid yang dipilih menghasilkan entry sesuai field mapping; bank/tag/field tak didukung dinyatakan jelas; arsip invalid mempertahankan dataset lama; UI tidak mengklaim kompatibilitas penuh. |
| Lookup blur/latihan recall | P2 | Menggunakan statistik lokal yang telah opt-in; definisi entri yang sering dicari disamarkan sampai pengguna menekan aksi reveal. Default nonaktif; aturan ambang bisa diatur, dan blur tidak menghalangi membaca headword. | Pengguna dapat mematikan fitur; definisi dibuka dengan keyboard dan pointer; lookup tanpa riwayat tidak terpengaruh; menonaktifkan blur langsung memulihkan tampilan normal. Terinspirasi lookup blur Hachidori. |
| Kanji, audio, Anki, sinkronisasi | P2 | Merupakan fitur terpisah dengan data, izin, dan integrasi tambahan; tidak dibangun sebagai satu paket atau dianggap otomatis tersedia. | Setiap fitur harus memiliki PRD/acceptance tersendiri, sumber data dan lisensi terverifikasi, kontrol privasi eksplisit, serta tes integrasi sebelum diprioritaskan. |

## 5. User Flow dan UX/UI

### 5.1 Instalasi dan setup awal

1. Pengguna memasang Shirabe dan membuka action popup.
2. Popup menjelaskan bahwa lookup lokal memerlukan kamus dan pemindaian memerlukan izin per situs.
3. Pengguna mengimpor dataset JSONL atau memasang dataset demo yang lisensinya telah diverifikasi.
4. Pengguna menekan **Aktifkan di situs ini** pada action popup; Shirabe meminta host permission untuk origin tab aktif lalu mendaftarkan content script hanya pada situs tersebut.
5. Extension menampilkan status `Siap`, jumlah kamus aktif, dan tautan **Pengaturan**.

### 5.2 Alur pencarian dari halaman

```text
Halaman web → pengguna menahan Alt dan hover pada teks Jepang
  → content script membaca text node dan konteks terbatas
  → service worker menerima pesan lookup
  → core mencari entry persis lalu mencoba deinflection
  → popup menampilkan hasil di dekat kata
  → pengguna membuka detail / menutup / mengubah query
```

Jika pengguna memilih teks, tombol **Cari teks terpilih** di action popup atau item menu konteks **Cari dengan Shirabe** menjadikan selection sebagai input utama. Popup diposisikan dekat selection dan dibatasi ke viewport; jika ruang tidak cukup, popup berpindah ke sisi/atas yang terlihat. Popup tidak mengubah DOM situs di luar root UI milik Shirabe.

### 5.3 Struktur UI

| Area | Konten/aksi |
|---|---|
| Action popup | Input pencarian manual, tombol Cari, tombol Cari teks terpilih, status kamus aktif, tombol izin situs aktif, tombol Pengaturan |
| Popup lookup | Headword + reading, label bentuk, definisi ringkas, tag, navigasi antarhasil, tutup |
| Detail entry | Semua definisi, kelas kata/tag, sumber kamus, bentuk permukaan yang dicari, kembali |
| Halaman pencarian | Input query, daftar hasil, detail entry; berguna untuk lookup yang tidak berasal dari halaman |
| Pengaturan > Kamus | Impor, progres, status, enable/disable, urutan, hapus, ukuran/storage yang digunakan |
| Pengaturan > Membaca | Modifier, ukuran popup, durasi penutupan, tema, izin situs/scan |
| Pengaturan > Privasi | Penjelasan data lokal; kontrol riwayat hanya hadir setelah fitur riwayat dirilis |

### 5.4 Navigasi dan aksesibilitas

- `Tab`/`Shift+Tab` untuk kontrol; panah atas/bawah menavigasi hasil; `Enter` membuka detail; `Escape` menutup atau kembali satu tingkat.
- Popup memiliki fokus yang terlihat, label aksesibel, urutan heading logis, dan kontras sesuai WCAG 2.2 AA sebagai sasaran desain.
- Hormati `prefers-reduced-motion`, zoom browser, high contrast/forced colors, serta pembesaran teks.
- Ukuran popup minimum tetap terbaca pada viewport kecil; konten panjang dapat discroll tanpa mengunci scroll halaman induk.
- UI menggunakan Shadow DOM tertutup atau strategi isolasi CSS ekuivalen. Definisi ditampilkan dengan `textContent`/node aman, bukan penyisipan HTML dataset.

## 6. Technical Architecture

### 6.1 Komponen extension

| Komponen | Tanggung jawab |
|---|---|
| Manifest V3 | Mendefinisikan action, settings, service worker, izin minimum, dan host permissions opsional. |
| Content script | Scan teks/selection, menghitung konteks dan posisi, merender popup terisolasi, mengelola interaksi keyboard/pointer. Tidak memegang dataset penuh. |
| Background service worker | Router pesan, validasi sender/payload, izin situs, orchestration lookup/import, pembukaan settings. Tidak menyimpan state penting hanya di memori global. |
| Dictionary/search core | Normalisasi, lookup exact, ranking, deinflection terbatas dan transformasi hasil. Core murni agar dapat diuji tanpa browser. |
| IndexedDB | Menyimpan metadata kamus, entry, index, staging import, dan preferensi skala kecil. |
| Halaman Settings/Search | UI extension dengan akses file picker, pengelolaan kamus, pencarian manual, progres, dan status storage. |

#### Izin minimum yang direncanakan

| Izin | Penggunaan |
|---|---|
| `storage` | Preferensi extension berukuran kecil. |
| `scripting` | Mendaftarkan/melepas content script hanya untuk origin yang telah disetujui pengguna. |
| `activeTab` | Membaca konteks tab aktif setelah pengguna membuka action popup untuk mengaktifkan situs atau mengambil selection. |
| `contextMenus` | Menyediakan aksi eksplisit **Cari dengan Shirabe** pada teks terpilih. |
| Optional host permissions `http://*/*`, `https://*/*` | Diminta per situs saat pengguna mengaktifkan pemindaian; tidak meminta akses semua situs pada instalasi awal. |

Saat izin dicabut, content script untuk origin terkait dilepas dan scan dihentikan. Tidak ada permission untuk clipboard, cookies, atau koneksi server kamus pada MVP.

**Keputusan MV3:** service worker menjadi router tipis dan dapat dimulai ulang kapan saja. Request harus mandiri dan tidak bergantung pada variabel global yang bertahan. Lookup database dilakukan melalui modul data yang membuka kembali koneksi IndexedDB bila perlu. Gunakan Web Worker untuk parsing/import hanya jika profiling menunjukkan pekerjaan mengunci UI; **offscreen document, OPFS, WebAssembly, dan pthreads bukan prasyarat MVP**.

### 6.2 Komunikasi antarkomponen

Gunakan `chrome.runtime.sendMessage` untuk pola request/response sederhana. Pesan memiliki `id`, `type`, `payload`, dan versi schema; service worker memeriksa tipe, ukuran, asal tab/frame, serta izin sebelum memproses.

| Pesan | Pengirim → penerima | Payload minimum |
|---|---|---|
| `LOOKUP` | Content/action/search → service worker | query, source (`hover`/`selection`/`manual`), optionsContext minimum; tidak menyertakan cuplikan halaman |
| `LOOKUP_RESULT` | Service worker → pemanggil | entries, match span, lookup status, deinflection path opsional |
| `GET_SELECTION` | Action popup → content script pada tab aktif | request selection saat pengguna menekan Cari teks terpilih |
| `IMPORT_PROGRESS` | Service worker → settings | import id, fase, jumlah baris, error ringkas |
| `SETTINGS_GET/SET` | Settings/action → service worker | key preference yang diizinkan dan nilainya |
| `SITE_SCAN_ENABLE` | Action popup → service worker | origin tab aktif dan konfirmasi izin pengguna |

Kegagalan menghasilkan response terstruktur (`code`, `message`) tanpa data sensitif. Pesan dari konten halaman tidak dipercaya; jangan menerima nama object store, query SQL, HTML, URL download, atau instruksi kode dari content script.

### 6.3 Alur pemrosesan teks

1. Untuk aksi Cari teks terpilih, content script pada tab aktif mengembalikan selection saat itu; untuk hover, identifikasi text node di posisi pointer.
2. Abaikan elemen yang dilarang oleh spesifikasi fitur 4.1.
3. Normalisasi input ke NFC tanpa mengubah karakter tampilan sumber.
4. Bentuk kandidat prefix berdasarkan code point Jepang hingga batas 32; jangan memotong pasangan surrogate.
5. Cari kandidat exact dari yang terpanjang; gunakan susunan kamus aktif untuk ranking dan batasi hasil.
6. Untuk setiap kandidat dari yang terpanjang, bila exact lookup tidak cocok, jalankan deinflection terbatas dan cari lema kandidat sebelum mencoba kandidat yang lebih pendek.
7. Kembalikan span teks, hasil, dan label bentuk; content script menampilkan cuplikan lokalnya (maksimal 160 code point), yang tidak diteruskan ke service worker atau direkam pada MVP.

### 6.4 Pencarian kamus

- Gunakan index persisten IndexedDB atas expression; exact lookup menjadi jalur pertama. Index tambahan atas reading boleh dipakai untuk query kana.
- Kandidat dibangkitkan dari teks pada caret, bukan dengan memindai seluruh corpus. Batas hasil dan kandidat wajib diberlakukan.
- Deduplikasi tampilan memakai pasangan dictionary ID + entry ID; entry antar-kamus tetap dipertahankan dan diurutkan berdasarkan urutan kamus pengguna.
- Deinflection menggunakan aturan eksplisit dan tag POS; setiap langkah memiliki kondisi, bentuk pengganti, dan label yang dapat diuji.
- Hindari memuat seluruh kamus ke RAM. Cache hanya metadata dan hasil query terbatas, dengan batas ukuran yang diukur.

### 6.5 Pengelolaan data dan error recovery

- Metadata kamus menyimpan ID, nama, bahasa, versi format, lisensi, atribusi, jumlah entri, status, waktu impor, dan ukuran perkiraan.
- Impor menggunakan ID staging berbeda dari ID publik. Setelah semua baris lolos validasi, satu operasi final mengalihkan metadata aktif ke dataset baru; penghapusan versi lama dilakukan sesudah commit.
- Batch transaksi memiliki ukuran terukur agar tidak menahan memori atau membuat transaksi terlalu lama. Progress tidak mengklaim keberhasilan sebelum commit.
- Saat startup, data `staging` yang tertinggal dibersihkan atau ditawarkan pemulihan; tidak pernah diperlakukan sebagai kamus aktif.
- Ekspor/backup tidak termasuk MVP, tetapi desain ID dataset dan metadata harus memungkinkan fitur itu tanpa mengubah entry secara destruktif.

## 7. Technology Stack

| Bagian | Rekomendasi | Alasan |
|---|---|---|
| Extension API | Manifest V3, Chrome Extensions API | Service worker dan content script sesuai pola extension Chromium modern; host access diminta per situs melalui optional host permissions dan content script didaftarkan setelah izin diberikan. |
| Bahasa | TypeScript | Memeriksa kontrak pesan, schema data, dan hasil parser; cocok untuk beberapa execution context. |
| Build | Vite atau bundler ringan setara, tanpa framework UI sebagai default | Menghasilkan bundle terpisah untuk content, worker, action, dan settings; framework baru dipilih hanya bila kompleksitas UI menuntutnya. |
| UI | HTML/CSS/TypeScript native | Popup dan settings berlingkup kecil; menghindari biaya framework sebelum kebutuhan terbukti. |
| Persistence | IndexedDB native | Data kamus dapat melebihi kapasitas nyaman `localStorage`, dan index/transaction mendukung lookup serta staging. |
| Impor MVP | JSONL UTF-8 + `File.stream()`/`TextDecoderStream` atau pembacaan chunk ekuivalen | Berbaris dan dapat divalidasi tanpa membaca seluruh dataset sekaligus; tidak perlu parser ZIP khusus di MVP. |
| Testing | Vitest untuk core; Playwright untuk extension UI/Chromium; pengujian manual kompatibilitas | Uji aturan bahasa deterministik terpisah dari browser dan uji jalur izin/popup/import nyata. |

Stack final mengikuti versi runtime yang benar-benar ditetapkan saat implementasi. Dependency ZIP baru diperlukan hanya saat fitur import Yomitan ZIP disetujui; jangan mengimplementasikan parser ZIP sendiri.

## 8. Dictionary System

### 8.1 Format dataset MVP — Shirabe JSONL v1

File terdiri dari satu baris header dan satu baris JSON untuk setiap entri. Header mencatat lisensi/atribusi; entry berupa data plain, tidak menerima HTML mentah.

```jsonl
{"type":"shirabe-dictionary","schemaVersion":1,"id":"contoh-ja-id","name":"Kamus Contoh","language":"ja","definitionLanguage":"id","license":"Isi lisensi dataset","attribution":"Nama penerbit/sumber dataset"}
{"expression":"食べる","reading":"たべる","definitions":["makan"],"partOfSpeech":["v1"],"tags":[],"rules":["v1"]}
{"expression":"学生","reading":"がくせい","definitions":["pelajar; mahasiswa"],"partOfSpeech":["n"],"tags":[],"rules":[]}
```

Ketentuan schema:

- `expression`: wajib, string non-kosong; bentuk kanji/kana yang dicari.
- `reading`: string kana opsional; kosong jika sumber tidak menyediakan bacaan.
- `definitions`: wajib berupa array string non-kosong; urutan definisi dipertahankan.
- `partOfSpeech`, `tags`, `rules`: array string opsional; nilai sumber ditampilkan dengan label yang tersedia.
- `schemaVersion`: versi integer; versi yang tidak didukung ditolak dengan pesan jelas.
- Encoding UTF-8, normalisasi pencarian NFC, duplicate expressions diperbolehkan karena homonim, kamus berbeda, atau bacaan berbeda.
- Batas awal file dan panjang baris harus dikonfigurasi dari uji pada perangkat target; batas tersebut dilaporkan sebelum impor, bukan menyebabkan tab browser tidak responsif.

### 8.2 Dukungan kosakata Jepang

- Kanji, hiragana, katakana, campuran kanji-kana, kata majemuk, dan istilah yang tersedia di corpus.
- Lookup berdasarkan expression; query kana dapat mencocokkan reading jika fitur reading-search diaktifkan.
- Nama diri dan kosakata khusus hanya tersedia jika dataset berisi entri terkait.
- MVP tidak menjamin pencarian berdasarkan romaji, varian ejaan, aksen regional, atau kamus kanji khusus. Pitch accent dan frekuensi **ditampilkan** sebagai badge bila pengguna memasang kamus meta (8.4), tetapi pencarian dan peringkat hasil tidak memakainya; kamus kanji dipakai untuk menampilkan data kanji saat kanji pada headword diklik, bukan sebagai sumber istilah.

### 8.3 Penguraian kata dan informasi gramatikal

MVP memakai pencocokan kamus terpanjang dari posisi teks yang dipilih dan deinflection rule-based. Ini bukan parser sintaksis; partikel, batas klausa, dan relasi gramatikal tidak disimpulkan. Dataset menyediakan lemma, bacaan, definisi, dan tag POS; aturan Shirabe memetakan infleksi umum ke lemma sesuai POS. Label infleksi harus berasal dari rule yang benar-benar cocok, bukan diturunkan dari tebakan UI.

### 8.4 Kompatibilitas format Yomitan

Format Yomitan didokumentasikan dalam repositorinya sebagai ZIP berisi `index.json`, term bank, dan opsional term meta/tag/kanji bank. Shirabe menerima **subset** format itu langsung dari halaman Pengaturan: term bank v3 (beserta structured content yang divalidasi), `kanji_bank_*.json`, `term_meta_bank_*.json` (pitch accent dan frekuensi), serta berkas gambar yang direferensikan definisi. Arsip yang hanya memuat bank kanji atau bank meta diterima: kamus KANJIDIC, kamus pitch accent, dan kamus frekuensi memang tidak punya term bank.

Aturan yang mengikat implementasi:

- **Gambar berasal dari kamus, bukan dari jaringan.** Simpul `img` hanya menyimpan jalur relatif di dalam kamus; byte-nya dibaca dari store `media` dan dikirim ke popup sebagai data URL. Jalur dengan skema, `..`, `?`, atau `#` ditolak, dan hanya berkas yang benar-benar direferensikan definisi yang disimpan (batas 2 MB per berkas, 64 MB per kamus).
- **Data turunan ikut staging.** Record `meta`/`kanji`/`media` memakai versi dataset pada kuncinya, sehingga impor gagal atau proses yang terputus tidak pernah terlihat sebagai kamus aktif, dan penghapusan kamus membersihkan keempat store sekaligus.
- **Kamus tanpa istilah tetap terlihat berhasil.** Metadata kamus menyimpan jumlah kanji, meta, dan media; daftar kamus menampilkan ringkasan itu supaya kamus kanji/pitch tidak terbaca sebagai kamus kosong.
- **Tetap dilaporkan, bukan diklaim berhasil.** `kanji_meta_bank_*`, `tag_bank_*`, custom CSS/template, audio, dan tautan `a` (diratakan menjadi teks) dicatat di ringkasan impor. Baris kanji/meta yang tidak sesuai schema juga dilaporkan sebagai entri dilewati.
- **Batas kemampuan.** Pitch accent dan frekuensi hanya ditampilkan (tidak memengaruhi pencarian/peringkat), bank kanji hanya dipakai untuk tampilan kanji, dan Shirabe tidak mengklaim kompatibilitas penuh dengan ekosistem Yomitan.

## 9. Data Management

### 9.1 Penyimpanan

| Object store konseptual | Data | Key/index |
|---|---|---|
| `dictionaries` | Metadata, status aktif, urutan, versi, atribusi | `id` |
| `entries` | Expression, reading, definitions, POS, tags, rules | key unik internal; index expression dan dictionary ID |
| `meta` | Pitch accent dan frekuensi per bentuk istilah (dari `term_meta_bank_*.json`) | key unik internal (versi + ekspresi + bacaan); index ekspresi |
| `kanji` | Karakter, onyomi, kunyomi, tag, arti, statistik (dari `kanji_bank_*.json`) | key unik internal (versi + karakter); index karakter |
| `media` | Byte berkas gambar kamus yang direferensikan definisi | key unik internal (versi + jalur); index kamus + jalur |
| `preferences` | Preferensi UI/scan yang kecil | key preference |
| `importJobs` (jika diperlukan) | Progres/resume minimal dan status staging | import ID |

Skema fisik akhir ditetapkan melalui migrasi IndexedDB berversi. Index gabungan boleh dipilih bila profiling menunjukkan perlu; jangan membuat index redundan tanpa bukti. Lookup history dan personal entries menggunakan store terpisah setelah fitur terkait masuk roadmap.

### 9.2 Impor dan penggantian

- Pengguna memilih file lokal; tidak ada fetch remote pada MVP.
- Metadata dan sampel baris divalidasi sebelum menulis banyak data.
- Import progress membedakan membaca, memvalidasi, menyimpan, commit, dan gagal.
- Dataset baru ditulis ke staging; kamus aktif lama tetap tersedia hingga commit sukses.
- Jika kuota habis, transaksi aktif dihentikan, staging dibersihkan semampunya, dataset lama dipertahankan, dan UI menyarankan menghapus kamus/mengosongkan ruang.
- Penghapusan dataset memerlukan konfirmasi yang menyebut nama dan perkiraan jumlah data.

### 9.3 Pengaturan pengguna

Preferensi awal: scanning aktif/nonaktif per situs, modifier, tema, ukuran popup, preferensi penutupan popup, dan urutan kamus. Gunakan `chrome.storage.local` untuk preferensi kecil bila lebih sederhana; IndexedDB tetap untuk entry besar. Jangan simpan preferensi sensitif atau kunci API karena tidak diperlukan.

## 10. Non-Functional Requirements

| Area | Kebutuhan terukur/aturan |
|---|---|
| Performa lookup | Pada perangkat acuan yang ditetapkan QA, setelah kamus aktif dan warm-up, p95 dari pesan `LOOKUP` diterima hingga hasil tersedia ≤100 ms untuk dataset uji MVP; p95 dari aktivasi scan hingga popup terlihat ≤300 ms. Catat hardware, ukuran corpus, dan versi browser bersama hasil. |
| Performa startup | Popup/action tersedia tanpa memuat seluruh dictionary di memori. Ukur startup worker dingin dan waktu query pertama; tetapkan baseline pada tahap implementasi awal, lalu jangan regresi >20% tanpa persetujuan. |
| Impor | Import 100.000 entry pada perangkat QA tidak membuat UI tidak responsif lebih dari 100 ms per frame secara berkelanjutan; progress terlihat dan satu entry rusak tidak menyebabkan silent success. Waktu total dibenchmark dan dicatat, bukan disamarkan sebagai SLA absolut. |
| Memori | Entry dibaca melalui index/chunk; hindari salinan corpus penuh di heap. Catat peak JS heap dengan corpus uji representatif dan pastikan memori kembali stabil setelah impor/penutupan UI. Target angka final ditetapkan setelah baseline prototipe. |
| Kompatibilitas | MVP mendukung Chrome desktop versi stabil saat rilis dan satu versi utama sebelumnya. Edge Chromium ditargetkan setelah smoke test; Firefox/Safari/Android tidak diklaim didukung sebelum pengujian terpisah. |
| Privasi | Lookup lokal; tidak ada analytics/telemetry/network request untuk query. Host permission diminta pada aksi pengguna per situs. URL, kalimat, dan lookup tidak disimpan pada MVP. |
| Keamanan | Validasi pesan dan dataset; tidak mengeksekusi kode/data rich content; permission seminimal mungkin; tidak memakai `eval`; content script mengisolasi UI. Dependency dan lisensinya dicatat. |
| Aksesibilitas | Operasi inti dapat dilakukan keyboard, fokus terlihat, warna/kontras memadai, dukungan zoom dan reduced motion. Sasaran desain WCAG 2.2 AA, diuji pada popup dan settings. |
| Reliabilitas data | Kegagalan impor tidak menghapus dataset aktif. Penggantian dan hapus menampilkan hasil aktual, serta browser restart tidak menghilangkan kamus yang sudah commit kecuali browser membersihkan storage. |
| Maintainability | Search core tidak tergantung API DOM/Chrome; schema dan pesan berversi; aturan deinflection memiliki fixtures; seluruh dependency runtime dibatasi dan lisensinya diperiksa. |

## 11. Development Roadmap

| Tahap | Cakupan dan dependensi | Definition of Done |
|---|---|---|
| 0. Keputusan data dan izin | Tentukan sumber dataset demo, lisensi/atribusi, corpus uji Jepang, target browser, schema JSONL v1, dan teks penjelasan izin. Dependensi: keputusan produk sebelum implementasi importer. | Dataset uji dengan izin penggunaan tercatat; schema v1 tervalidasi; browser target dan daftar permission disepakati. Jika dataset demo belum legal/tersedia, alur MVP mendukung impor file pengguna dan UI menjelaskan kebutuhan dataset. |
| 1. Kerangka extension dan permissions | Manifest MV3, action popup, settings shell, optional host permissions, enable/disable site scan. | Extension dapat dipasang unpacked; permission tidak diminta sampai aksi jelas; test tab normal dan browser internal page. |
| 2. Data model dan impor | IndexedDB schema, JSONL streaming/chunk importer, staging, rollback, manage dictionary. | Lulus acceptance 4.5; restart mempertahankan dictionary; dataset lama tidak hilang pada kegagalan/replace. |
| 3. Search core | NFC, lookup expression/reading, ranking, kandidat panjang, deinflection rule set dan test corpus. Dependensi: schema serta corpus dari tahap 0/2. | Skenario morfologi yang disepakati lulus; result deterministik; benchmark terukur; core berjalan dalam test tanpa Chrome API. |
| 4. Popup dan integrasi halaman | Content script, selection/hover, messaging, popup terisolasi, keyboard navigation. Dependensi: search API stabil. | Alur halaman lulus acceptance 4.1/4.3 pada teks biasa; form/iframe/selection tanpa hasil ditangani; tidak ada konten definisi dieksekusi. |
| 5. Settings, UX, dan hardening | Tema, ukuran, urutan kamus, error states, accessibility, izin, privacy copy. | Keyboard-only smoke test; pengujian zoom/kontras; permission dan privasi sesuai kebutuhan; error import/storage dapat dipahami. |
| 6. Release candidate | Uji kompatibilitas, performa, pemasangan bersih, migrasi schema, dan dokumentasi pengguna singkat. | Seluruh P0 pass; tidak ada blocker/high severity; build MV3 valid; dataset distribusi dan attribution disetujui; pengukuran NFR dicatat. |
| 7. Fitur lanjutan | Personal dictionary/riwayat (P1), adapter Yomitan subset, kemudian kanji/audio/Anki (P2). | Setiap fitur memiliki spesifikasi, lisensi/data source, kontrol privasi, acceptance criteria, dan pengujian sebelum masuk rilis. |

## 12. Testing Requirements

### 12.1 Fungsional dan unit

- [ ] Normalisasi NFC: query dan dataset dengan representasi Unicode ekuivalen menghasilkan kecocokan.
- [ ] Exact headword, homonim, beberapa bacaan, urutan antar-kamus, kamus disabled, serta kamus tanpa reading.
- [ ] Kandidat terpanjang, kata majemuk, prefix yang tidak ditemukan, query lebih dari batas panjang, serta pasangan surrogate.
- [ ] Deinflection corpus: bentuk te/lampau/negatif/sopan verba umum dan adjektiva-i; POS mismatch tidak menghasilkan lemma salah.
- [ ] Input kosong, teks non-Jepang, dataset kosong, definisi banyak, tag asing, dan hasil melebihi limit.
- [ ] Pesan malformed, sender tidak dikenal, permission hilang, dan error database menghasilkan status terkontrol.

### 12.2 Integrasi

- [ ] Install extension bersih, import dataset, cari kata, restart browser, cari kata yang sama.
- [ ] Import JSONL valid/rusak, invalid line di tengah, schema masa depan, file besar, replace, cancel, dan storage quota failure.
- [ ] Permission situs diberikan, ditolak, dicabut; scan hanya bekerja pada origin yang diizinkan.
- [ ] Lookup dari selection dan hover modifier; popup tidak masuk ke field input dan dapat dinavigasi keyboard.
- [ ] UI halaman dengan CSS ekstrem, z-index tinggi, dark mode, teks panjang, dan layout yang berubah dinamis.

### 12.3 Performa dan penggunaan resource

- [ ] Corpus benchmark memuat sekurangnya dataset MVP dan set data besar 100.000 entry; ukur lookup cold/warm p50/p95, startup, import throughput, peak JS heap, dan jumlah hasil.
- [ ] Benchmark mencakup query exact, query melalui deinflection, no-hit, dan banyak hasil.
- [ ] Import tidak menghasilkan jeda UI berkelanjutan; batalkan/gagal tidak meninggalkan status aktif parsial.
- [ ] Simpan versi browser, CPU/RAM perangkat uji, ukuran file, jumlah entri, dan konfigurasi setiap pengukuran.

### 12.4 Kompatibilitas dan aksesibilitas

- [ ] Chrome target versi stabil dan versi utama sebelumnya; Edge hanya dicatat sebagai teruji setelah smoke test.
- [ ] Halaman HTTP/HTTPS, halaman panjang, halaman dinamis, tab tanpa permission, serta halaman extension/browser internal.
- [ ] Keyboard-only, screen reader smoke test, zoom 200%, reduced motion, forced colors/high contrast, dan viewport kecil.
- [ ] Browser menutup/menjalankan ulang service worker di antara lookup; request tetap berfungsi tanpa state global yang tertinggal.

## 13. Risks and Constraints

| Risiko/kendala | Dampak | Mitigasi |
|---|---|---|
| Dataset Jepang berlisensi/atribusi tidak tersedia atau ketentuan redistribusi tidak jelas | Produk tidak dapat menyertakan kamus demo atau distribusi dataset dapat melanggar syarat | Tahap 0 memeriksa lisensi untuk tiap dataset dan aset; simpan sumber, versi, lisensi, atribusi, serta batas redistribusi. Sediakan impor dataset pengguna jika distribusi belum disetujui. |
| Format Shirabe JSONL tidak kompatibel langsung dengan ekosistem Yomitan | Pengguna harus menyiapkan/konversi dataset; menambah friksi awal | Jelaskan schema sederhana, sediakan contoh converter terpisah hanya setelah kebutuhan terbukti, dan rencanakan adapter subset Yomitan P1. Jangan menyatakan kompatibilitas penuh. |
| Lookup teks Jepang tanpa whitespace sulit menentukan batas kata | Popup dapat memilih kandidat terlalu panjang/pendek atau salah lemma | Gunakan longest viable prefix, tampilkan alternatif, beri batas kandidat; evaluasi dengan corpus nyata; jangan klaim parser tata bahasa penuh. |
| Deinflection rule-based menghasilkan ambiguitas | False positive dan definisi salah | Batasi rule dan kelas POS, prioritaskan exact match, tampilkan label bentuk/alternatif, uji rule dengan fixtures; gunakan parser eksternal hanya jika kebutuhan dan tradeoff privasinya diterima. |
| Kuota dan variasi storage browser | Import gagal atau database hilang karena kuota/eviction/browser behavior | Tampilkan ukuran dan error; gunakan staging/rollback; sediakan hapus dataset; uji recovery dan storage persistence. Jangan menjanjikan kapasitas tetap lintas browser. |
| MV3 service worker dapat dihentikan | Cache global atau operasi panjang hilang | Worker stateless dan cepat; state persisten di IndexedDB; progress operasi panjang disimpan/diteruskan secara eksplisit; gunakan offscreen hanya bila ada kebutuhan yang terukur. |
| Izin semua situs menimbulkan kekhawatiran privasi dan dapat menghambat persetujuan store | Pengguna tidak mengaktifkan scan | Minta optional host permission per situs melalui aksi yang dipahami; minimalkan izin; jelaskan bahwa teks diproses lokal. |
| Lisensi kode Yomitan, Hachidori, dan hoshidicts | Menyalin kode dapat mewajibkan atribusi dan distribusi source sesuai lisensi GPL | Gunakan referensi sebagai inspirasi perilaku/arsitektur dan implementasikan ulang. Jangan salin source, CSS, renderer, aset, atau transform rules tanpa review lisensi. Jika adaptasi kode dilakukan, evaluasi kewajiban GPL-3.0/GPL-3.0-or-later dan seluruh dependency sebelum distribusi. |
| Lisensi dataset terpisah dari lisensi kode proyek | File kamus/kanji dapat memiliki ketentuan atribusi, share-alike, atau non-redistribusi | Lacak lisensi pada metadata; tampilkan atribusi; review data per sumber. Ketentuan Yomitan/Hachidori tidak otomatis berlaku pada dataset pihak ketiga. |
| Dataset mengandung HTML/rich content berbahaya/tidak didukung | XSS atau tampilan rusak | Format MVP hanya string plain text; escape saat render; importer masa depan men-sanitize subset konten dan menolak markup tak didukung. |
| Perbedaan mesin browser dan OS | Posisi popup, IndexedDB, izin, dan performa berbeda | Nyatakan Chrome desktop sebagai target utama; gunakan test matrix; jangan mengiklankan browser lain sebelum ada uji. |

## 14. Keputusan Terbuka sebelum Implementasi

1. Dataset demo apa yang dapat disertakan secara legal, dengan definisi bahasa Indonesia atau Inggris, serta atribusi apa yang wajib ditampilkan?
2. Berapa ukuran file dan jumlah entri maksimum yang harus diterima pada perangkat QA minimum? Tetapkan setelah benchmark tahap 0.
3. Apakah Chrome Web Store menjadi saluran rilis pertama atau MVP hanya untuk instalasi developer/unpacked?
4. Apakah pencarian kana terhadap reading harus aktif pada MVP, atau cukup setelah exact expression selesai?
5. Format JSONL v1 dan kode POS mana yang dipakai sebagai standar Shirabe; perlu disepakati dengan dataset awal.

Keputusan ini tidak mengubah tujuan MVP, tetapi harus ditetapkan sebelum distribusi dataset dan pekerjaan importer dianggap selesai.

## 15. Sumber dan Status Verifikasi

Tanggal akses seluruh sumber: **16 Oktober 2026**.

### Repositori primer

- [Yomitan README](https://github.com/yomidevs/yomitan/blob/master/README.md) — tujuan, fitur utama, dukungan browser, cara build, dependency dan pernyataan lisensi GPL-3.0.
- [Yomitan manifest variants](https://github.com/yomidevs/yomitan/blob/master/dev/data/manifest-variants.json) — manifest MV3 untuk Chrome, service worker, content script, action/options, permission, host access, dan variasi browser.
- [Yomitan: Making Dictionaries](https://github.com/yomidevs/yomitan/blob/master/docs/making-yomitan-dictionaries.md) — `index.json`, term/kanji/meta/tag banks, penamaan file dan packaging ZIP.
- [Yomitan Japanese transforms](https://github.com/yomidevs/yomitan/blob/master/ext/js/language/ja/japanese-transforms.js) — contoh implementasi aturan infleksi Jepang dan tag kondisi. PRD hanya mengambil kebutuhan perilakunya, tidak menyalin kode.
- [Hachidori README](https://github.com/bee-san/hachidori/blob/main/README.md) — fitur personal dictionary, lookup blur, sharing, hoshidicts, atribusi renderer, dan GPL-3.0-or-later.
- [Hachidori architecture](https://github.com/bee-san/hachidori/blob/main/docs/architecture.md) — MV3, worker/offscreen, WASM, storage fallback, protokol lookup/import, dan transaksi data.
- [Hachidori browser performance](https://github.com/bee-san/hachidori/blob/main/docs/browser-performance.md) — metode/hasil benchmark yang dikelola proyek Hachidori; tidak dipakai sebagai janji performa Shirabe.
- [Hachidori privacy policy](https://github.com/bee-san/hachidori/blob/main/docs/privacy.md) — keterangan data lokal dan koneksi opsional dalam kebijakan proyek tersebut; bukan kebijakan privasi Shirabe.

### Batas verifikasi

- Repositori lokal Shirabe saat dokumen ini dibuat kosong; tidak ada implementasi, test, atau keputusan stack terdahulu yang dapat dibandingkan.
- Repositori referensi ditinjau melalui README, dokumentasi, dan file yang tersedia dari GitHub. Source tidak di-clone, tidak dibangun, dan tidak diuji pada browser di lingkungan kerja ini.
- Fitur dan struktur yang disebut eksplisit dalam dokumentasi primer ditandai sebagai temuan; arsitektur, prioritas, target angka, dan fitur Shirabe adalah rekomendasi PRD, bukan fakta repositori.
- Status dukungan browser, versi schema Yomitan, lisensi dataset, dan hasil benchmark dapat berubah; verifikasi ulang ke sumber asli sebelum implementasi atau distribusi.
