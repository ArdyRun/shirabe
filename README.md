# Shirabe

Ekstensi Chrome (Manifest V3) untuk membaca bahasa Jepang: tahan modifier dan arahkan
kursor ke kata di halaman web, lalu lihat bentuk kamus, bacaan, definisi, kelas kata,
— semuanya dari kamus lokal, tanpa mengirim teks ke jaringan.

Spesifikasi produk ada di [`PRD.md`](PRD.md). Status implementasi MVP, asumsi, dan
keterbatasan yang tersisa ada di [`docs/mvp-audit.md`](docs/mvp-audit.md).

## Kemampuan MVP

- **Lookup kontekstual:** tahan `Alt` (dapat diubah) dan hover kata Jepang; popup muncul
  dekat kata dengan bacaan, definisi, kelas kata, dan cuplikan kalimat lokal (maksimum
  160 code point, dikumpulkan lintas text node dalam blok yang sama, tidak pernah dikirim
  ke service worker atau disimpan). Selama `Alt` ditahan, popup transparan terhadap
  pointer sehingga menyapu kursor tidak pernah terhalang popup itu sendiri; lepaskan
  `Alt` untuk membaca/mengklik hasil.
  Popup ditempatkan mengikuti aturan Yomitan: selalu 10 px di kanan karakter di bawah
  kursor; default di bawah baris, berpindah ke atas hanya bila ruang di bawah lebih
  sempit; tingginya dipangkas agar tidak pernah keluar viewport.
- **Tahan-baca di berbagai struktur halaman:** kata yang terbelah ke beberapa elemen
  inline (mis. `<span>食べ</span><span>ました</span>`), teks di dalam **open Shadow DOM**
  (komponen web), dan teks di **iframe http/https** juga dipindai.
- **Teks terpilih:** pilih teks lalu gunakan **Cari teks terpilih** di action popup atau
  item menu konteks **Cari dengan Shirabe**.
- **Pencarian manual:** dari action popup dan halaman pencarian, termasuk pencarian kana
  terhadap bacaan.
- **Deinflection terbatas:** aturan berbasis data untuk bentuk sopan, lampau, negatif,
  te, progresif, kondisional, volisional verba godan/ichidan/suru/kuru dan adjektiva-i
  (mis. 食べました → 食べる, 書いて → 書く, 高くない → 高い, します → する, 来た → 来る).
  Setiap hasil membawa label bentuk; sistem tidak mengklaim melakukan parsing kalimat.
- **Pengelolaan kamus:** impor JSONL bertahap dengan staging/rollback, aktivasi,
  pengurutan prioritas, penghapusan, dan ringkasan storage. Daftar kamus menampilkan satu
  baris ringkas per kamus (judul, status, ringkasan isi) dengan aksi **aktif/nonaktif**,
  **↑/↓**, dan **Hapus** langsung di barisnya; urutan juga dapat diubah dengan menyeret
  baris. Tombol **Detail** hanya membuka metadata (lisensi, atribusi, tanggal impor).
  Checkbox **Pilih kamus** menyalakan mode pilih: checkbox per baris plus bilah aksi massal
  (**Pilih semua**, **Aktifkan**, **Nonaktifkan**, **Hapus**) dengan jumlah terpilih.
  Progres impor dihitung dari byte yang terbaca dan entry yang sudah tersimpan (bukan
  persentase tetap per fase), ditampilkan bersama fase (Membaca / Memvalidasi / Menyimpan),
  persentase, dan jumlah baris serta entri. Kamus kanji/frekuensi yang hanya berisi satu
  bank besar (JPDB: 48 MB, 515.000 baris) tetap bergerak mengikuti tiap potongan penulisan;
  penghapusan kamus menampilkan status sibuk pada barisnya selama data dihapus.
- **Kamus Yomitan lebih dari istilah:** bank kanji (`kanji_bank_*.json`), bank meta
  (`term_meta_bank_*.json` → pitch accent digambar sebagai **graf kontur** seperti
  Yomitan/Hachidori, frekuensi sebagai chip), dan gambar kamus yang direferensikan
  definisi (store `media`, dirender dari data URL kamus sendiri, tanpa permintaan
  jaringan). Klik kanji pada headword popup menampilkan bacaan, arti, dan statistik dari
  kamus kanji yang terpasang.
- **Aktif di semua situs:** seperti Yomitan/Hachidori, pemindaian langsung bekerja di
  semua halaman http/https setelah extension dipasang. Pengguna dapat mematikannya
  global atau per situs (daftar pengecualian) dari Pengaturan atau action popup.
- **Pengaturan:** bahasa antarmuka (Indonesia/English), tema terang/gelap/sistem,
  modifier scan, ukuran dan jeda popup, batas hasil, daftar situs, dan catatan privasi.

## Persyaratan

- Node.js 22+ (proyek dikembangkan dan diuji pada Node 26).
- Chromium/Chrome desktop versi stabil untuk memasang hasil build.

## Menjalankan

```bash
npm install
npm run build          # build halaman + content script, lalu validasi manifest MV3
npm run dev            # build ulang otomatis saat berkas berubah (watch)
npm test               # 321 unit/integration test (Vitest, tanpa browser)
npm run typecheck      # pemeriksaan TypeScript
npm run e2e            # pengujian integration di Chromium asli (Playwright)
npm run bench          # benchmark impor/lookup/hover pada Chromium asli
npm run icons          # regenerasi ikon (opsional)
npm run dataset:verify   # impor dataset (JSONL/ZIP) ke Chromium asli + lookup pemeriksaan
npm run verify:stale     # regresi: halaman yang belum dimuat ulang setelah extension di-reload
```

### Memasang di Chrome (developer mode)

1. `npm run build` (atau `npm run dev` untuk build ulang otomatis saat berkas berubah)
2. Buka `chrome://extensions`, aktifkan **Developer mode**.
3. **Load unpacked** → pilih direktori `dist/`.
4. Buka action popup Shirabe → **Pengaturan** → **Impor dataset JSONL**.
5. Buka situs berbahasa Jepang, tahan `Alt` dan arahkan kursor ke kata Jepang. Tidak ada
   langkah aktivasi per situs: pemindaian aktif di semua situs http/https.
   Menahan `Alt` tanpa menggerakkan kursor juga memicu lookup (posisi kursor terakhir).

#### Mengambil perubahan setelah build

Build hanya menulis ulang berkas di `dist/`; Chrome tidak memuatnya sendiri. Yang perlu
dilakukan **cukup klik Reload (⟳) pada kartu Shirabe** di `chrome://extensions` — tombol
**Update** di bilah atas halaman itu memuat ulang semua extension unpacked sekaligus.
Menghapus lalu menambahkan ulang extension tidak diperlukan.

**Kamus yang diimpor sebelum versi ini perlu diimpor ulang** (atau dihapus lalu diimpor
lagi) untuk mengisi data yang baru didukung: gambar kamus, bank kanji, dan bank meta
(pitch/frekuensi). Impor versi lama membuang berkas-berkas itu, dan data tersebut tidak
bisa direkonstruksi dari entry yang sudah tersimpan. Impor ulang kamus dengan ID yang sama
akan menggantikan versi lamanya, jadi tidak ada duplikat.

**Skema penyimpanan v4 (meta sebagai record pack).** Sejak v4 nilai pitch/frekuensi
disimpan sebagai record pack (satu record memuat banyak item, ditulis ±8× lebih cepat:
478.044 baris dari ±66 s menjadi ±4 s; lihat `docs/mvp-audit.md` §4.26). Upgrade menghapus
store `meta` lama, sehingga kamus pitch/frekuensi yang sudah terpasang kehilangan datanya
dan ditandai **"data pitch/frekuensi perlu impor ulang"** di daftar kamus sampai diimpor
ulang. Kamus istilah (JSONL/ZIP dengan term bank) tidak terpengaruh.

| Yang berubah | Klik Reload extension | Muat ulang tab (F5) |
|---|---|---|
| `content.js` (pemindaian, popup) | perlu | perlu untuk tab yang sudah terbuka |
| `background.js` (service worker) | perlu | — |
| `settings.html`/`action.html`/`search.html` | perlu | tab halaman itu sendiri perlu dimuat ulang |
| Restart browser (profil sama) | tidak perlu | — |

Halaman yang belum dimuat ulang setelah extension di-reload tidak lagi menampilkan
"kesalahan internal": popup menjelaskan bahwa extension baru dimuat ulang dan meminta
halaman dimuat ulang (F5), lalu berhenti memindai.

Extension tidak menyertakan kamus. Dataset dibeli/dibuat pengguna sendiri, atau gunakan
`tests/fixtures/demo-mini.jsonl` sebagai contoh kecil untuk mencoba alur impor
(data uji, bukan kamus lengkap). Untuk jalur Yomitan, `tests/fixtures/yomitan-demo.zip`
(bank term) dan `tests/fixtures/yomitan-media-meta.zip` (bank term + bank kanji + bank
meta pitch/frekuensi + satu berkas gambar) adalah arsip uji kecil.

## Sistem visual

Desain mengikuti prinsip tata letak popup Yomitan/Hachidori: padat, terstruktur, dan
seluruh definisi langsung terbaca.

- **Katalog tema** (`src/core/themes.ts`, adaptasi sistem tema Hachidori/GSM): 47 pilihan
  dalam grup Otomatis / Gelap / Terang / Kontras tinggi. Dua tema milik Shirabe
  (`shirabe-dark` charcoal + aksen lavender, dan `shirabe-light`) adalah tampilan asli
  proyek ini dan menjadi sasaran pilihan `dark`/`light` maupun tema `auto` (ikut sistem);
  pasangan **`ereader-light`/`ereader-dark`** adalah tema hitam putih gaya pembaca e-ink:
  tanpa hue sama sekali (kertas, tinta, dan tangga keabuan untuk kelas kata/status) dan
  teks bacaan (kepala entri, bacaan, glosarium, kueri header) memakai huruf serif lewat
  token `--font-reading`, sementara tab/tombol/status tetap sans. Paletnya sengaja
  memakai tinta pekat (#000 di atas #fff) supaya token teks samar 56% tetap lolos WCAG AA
  (4.83:1); sisanya katalog palet daisyUI 5 yang sama dengan aplikasi referensi
  (Hachidori, Miku, Catppuccin Mocha, Dracula, Autumn, …). Pilihan tema ada di
  Pengaturan → Umum.
- **Token desain** (`src/styles/tokens.css`): palet mentah (`--pal-*`), token semantik yang
  diturunkan sekali dari palet dengan `color-mix` (`--bg`, `--fg`, `--muted`, `--border`,
  `--accent`, `--hl-bg`, …), lalu jarak (`--s1`…`--s6`, skala 2/4/6/8/12/16 px), radius
  (`--r-xs`…`--r-lg`), dan ukuran huruf per peran (`--fs-headword`, `--fs-gloss`, …)
  serta `--font-reading` (font teks bacaan; tema pembaca menimpanya dengan serif).
  Dengan begitu satu blok turunan melayani semua tema — tidak ada satu blok CSS per tema.
  **Popup dalam halaman menyimpang sengaja dari nilai itu** (`src/content/popup.css`):
  seluruh radiusnya 0 (sudut siku) dan elevasinya tepi keras `4px 4px 0` tanpa blur,
  karena popup melayang di atas halaman situs mana pun dan tidak berbagi permukaan
  dengan halaman extension. Entri terpilih ditandai garis aksen penuh + latar
  `--accent-soft`, bukan batang aksen di tepi kiri seperti di halaman extension.
- **Penerapan tema** (`src/ui/theme.ts`): palet terpilih dipasang sebagai variabel inline
  pada elemen target (`html` untuk halaman extension, `.panel` untuk popup dalam halaman),
  sehingga popup dalam shadow DOM tertutup tetap mengikuti tema yang sama. Palet punya
  nilai bawaan di CSS, jadi tampilan sudah benar sebelum JavaScript berjalan; atribut
  `data-theme-pending` menahan tampilan sampai preferensi terbaca supaya tidak berkedip.
  Sorotan kata di halaman memakai aksen palet (primary 34%, 56% pada tema kontras tinggi).
  **Blok token wajib memakai selektor `:root, [data-theme]`** (bukan `:root` saja):
  `:root` tidak cocok di dalam shadow DOM popup, jadi tanpa selektor atribut panel popup
  kehilangan seluruh token (latar transparan, warna teks ikut halaman). Invarian ini diuji
  di `tests/ui/tokens.test.ts` dan lewat gaya terhitung panel di e2e; lihat audit §4.20.
- **Skala huruf & ukuran mengikuti Hachidori:** kosakata utama 32px (furigana ±15px),
  definisi 16px/1.5, judul kartu kamus 13px (nama asli, bukan kapital semua), tag 12px,
  tab kamus 13px/600 dengan tinggi 34px (padding 6px 12px, elipsis 150px + `title`), dan
  lebar popup 560px (tinggi tetap mengikuti isi).
- **Tag prioritas/frekuensi tidak ditampilkan:** kamus gaya JMdict/Jitendex menandai kata
  umum dengan tag berkelas *popular* (`⭐`) atau *frequent* (`ichi`, `spec`, `gai`,
  `news1k`…`news24k`, `nf01`…`nf48`). Tag itu bukan kelas kata maupun keterangan pemakaian,
  jadi tidak ikut ke baris sense (data tetap utuh di storage) — sama seperti popup acuan.
  Kelas kata dan tag pemakaian tetap tampil inline, mis. `[v5r, vt, arch]`.
- **Isi kartu = data kamus + keterangan bentuk dari rule:** headword, bacaan (furigana),
  kelas kata, tag, dan definisi. Bila bentuk di halaman berinfleksi, kartu menambah satu
  disclosure tertutup yang menjelaskan rantai pembentukan bentuk kamus (`聞こえてきた →
  聞こえる` dengan langkah `-た`, `-くる`, `-て`); keterangan itu berasal dari tabel rule
  Shirabe, bukan tebakan UI (lihat bagian "Rantai pembentukan bentuk kamus").
- **Kata yang dipindai tidak diulang di header:** baris paling atas popup memuat
  **strip tab sumber kamus** (dapat digulir mendatar dengan roda mouse bila kamus aktifnya
  banyak), status singkat, dan tombol tutup. Headword yang dipindai disorot di halaman,
  dan bentuk kamusnya tampil di kartu entri.
- **Bacaan diganti kontur nada bila ada kamus pitch:** mora bacaan digambar sebagai kana
  dengan garis di atas (nada tinggi) atau di bawah (nada rendah), disambung garis tegak di
  tempat nada naik/turun, plus penanda turun setelah kata untuk aksen ekor (odaka). Tanpa
  kamus pitch, bacaan ditampilkan apa adanya. Kategori aksen (heiban/atamadaka/nakadaka/
  odaka), posisi downstep, dan kamus asalnya ada di tooltip.
- **Frekuensi tampil di barisnya sendiri** di bawah headword, satu chip per kamus berisi
  nama kamus dan nilainya (`Jiten|200`), karena nilainya berbeda antar kamus.
- **Tata letak popup mengikuti design system `jl-*` Hachidori/GSM:** header dengan strip
  tab sumber kamus, lalu area gulir berisi **daftar entri datar** (tanpa panel per kamus).
  Setiap kartu memakai pola `jl-top`: headword 32px (dengan tombol per kanji), bacaan
  (atau kontur nadanya), dan label kamus; definisinya satu blok glosarium dengan sense
  bernomor, metadata inline (`[v5n, vi]`), dan bullet `•` per sinonim. Pegangan ubah ukuran
  ada di sudut kanan bawah.
  Rincian adaptasi (dan bagian acuan yang tidak diadopsi: audio, Anki, blur definisi)
  ada di `docs/mvp-audit.md` §4.21.
- **Tanpa blok kalimat sumber:** popup hanya memuat header kosakata dan kartu entri kamus;
  kalimat di halaman tidak ditampilkan di popup (kata yang dipindai disorot langsung di
  halaman). Catatan deviasi PRD ada di `docs/mvp-audit.md` §4.14.
- **Kueri yang ditampilkan = segmen kursor:** teks yang dikirim ke service worker boleh
  lebar (kandidat tetap lengkap), tetapi pesan "tidak ada hasil" memakai
  segmen kelas karakter di sekitar kursor — `陸上部だったので髪型は…` dengan kursor di
  `だった` menampilkan `だったので`, bukan satu kalimat (padanan `scanLength` Hachidori,
  lihat `docs/mvp-audit.md` §4.16).
- **Batas kandidat mengikuti kelas karakter:** kandidat lookup dibatasi pada batas
  kanji/kana/katakana, sehingga kata di tengah kalimat tanpa spasi
  (`陸上部だったので髪型はベリィショート` → `だった`) tetap ditemukan tanpa parser morfologi.
  Setiap titik awal menyumbang jendela pendek, jendela berbatas kelas, dan jendela
  terpanjang secara bergilir — dan **seluruh** kecocokan dilaporkan, terpanjang dahulu
  (hover `がな` di `俺がなんでそんなことを、` menampilkan entri `がな` maupun `なんで`).
  Lihat `docs/mvp-audit.md` §4.15 dan §4.17.
- **Kata yang sedang di-lookup disorot di halaman** selama popup terbuka (pola Hachidori).
  Sorotan memakai CSS Custom Highlight API (`::highlight(shirabe-match)`), jadi tidak ada
  elemen/kelas yang ditambahkan ke DOM halaman; rentangnya hidup sehingga sorotan mengikuti
  teks saat halaman digulir atau di-zoom, dan warnanya mengikuti tema popup.
- **Panel definisi per kamus** (`src/ui/results.ts`): satu panel dengan label sumber
  kamus, berisi kartu entri.
- **Satu kartu per kata per kamus:** kamus seperti JMdict memecah satu kata menjadi
  beberapa baris (satu baris per **sense**) dengan `expression` + bacaan sama. Baris-baris
  itu digabung menjadi **satu kotak**:
  - lebih dari satu sense → daftar bernomor 1, 2, 3, … dan definisi tiap sense berada di
    dalam nomornya (sinonim ditulis satu baris per definisi, tanpa nomor sendiri);
  - satu sense saja → definisinya ditulis langsung tanpa nomor;
  - kelas kata/tag ditulis sekali di atas (gabungan tanpa duplikat), dan tag yang hanya
    berisi angka (penanda nomor sense dari dataset) tidak lagi tampil sebagai chip karena
    nomor sudah diberikan oleh daftar sense.

  Hasilnya sama seperti tampilan Hachidori/Yomitan: 傾ける (4 baris sense) menjadi satu
  kotak dengan sense 1–4, bukan empat kotak terpisah.
- **Tab sumber kamus** (`src/ui/results-panel.ts`): muncul bila hasil memuat lebih dari
  satu kamus — `Semua`, lalu satu tab per kamus berisi jumlah entri. Tab hanya menyaring
  hasil yang sudah ada; pencarian dan data tidak berubah.
- **Konteks kalimat** berada di atas hasil: panel dengan garis aksen kiri dan sorotan
  (mark) pada kata yang dicari, terpisah jelas dari panel kamus.
- **Status interaktif:** hover, focus-visible, terpilih (garis aksen + latar lebih
  terang), aktif, disabled, serta scrollbar tipis yang seragam di seluruh permukaan.

## Format dataset (Shirabe JSONL)

Satu baris header, lalu satu objek JSON per baris. UTF-8, data (bukan HTML: markup
ditolak), normalisasi pencarian NFC. Dua versi didukung: **v1** (definisi hanya teks)
dan **v2** (definisi boleh berisi *structured content* yang tervalidasi).

```jsonl
{"type":"shirabe-dictionary","schemaVersion":1,"id":"contoh-ja-id","name":"Kamus Contoh","language":"ja","definitionLanguage":"id","license":"Isi lisensi dataset","attribution":"Nama penerbit/sumber dataset"}
{"expression":"食べる","reading":"たべる","definitions":["makan"],"partOfSpeech":["v1"],"tags":[],"rules":["v1"]}
{"expression":"学生","reading":"がくせい","definitions":["pelajar; mahasiswa"],"partOfSpeech":["n"],"tags":[],"rules":[]}
```

Header v2 memakai `"schemaVersion":2`; item `definitions` boleh berupa string **atau**
simpul `{tag, content, style, lang, data}` (bentuk yang sama dengan structured content
Yomitan). Contoh tabel bentuk kata:

```jsonl
{"expression":"俺","reading":"おれ","definitions":["I","me",{"tag":"table","content":[{"tag":"tr","content":[{"tag":"th","content":"俺","style":{"textAlign":"center"}},{"tag":"th","content":"己","style":{"textAlign":"center"}}]},{"tag":"tr","content":[{"tag":"td","content":"★"},{"tag":"td","content":"🅁"}]}]}]}
```

| Field | Wajib | Keterangan |
|---|---|---|
| `expression` | ya | String non-kosong; bentuk yang dicari. |
| `reading` | tidak | Bacaan kana; kosong bila sumber tidak menyediakan. |
| `definitions` | ya | Array non-kosong: string (v1/v2) atau simpul structured content (v2). Urutan dipertahankan. |
| `partOfSpeech` | tidak | Tag kelas kata sumber. |
| `tags` | tidak | Tag tambahan, ditampilkan sebagai chip. |
| `rules` | tidak | Tag aturan untuk mencocokkan deinflection (mis. `v1`, `v5k`, `adj-i`). |
| `schemaVersion` | ya | `1` atau `2`; versi lain ditolak dengan pesan yang jelas. |

**Tag yang didukung di structured content (v2):** `table`, `tr`, `th`, `td`, `thead`,
`tbody`, `tfoot`, `caption`, `ul`, `ol`, `li`, `div`, `span`, `p`, `br`, `ruby`, `rt`,
`rp`, `b`, `strong`, `i`, `em`, `u`, `s`, `small`, `sub`, `sup`, `mark`, `code`,
`details`, `summary`, dan `img` (gambar kamus).

**Gambar (`img`):** atribut yang didukung `path` (wajib, jalur relatif di dalam kamus),
`width`/`height` (bilangan 0–64 atau `auto`), `sizeUnits` (`px`/`em`/`rem`/`%`/`pt`),
`appearance` (`auto`/`monochrome`), `pixelated`, `verticalAlign`, `alt`, dan `title`.
`src` tidak pernah datang dari dataset: popup meminta byte-nya ke store `media` kamus yang
sama (data URL, tanpa permintaan jaringan), dan jalur yang memuat skema, `..`, atau `?`
ditolak. `appearance: monochrome` diinversi pada tema gelap supaya gambar giyou mengikuti
warna teks.

**Gaya yang didukung:** `textAlign`, `verticalAlign`, `fontWeight`, `fontStyle`, dan
`listStyleType` (kata kunci CSS atau penanda pendek dalam kutipan, mis. `"'📝 '"`).
Properti lain ditolak. `a` tidak didukung: konverter Yomitan meratakannya menjadi teks
lalu melaporkannya di ringkasan impor — rujukan silang sebagai tautan belum ada.
Media lain (audio, video, `iframe`) dan tag interaktif dibuang bersama isinya. Batas
tambahan untuk v2: 256 simpul per definisi, 12 tingkat sarang, 2.000 code point per
potongan teks.

Batas impor: 128 MB per file, 1.000.000 entry per kamus, 64 KiB per baris, 64 definisi
dan 64 tag per entry, 100.000 kanji per kamus, 2.000.000 nilai meta per kamus, serta
2 MB per berkas media dan 64 MB total media per kamus. Batas ini ditampilkan pada dialog
impor, dan baris yang tidak valid dilaporkan dengan nomornya; impor yang gagal dibatalkan
tanpa mengubah kamus aktif.

## Impor kamus Yomitan (ZIP) langsung

Shirabe menerima **ZIP Yomitan format 3 langsung** dari halaman Pengaturan (tidak perlu
konversi terpisah): `index.json` dibaca untuk metadata/lisensi, lalu bank isinya diubah
menjadi data Shirabe saat impor. Arsip yang hanya memuat bank kanji atau bank meta
(kamus KANJIDIC, kamus pitch accent, kamus frekuensi) juga diterima, karena kamus
seperti itu memang tidak punya term bank.

| Didukung | Diabaikan (dilaporkan setelah impor) |
|---|---|
| `index.json` (judul, revisi, penulis, sumber, atribusi) | `kanji_meta_bank_*`, `tag_bank_*`, `styles.css`, audio, ZIP64, arsip terenkripsi/terkompresi selain stored+deflate |
| `term_bank_*.json` v3 → `expression`, `reading`, `glossary` (→ `definitions`), `definitionTags` (→ `partOfSpeech`/`tags`), `rules`, dan `score` (→ prioritas ranking) | Tautan `a` (diratakan menjadi teks), tag di luar daftar putih |
| `kanji_bank_*.json` v3 → karakter, onyomi, kunyomi, tag, arti, dan statistik; tampil sebagai blok kanji saat kanji headword diklik | Berkas media yang tidak direferensikan definisi mana pun |
| `term_meta_bank_*.json` → `pitch` (posisi downstep per bacaan) dan `freq` (nilai + bentuk tampil). Pitch digambar sebagai graf kontur (titik tinggi/rendah per mora, penanda downstep, segitiga partikel) dengan posisi `[n]` dan kategori aksen (heiban/atamadaka/nakadaka/odaka) di tooltip | |
| Structured content: tabel, daftar catatan/rujukan (penanda `📝`/`➡️`), ruby, penekanan, dan `img` → simpul schema v2 yang tervalidasi | |

Gambar hanya disimpan bila benar-benar direferensikan definisi, dibatasi 2 MB per berkas
dan 64 MB per kamus; berkas yang dilewati dilaporkan sebagai hitungan. Karena kamus
kanji/pitch/frekuensi tidak punya istilah, daftar kamus menampilkan ringkasan isinya
(istilah, kanji, meta, gambar) supaya kamus yang berhasil diimpor tidak terlihat kosong.

Entry yang tidak lolos validasi schema (mis. definisi mengandung markup HTML) dilewati
dan dilaporkan beserta contoh + alasannya. Arsip rusak ditolak tanpa mengubah kamus yang
sudah terpasang. Ini tetap adapter subset: Shirabe tidak mengklaim kompatibilitas penuh
dengan ekosistem Yomitan (audio, Anki, dan template kamus belum ada).

### Jika popup masih memakai tampilan lama

Popup dirender oleh **content script di dalam tab**, bukan oleh service worker. Extension
yang di-load unpacked tidak menyuntikkan ulang content script ke tab yang sudah terbuka,
jadi setelah `npm run build` + Reload di `chrome://extensions`, **tekan F5 pada tab halaman**
agar kode popup ikut diperbarui. Contoh gejala: popup masih menampilkan blok kalimat sumber
yang sudah dihapus (`docs/mvp-audit.md` §4.14).

Cara memastikan kode yang berjalan: Pengaturan → tab **Umum** → baris **Komponen aktif**
harus menampilkan schema dan build yang sama untuk halaman dan service worker.

### Jika impor ditolak dengan "versi schema tidak didukung"

Pesan seperti `Header dataset tidak valid: versi schema 2 tidak didukung; versi yang
didukung: 1` berarti **service worker masih kode lama**, bukan berkas Anda yang salah:
service worker memvalidasi header impor, dan browser dapat menyimpan skrip service worker
lama untuk extension unpacked (`Service Worker/ScriptCache` pada profil browser).

1. Buka halaman Pengaturan → tab **Umum** dan baca **Komponen aktif**. Halaman dan service
   worker harus menampilkan **schema dan build yang sama** (mis.
   `halaman schema v2 (2026-10-17T04:05:35Z) · service worker schema v2 · 2026-10-17T04:05:35Z`).
2. Bila berbeda: `chrome://extensions` (di Helium: `helium://extensions`) → kartu **Shirabe**
   → **Reload**, lalu tutup dan buka kembali tab Pengaturan.
3. Bila tetap berbeda: **hapus** extension lalu **Load unpacked** ulang ke
   `/home/nexsal/perkuliahan/skripsi/shirabe/dist` (instalasi baru memaksa cache service
   worker dibuat dari nol), atau mulai ulang browser.
4. Setelah seragam, impor ulang. Untuk fitur tabel, berkas harus diimpor ulang (strukturnya
   baru dibawa saat konversi/impor).

Mengukur kecepatan impor di browser nyata:

```bash
npm run build
node scripts/verify-dataset.mjs ~/Downloads/JMdict_english.zip --expect '食べました=食べる'
```

## Struktur proyek

```text
src/
  core/            search core murni (tanpa DOM/Chrome): teks, aturan deinflection,
                   kandidat, ranking, validasi JSONL, preferensi, helper situs
  data/            IndexedDB: skema, entries, pengelolaan kamus, siklus impor staging
  background/      service worker: router pesan, izin situs, preferensi, context menu
  content/         content script: scan kata, cuplikan konteks, popup Shadow DOM
  action/          action popup (pencarian manual, teks terpilih, status, izin situs)
  search/          halaman pencarian
  settings/        halaman pengaturan + alur impor streaming
  ui/              renderer kartu entri bersama, tema, i18n, helper DOM
  messaging/       protokol pesan berversi + validasinya
scripts/           build validation, e2e Playwright, benchmark, generator ikon,
                   konverter Yomitan→Shirabe JSONL, verifikasi dataset
tests/             unit/integration Vitest + fixture dataset
```

## Arsitektur singkat

- **Service worker stateless.** Tidak ada state penting di memori global; koneksi
  IndexedDB dibuka kembali saat dibutuhkan.
- **Content script tanpa dataset.** Ia hanya mengirim kueri (dan posisi kursor) ke
  service worker, lalu menampilkan popup di dalam Shadow DOM tertutup.
- **Staging impor.** Setiap impor menulis versi dataset baru; commit hanya memindahkan
  `activeVersion` pada metadata kamus, dan versi lama dihapus setelah commit. Impor yang
  gagal atau proses yang terputus tidak pernah terlihat sebagai kamus aktif, dan
  dibersihkan saat startup.
- **Privasi.** Lookup berjalan lokal di IndexedDB; tidak ada analytics, tidak ada server
  kamus, dan cuplikan kalimat tidak pernah meninggalkan halaman.

## Perilaku popup (ringkas)

| Peristiwa | Perilaku |
|---|---|
| `Alt` ditahan + kursor di atas kata | Popup muncul di dekat kata (debounce 90 ms) |
| `Alt` ditahan tanpa menggerakkan kursor | Popup muncul untuk kata pada posisi kursor terakhir |
| Kursor menyapu kata lain | Popup diperbarui; saat modifier ditahan popup tidak menghalangi hit-test |
| Kursor keluar dari kata/popup | Popup ditutup setelah jeda `popupHideDelayMs` (default 250 ms) |
| `Alt` dilepas | Popup tetap tampil dan kembali interaktif (dapat digulir/diklik) |
| Kursor di atas kata/elemen yang terbelah inline | Kandidat disatukan dari text node tetangga dalam satu blok |
| Kursor di teks dalam web component (open Shadow DOM) | Dipindai melalui `caretPositionFromPoint({shadowRoots})` |
| Kursor di teks dalam iframe http/https | Dipindai (content script statis `all_frames`); popup muncul di dalam frame itu |
| `Esc` | Tutup popup |
| Panah naik/turun | Telusuri kartu entri (kartu terpilih ditandai garis aksen) |
| Klik/panah kiri-kanan pada tab | Ganti sumber kamus yang ditampilkan |
| Klik kanji pada headword | Tampilkan blok kanji dari kamus kanji yang terpasang (bacaan, arti, statistik) sekaligus mencari kanji itu sebagai kata tersendiri |
| Tarik sudut kanan bawah | Ubah lebar popup (tersimpan sebagai pengaturan lebar) |
| Scroll/resize | Popup direposisi, pilihan kartu tidak direset |
| Menekan tombol di halaman | Popup ditutup |
| Situs dikecualikan / pemindaian global mati | Content script berhenti tanpa reload |

## Rantai pembentukan bentuk kamus

Saat kata di halaman berinfleksi (mis. `聞こえてきた`), kartu entri menampilkan disclosure
tertutup di bawah headword yang menjelaskan bagaimana bentuk itu kembali ke bentuk kamus:

```text
聞こえてきた → 聞こえる        (klik untuk membuka)
  1. -た     Bentuk lampau/selesai (-た), melekat pada bentuk 連用形 verba atau かった …
  2. -くる   Verba bantu -くる setelah bentuk -て: tindakan yang mendekat ke pembicara …
  3. -て     Bentuk -て (bentuk sambung: 連用形 + て/くて) …
```

- Disclosure **tertutup secara bawaan** dan hanya muncul bila lookup benar-benar memakai
  deinflection (bentuk permukaan berbeda dari bentuk kamus); maksimum 31 langkah, sisanya
  ditandai `…` (pola Hachidori).
- Nama langkah (`-た`, `-て`, `-くる`, `-ます`, …) dan urutannya berasal dari tabel rule
  Shirabe (`src/core/rules.ts`) — bukan tebakan UI (PRD 4.4), jadi hanya transformasi yang
  benar-benar diterapkan yang tampil.
- Transformasi dapat **dirantai**: kondisi keluar satu rule menjadi syarat rule berikutnya
  (mirip `conditionsIn`/`conditionsOut` deinflector hoshidicts/Yomitan). Kedalaman maksimum
  4 langkah, jumlah analisis per kandidat dibatasi 128.
- Deskripsi tiap langkah dilokalkan (`id`/`en`) di `src/ui/strings.ts` dengan kunci
  `inflect.desc.<family>`; transformasi majemuk yang didukung: `-いる`, `-くる`, `-いく`,
  `-しまう`, `-おく`, `-みる`, `-ある`.
- Batas yang diketahui: rantai deinflection mandiri dari kamus Yomitan
  (definisi berisi `[bentukDasar, [namaRule, …]]`) belum dipakai; importer memakai `rules`
  per definisi sebagai tag validasi kelas kata. Lihat `docs/mvp-audit.md` §4.18.

## Catatan legal

Repositori ini tidak menyalin kode atau teks Yomitan, Hachidori, maupun hoshidicts;
keduanya dipakai hanya sebagai referensi perilaku/arsitektur. Nama transformasi
(`-た`, `-て`, `-くる`, …) dan daftar rule mengikuti model konjugasi Jepang umum yang juga
dipakai proyek-proyek tersebut, sedangkan seluruh teks deskripsi ditulis untuk Shirabe
(bukan salinan literals berlisensi GPL dari Yomitan/hoshidicts). Nilai palet tema diambil
dari katalog palet daisyUI 5 (MIT) yang sama dengan yang dipakai Hachidori/GSM, dan
disebutkan sebagai sumber katalog. Lisensi proyek belum ditetapkan (perlu
keputusan produk sebelum distribusi), dan lisensi dataset adalah tanggung jawab pengguna
yang mengimpor. Lihat `docs/mvp-audit.md` untuk daftar dependency dan lisensinya.
