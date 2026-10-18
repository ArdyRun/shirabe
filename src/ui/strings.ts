/**
 * Teks antarmuka Shirabe (PRD 1: bahasa antarmuka awal Bahasa Indonesia).
 *
 * Semua teks UI melewati modul ini supaya pelokalan konsisten dan tidak ada
 * string yang tersebar di komponen. Istilah/definisi kamus tetap mengikuti dataset.
 */

import type { ErrorCode } from '../messaging/protocol.js';
import type { UiLanguage } from '../core/preferences.js';

type Messages = Record<string, string>;

const ID: Messages = {
  'app.name': 'Shirabe',
  'app.tagline': 'Kamus Jepang kontekstual dengan lookup lokal',

  'action.searchPlaceholder': 'Cari kata Jepang…',
  'action.search': 'Cari',
  'action.searchSelection': 'Cari teks terpilih',
  'action.openSettings': 'Pengaturan',
  'action.status': 'Status',
  'action.statusReady': 'Siap',
  'action.statusNoDictionary': 'Belum ada kamus aktif',
  'action.noDictionaryHint':
    'Lookup berjalan lokal dan memerlukan kamus. Impor dataset JSONL Shirabe dari halaman Pengaturan.',
  'action.importLink': 'Buka Pengaturan untuk impor kamus',
  'action.activeDictionaries': 'Kamus aktif: {count}',
  'action.entries': '{count} entri',
  'action.scanOn': 'Pemindaian aktif di situs ini',
  'action.scanOff': 'Pemindaian dimatikan di situs ini',
  'action.scanDisabledGlobally': 'Pemindaian semua situs sedang dimatikan di Pengaturan.',
  'action.enableSite': 'Aktifkan di situs ini',
  'action.disableSite': 'Matikan di situs ini',
  'action.unsupportedPage': 'Halaman ini tidak dapat dipindai (bukan http/https).',
  'action.selectionEmpty': 'Tidak ada teks terpilih di halaman.',
  'action.selectionFailed': 'Tidak dapat membaca teks terpilih dari halaman ini.',
  'action.hint':
    'Tahan {modifier} dan arahkan kursor ke kata Jepang, atau pilih teks lalu tekan "Cari teks terpilih".',
  'action.storage': 'Penyimpanan dipakai: {usage} dari {quota}',

  'results.empty': 'Tidak ada hasil untuk “{query}”.',
  'results.emptyHint': 'Periksa kamus aktif di Pengaturan, atau coba bentuk kamus kata tersebut.',
  'results.emptyQuery': 'Masukkan kata yang ingin dicari.',
  'results.truncated': 'Menampilkan {shown} hasil pertama; masih ada hasil lain.',
  'results.truncatedInput': 'Kueri lebih panjang dari batas 32 code point; hanya bagian awal yang dicari.',
  'results.close': 'Tutup',
  'results.source': 'Sumber',
  'results.readingUnavailable': 'bacaan tidak tersedia',
  'results.allDictionaries': 'Semua',
  'results.dictionaryTabs': 'Sumber kamus',
  'results.kanjiLookup': 'Cari kanji {kanji}',
  'results.kanji': 'Kanji',
  'results.pitch': 'aksen nada',
  'results.pitch.heiban': 'aksen datar (heiban)',
  'results.pitch.atamadaka': 'aksen kepala (atamadaka)',
  'results.pitch.nakadaka': 'aksen tengah (nakadaka)',
  'results.pitch.odaka': 'aksen ekor (odaka)',
  'results.pitchDevoice': 'mora {positions} tanpa suara',
  'results.pitchNasal': 'mora {positions} nasal',
  'results.frequency': 'frekuensi',
  'results.stat.strokes': 'goresan',
  'results.stat.grade': 'kelas',
  'results.stat.freq': 'frekuensi',
  'results.stat.jlpt': 'JLPT',
  'results.stat.jouyou': 'kanji umum',
  'results.stat.jinmeiyou': 'kanji nama',
  'results.resize': 'Tarik untuk mengubah ukuran popup',

  'results.inflectionWhy': 'Kenapa cocok: {surface} menjadi {lemma}',
  'results.inflectionSteps': 'Langkah pembentukan bentuk kamus',
  'inflect.desc.past':
    'Bentuk lampau/selesai (-た), melekat pada bentuk 連用形 verba atau かった pada adjektiva-i. Menyatakan tindakan yang sudah terjadi, selesai, atau pengandaian.',
  'inflect.desc.te':
    'Bentuk -て (bentuk sambung: 連用形 + て/くて). Merangkaikan klausa, permintaan, dan menjadi dasar pola majemuk seperti -ている dan -てください.',
  'inflect.desc.polite':
    'Bentuk sopan (-ます): menambahkan nuansa hormat kepada lawan bicara; bentuk lampaunya -ました.',
  'inflect.desc.polite-negative':
    'Bentuk sopan negatif (-ません, -ませんでした): peniadaan secara hormat, termasuk gabungannya dengan bentuk lampau.',
  'inflect.desc.negative':
    'Bentuk negatif (-ない, -なかった, -なくて, -ず): menyatakan tidak melakukan/menjadi atau belum terjadi.',
  'inflect.desc.conditional':
    'Bentuk pengandaian/syarat (-ば): “jika … maka …”; dibentuk dari vokal -e verba godan atau れば/ければ.',
  'inflect.desc.volitional':
    'Bentuk ajakan/rencana (-う, -よう): “mari …” atau maksud pembicara.',
  'inflect.desc.imperative':
    'Bentuk perintah (-ろ, -なさい): menyuruh lawan bicara melakukan sesuatu secara langsung.',
  'inflect.desc.copula':
    'Kopula だ/です: penanda predikat nominal atau adjektiva-na; です adalah ragam sopannya.',
  'inflect.desc.copula-past':
    'Kopula lampau だった/でした: menyatakan keadaan nominal/adjektiva-na pada masa lampau.',
  'inflect.desc.copula-negative':
    'Kopula negatif (ではない/じゃない, ではありません/じゃありません dan ragam lampaunya): meniadakan predikat nominal atau adjektiva-na.',
  'inflect.desc.compound-iru':
    'Verba bantu -いる setelah bentuk -て: tindakan yang sedang berlangsung atau keadaan yang berlanjut (mis. 読んでいる).',
  'inflect.desc.compound-kuru':
    'Verba bantu -くる setelah bentuk -て: tindakan yang mendekat ke pembicara atau perubahan yang berlangsung sampai sekarang (mis. 聞こえてくる).',
  'inflect.desc.compound-iku':
    'Verba bantu -いく setelah bentuk -て: tindakan atau perubahan yang menjauh dan berlanjut (mis. 変わっていく).',
  'inflect.desc.compound-shimau':
    'Verba bantu -しまう setelah bentuk -て: tindakan selesai tuntas, sering bernuansa penyesalan karena terlanjur terjadi.',
  'inflect.desc.compound-oku':
    'Verba bantu -おく setelah bentuk -て: tindakan yang dilakukan lebih dahulu sebagai persiapan.',
  'inflect.desc.compound-miru':
    'Verba bantu -みる setelah bentuk -て: mencoba melakukan sesuatu.',
  'inflect.desc.compound-aru':
    'Verba bantu -ある setelah bentuk -て: keadaan hasil dari tindakan yang sengaja dilakukan (mis. 書いてある).',

  'settings.title': 'Pengaturan Shirabe',
  'settings.tabDictionaries': 'Kamus',
  'settings.tabReading': 'Membaca',
  'settings.tabPrivacy': 'Privasi',
  'settings.tabAbout': 'Umum',
  'settings.language': 'Bahasa antarmuka',
  'settings.languageId': 'Bahasa Indonesia',
  'settings.languageEn': 'English',
  'settings.theme': 'Tema',
  'settings.theme.auto': 'Ikuti tema sistem',
  'settings.theme.groupAuto': 'Otomatis',
  'settings.theme.groupDark': 'Gelap',
  'settings.theme.groupLight': 'Terang',
  'settings.theme.groupContrast': 'Kontras tinggi',
  'settings.theme.shirabeDark': 'Shirabe (gelap)',
  'settings.theme.shirabeLight': 'Shirabe (terang)',
  'settings.theme.ereaderDark': 'Pembaca (gelap)',
  'settings.theme.ereaderLight': 'Pembaca (terang)',
  'settings.scanModifier': 'Tombol modifier scan',
  'settings.scanModifierHint':
    'Popup lookup muncul saat tombol ini ditahan dan kursor berada di atas teks Jepang.',
  'settings.popupWidth': 'Lebar popup (px)',
  'settings.popupMaxHeight': 'Tinggi maksimum popup (px)',
  'settings.popupHideDelay': 'Jeda penutupan popup (ms)',
  'settings.readingSearch': 'Cocokkan kueri kana ke bacaan',
  'settings.readingSearchHint':
    'Kueri hiragana/katakana dapat menemukan entri melalui field reading, bukan hanya expression.',
  'settings.maxResults': 'Hasil maksimum per kueri',
  'settings.sites': 'Situs yang dikecualikan',
  'settings.sitesHint':
    'Shirabe memindai semua situs http/https seperti Yomitan dan Hachidori. Origin pada daftar ini dimatikan pemindaiannya dan dapat diaktifkan kembali kapan saja. Halaman internal browser tidak pernah dipindai.',
  'settings.scanAllSites': 'Pindai semua situs',
  'settings.scanAllSitesLabel': 'Aktifkan pemindaian di semua situs http/https',
  'settings.scanAllSitesHint':
    'Matikan untuk menghentikan seluruh pemindaian tanpa menghapus kamus; daftar pengecualian per situs tetap tersimpan.',
  'settings.siteEnable': 'Aktifkan kembali',
  'settings.siteDisable': 'Matikan',
  'settings.siteEmpty': 'Tidak ada pengecualian: pemindaian aktif di semua situs.',
  'settings.saveFailed': 'Pengaturan gagal disimpan: {message}',

  'settings.dictionaries': 'Kamus terpasang',
  'settings.selectMode': 'Pilih kamus',
  'settings.selectRow': 'Pilih {name}',
  'settings.selectAll': 'Pilih semua',
  'settings.selectionCount': '{count} dipilih',
  'settings.bulkEnabled': '{count} kamus diaktifkan.',
  'settings.bulkDisabled': '{count} kamus dinonaktifkan.',
  'settings.bulkDeleted': '{count} kamus dihapus.',
  'settings.bulkDeleteConfirm':
    'Hapus {count} kamus terpilih ({names}) beserta seluruh datanya? Tindakan ini tidak dapat dibatalkan.',
  'settings.import': 'Impor dataset kamus',
  'settings.importHint':
    'Format yang diterima: (1) Shirabe JSONL v1/v2, satu baris header `shirabe-dictionary` (schemaVersion {schemaVersion}) lalu satu entry JSON per baris; (2) ZIP Yomitan format 3 (`index.json` + bank term/kanji/meta). Batas: {fileSize} per file, {entries} entry per kamus, {line} code point per baris.',
  'settings.importYomitanHint':
    'ZIP Yomitan (format 3) diterima langsung: bank term, bank kanji, dan bank meta (pitch accent/frekuensi) dikonversi saat impor, dan gambar yang direferensikan definisi disimpan. Yang diabaikan serta dilaporkan: kanji_meta_bank, tag_bank, custom CSS, audio, dan tautan `a` yang diratakan menjadi teks.',
  'settings.importProgress': 'Progres impor',
  'settings.importBatchProgress': 'Berkas {done} dari {total} · {running} berjalan',
  'settings.importFileRow': '{phase} · {percent}% · {lines} baris · {entries} entri',
  'settings.importFileQueued': 'Menunggu',
  'settings.importFileDone': 'Selesai',
  'settings.deleting': 'Menghapus kamus…',
  'settings.importPhaseReading': 'Membaca',
  'settings.importPhaseValidating': 'Memvalidasi',
  'settings.importPhaseWriting': 'Menyimpan',
  'settings.importPhaseCommitting': 'Menyelesaikan',
  'settings.importPhaseFailed': 'Gagal',
  'settings.importDone': 'Impor selesai: {name} ({count} entri).',
  'settings.importDoneFormat':
    'Impor {format} selesai: {name} — {count} entri dalam {duration} ({rate} entri/detik; baca+validasi {parseDuration}, tulis {writeDuration}).',
  'settings.importFormatZip': 'ZIP Yomitan',
  'settings.importFormatJsonl': 'JSONL',
  'settings.importIgnored': 'Komponen arsip yang diabaikan: {list}',
  'settings.importSkipped': '{count} entry dilewati (contoh: {example} — {reason}).',
  'settings.importSkippedUnknown': '{count} entry dilewati: {reason}.',
  'settings.importTruncatedDefinitions':
    '{count} entry dipotong daftar definisinya agar sesuai batas schema.',
  'settings.importUnsupported': 'Bagian konten yang tidak didukung: {list}.',
  'settings.importSkippedKanji': 'Baris kanji yang tidak sesuai schema Yomitan.',
  'settings.importSkippedMeta': 'Baris meta (pitch/frekuensi) yang tidak dikenali.',
  'settings.importAux':
    '{kanji} kanji, {meta} meta (pitch/frekuensi), {media} gambar ({size}) disimpan.',
  'settings.importMediaSkipped':
    '{count} berkas media dilewati (terlalu besar atau kuota kamus habis).',
  'settings.importKanjiOnly': 'Kamus ini tidak punya term bank: seluruh isinya kanji/meta.',
  'settings.dictionaryContents': '{entries} istilah, {kanji} kanji, {meta} meta, {media} gambar',
  'settings.aboutComponents':
    'Komponen aktif: halaman schema v{pageSchema} ({pageBuild}) · service worker {worker}',
  'settings.workerUnreachable': 'tidak merespons',
  'settings.staleComponents':
    'Extension belum seragam: halaman ini memakai schema v{page} sementara service worker masih v{worker}. Buka chrome://extensions, klik Reload pada Shirabe, lalu muat ulang tab ini sebelum mengimpor.',
  'settings.importFlattenedContent': 'definisi berstruktur diratakan menjadi teks',
  'settings.importFailed': 'Impor gagal: {reason}',
  'settings.importBatchDone': 'Impor selesai untuk {count} file.',
  'settings.importAborted': 'Impor dibatalkan; kamus yang sudah terpasang tidak berubah.',
  'settings.importCancel': 'Batalkan impor',
  'settings.importReplace': 'Ganti kamus yang sudah ada?',
  'settings.importReplaceBody':
    'Kamus "{name}" dengan {count} entri sudah terpasang dengan ID yang sama. Menggantinya akan menghapus data versi lama setelah impor baru berhasil.',
  'settings.importReplaceConfirm': 'Ganti kamus',
  'settings.importReplaceCancel': 'Batal',
  'settings.importEmptyFile': 'File tidak berisi entry.',
  'settings.importNoHeader': 'Baris pertama harus berupa header dataset Shirabe.',
  'settings.importInvalidLine': 'Baris {line} tidak valid: {reason}',
  'settings.importTooLarge': 'File melebihi batas {limit}.',
  'settings.importReadError': 'File tidak dapat dibaca: {message}',
  'settings.importFileCount': 'Impor {count} file (hingga 3 diproses bersamaan).',
  'settings.importsCleaned': '{count} impor yang tertinggal dibersihkan saat startup.',
  'settings.limitsTitle': 'Batas impor saat ini',
  'settings.empty': 'Belum ada kamus terpasang. Impor dataset JSONL untuk mulai mencari.',
  'settings.entryCount': '{count} entri',
  'settings.enabled': 'Aktif',
  'settings.disabled': 'Nonaktif',
  'settings.enable': 'Aktifkan',
  'settings.disable': 'Nonaktifkan',
  'settings.moveUp': 'Naikkan prioritas',
  'settings.moveDown': 'Turunkan prioritas',
  'settings.details': 'Detail',
  'settings.factEntries': '{count} istilah',
  'settings.factKanji': '{count} kanji',
  'settings.factMeta': '{count} meta',
  'settings.factMedia': '{count} gambar',
  'settings.metaStale': 'data pitch/frekuensi perlu impor ulang',
  'settings.dragHandle': 'Seret untuk mengubah urutan kamus',
  'settings.delete': 'Hapus',
  'settings.deleteConfirm':
    'Hapus kamus "{name}" beserta {count} entri dan {size} data? Tindakan ini tidak dapat dibatalkan.',
  'settings.deleteConfirmButton': 'Hapus kamus',
  'settings.cancel': 'Batal',
  'settings.deleted': 'Kamus "{name}" dihapus.',
  'settings.importedAt': 'Diimpor {date}',
  'settings.license': 'Lisensi: {value}',
  'settings.licenseUnknown': 'Lisensi tidak dicantumkan pada dataset',
  'settings.attribution': 'Atribusi: {value}',
  'settings.storage': 'Storage',
  'settings.storageUsage': '{usage} dipakai dari kuota {quota}',
  'settings.storageUnavailable': 'Perkiraan storage tidak tersedia di browser ini',
  'settings.storageClearHint': 'Bila kuota hampir penuh, hapus kamus yang tidak dipakai.',
  'settings.quotaExceeded': 'Kuota penyimpanan habis. Hapus kamus yang tidak dipakai lalu coba lagi.',

  'settings.privacyTitle': 'Data lokal',
  'settings.privacyBody':
    'Shirabe menyimpan kamus, preferensi, dan status situs di penyimpanan extension Anda. Kata yang dicari tidak dikirim ke server mana pun; teks halaman di sekitar kursor dibaca lokal untuk menentukan kata, tidak pernah dikirim ke service worker, dan tidak disimpan.',
  'settings.privacyNoHistory': 'MVP ini tidak menyimpan riwayat lookup, URL, atau isi halaman.',
  'settings.privacyPermissions':
    'Izin yang dipakai: storage (preferensi), contextMenus (menu "Cari dengan Shirabe"), dan akses host ke semua situs http/https agar pemindaian langsung bekerja seperti Yomitan/Hachidori. Tidak ada izin clipboard, cookie, atau koneksi server; pemindaian dapat dimatikan global maupun per situs dari halaman ini.',
  'settings.aboutVersion': 'Versi {version}',
  'settings.aboutSchema': 'Format dataset: Shirabe JSONL schema v{schemaVersion}',
  'settings.aboutReference':
    'Shirabe dikembangkan ulang sebagai implementasi mandiri dan tidak menyalin kode Yomitan atau Hachidori.',

  'search.title': 'Pencarian Shirabe',
  'search.placeholder': 'Cari kata Jepang…',
  'search.openSettings': 'Pengaturan',
  'search.results': 'Hasil',

  'error.INVALID_MESSAGE': 'Pesan tidak valid.',
  'error.UNKNOWN_TYPE': 'Permintaan tidak dikenal.',
  'error.INVALID_PAYLOAD': 'Data permintaan tidak valid.',
  'error.FORBIDDEN_SENDER': 'Permintaan ini tidak diizinkan dari konteks ini.',
  'error.NO_PERMISSION': 'Izin situs belum diberikan.',
  'error.NOT_FOUND': 'Data tidak ditemukan.',
  'error.CONFLICT': 'Ada operasi lain yang masih berjalan.',
  'error.IMPORT_FAILED': 'Impor gagal.',
  'error.STORAGE_QUOTA': 'Kuota penyimpanan extension habis.',
  'error.STORAGE_ERROR': 'Penyimpanan extension bermasalah.',
  'error.CONTEXT_INVALIDATED':
    'Extension baru saja dimuat ulang. Muat ulang halaman ini (F5) untuk mengaktifkan pemindaian kembali.',
  'error.INTERNAL': 'Terjadi kesalahan internal.',
};

const EN: Messages = {
  'app.name': 'Shirabe',
  'app.tagline': 'Contextual Japanese dictionary with local lookup',

  'action.searchPlaceholder': 'Search a Japanese word…',
  'action.search': 'Search',
  'action.searchSelection': 'Search selected text',
  'action.openSettings': 'Settings',
  'action.status': 'Status',
  'action.statusReady': 'Ready',
  'action.statusNoDictionary': 'No active dictionary',
  'action.noDictionaryHint':
    'Lookup runs locally and needs a dictionary. Import a Shirabe JSONL dataset from the Settings page.',
  'action.importLink': 'Open Settings to import a dictionary',
  'action.activeDictionaries': 'Active dictionaries: {count}',
  'action.entries': '{count} entries',
  'action.scanOn': 'Scanning is on for this site',
  'action.scanOff': 'Scanning is turned off for this site',
  'action.scanDisabledGlobally': 'Scanning on all sites is turned off in Settings.',
  'action.enableSite': 'Enable on this site',
  'action.disableSite': 'Turn off on this site',
  'action.unsupportedPage': 'This page cannot be scanned (not http/https).',
  'action.selectionEmpty': 'No text is selected on the page.',
  'action.selectionFailed': 'Could not read the selected text from this page.',
  'action.hint':
    'Hold {modifier} and hover a Japanese word, or select text and press "Search selected text".',
  'action.storage': 'Storage used: {usage} of {quota}',

  'results.empty': 'No results for “{query}”.',
  'results.emptyHint': 'Check active dictionaries in Settings, or try the dictionary form.',
  'results.emptyQuery': 'Type a word to search.',
  'results.truncated': 'Showing the first {shown} results; more are available.',
  'results.truncatedInput': 'The query is longer than the 32 code point limit; only its start was searched.',
  'results.close': 'Close',
  'results.source': 'Source',
  'results.readingUnavailable': 'reading unavailable',
  'results.allDictionaries': 'All',
  'results.dictionaryTabs': 'Dictionary sources',
  'results.kanjiLookup': 'Look up the kanji {kanji}',
  'results.kanji': 'Kanji',
  'results.pitch': 'pitch accent',
  'results.pitch.heiban': 'flat accent (heiban)',
  'results.pitch.atamadaka': 'head accent (atamadaka)',
  'results.pitch.nakadaka': 'middle accent (nakadaka)',
  'results.pitch.odaka': 'tail accent (odaka)',
  'results.pitchDevoice': 'mora {positions} devoiced',
  'results.pitchNasal': 'mora {positions} nasal',
  'results.frequency': 'frequency',
  'results.stat.strokes': 'strokes',
  'results.stat.grade': 'grade',
  'results.stat.freq': 'frequency',
  'results.stat.jlpt': 'JLPT',
  'results.stat.jouyou': 'jōyō kanji',
  'results.stat.jinmeiyou': 'jinmeiyō kanji',
  'results.resize': 'Drag to resize the popup',

  'results.inflectionWhy': 'Why this matched: {surface} became {lemma}',
  'results.inflectionSteps': 'Deinflection steps',
  'inflect.desc.past':
    'Past/perfective form (-た), attached to the 連用形 of verbs or かった for i-adjectives. Marks what already happened, a completed action, or a presupposition.',
  'inflect.desc.te':
    'Te-form (conjunctive 連用形 + て/くて). Links clauses and requests, and underpins compounds such as -ている and -てください.',
  'inflect.desc.polite':
    'Polite form (-ます): adds respect toward the listener; its past form is -ました.',
  'inflect.desc.polite-negative':
    'Polite negative form (-ません, -ませんでした): a polite negation, including its past combination.',
  'inflect.desc.negative':
    'Negative form (-ない, -なかった, -なくて, -ず): states that something does not or did not happen.',
  'inflect.desc.conditional':
    'Conditional form (-ば): “if … then …”; built from the -e vowel of godan verbs or れば/ければ.',
  'inflect.desc.volitional':
    'Volitional form (-う, -よう): “let us …” or an expression of the speaker’s intention.',
  'inflect.desc.imperative':
    'Imperative form (-ろ, -なさい): a direct command to the listener.',
  'inflect.desc.copula':
    'Copula だ/です: marks a nominal or na-adjective predicate; です is the polite variant.',
  'inflect.desc.copula-past':
    'Past copula だった/でした: states a nominal or na-adjective predicate in the past.',
  'inflect.desc.copula-negative':
    'Negative copula (ではない/じゃない, ではありません/じゃありません and their past forms): negates a nominal or na-adjective predicate.',
  'inflect.desc.compound-iru':
    'Auxiliary -いる after the te-form: an action in progress or an ongoing state (e.g. 読んでいる).',
  'inflect.desc.compound-kuru':
    'Auxiliary -くる after the te-form: an action approaching the speaker or a change continuing up to now (e.g. 聞こえてくる).',
  'inflect.desc.compound-iku':
    'Auxiliary -いく after the te-form: an action or change moving away and continuing (e.g. 変わっていく).',
  'inflect.desc.compound-shimau':
    'Auxiliary -しまう after the te-form: an action done completely, often with regret that it happened.',
  'inflect.desc.compound-oku':
    'Auxiliary -おく after the te-form: doing something beforehand as preparation.',
  'inflect.desc.compound-miru':
    'Auxiliary -みる after the te-form: trying something out.',
  'inflect.desc.compound-aru':
    'Auxiliary -aru after the te-form: a resulting state from a deliberate action (e.g. 書いてある).',

  'settings.title': 'Shirabe settings',
  'settings.tabDictionaries': 'Dictionaries',
  'settings.tabReading': 'Reading',
  'settings.tabPrivacy': 'Privacy',
  'settings.tabAbout': 'General',
  'settings.language': 'Interface language',
  'settings.languageId': 'Bahasa Indonesia',
  'settings.languageEn': 'English',
  'settings.theme': 'Theme',
  'settings.theme.auto': 'Follow system theme',
  'settings.theme.groupAuto': 'Automatic',
  'settings.theme.groupDark': 'Dark',
  'settings.theme.groupLight': 'Light',
  'settings.theme.groupContrast': 'High contrast',
  'settings.theme.shirabeDark': 'Shirabe (dark)',
  'settings.theme.shirabeLight': 'Shirabe (light)',
  'settings.theme.ereaderDark': 'E-reader (dark)',
  'settings.theme.ereaderLight': 'E-reader (light)',
  'settings.scanModifier': 'Scan modifier key',
  'settings.scanModifierHint':
    'The lookup popup appears while this key is held and the pointer is over Japanese text.',
  'settings.popupWidth': 'Popup width (px)',
  'settings.popupMaxHeight': 'Popup max height (px)',
  'settings.popupHideDelay': 'Popup close delay (ms)',
  'settings.readingSearch': 'Match kana queries against readings',
  'settings.readingSearchHint':
    'Hiragana/katakana queries can find entries through the reading field, not only the expression.',
  'settings.maxResults': 'Maximum results per query',
  'settings.sites': 'Excluded sites',
  'settings.sitesHint':
    'Shirabe scans all http/https sites like Yomitan and Hachidori. Origins in this list have scanning turned off and can be re-enabled at any time. Browser internal pages are never scanned.',
  'settings.scanAllSites': 'Scan all sites',
  'settings.scanAllSitesLabel': 'Enable scanning on all http/https sites',
  'settings.scanAllSitesHint':
    'Turn this off to stop all scanning without deleting dictionaries; per-site exceptions are kept.',
  'settings.siteEnable': 'Re-enable',
  'settings.siteDisable': 'Turn off',
  'settings.siteEmpty': 'No exceptions: scanning is active on all sites.',
  'settings.saveFailed': 'Settings could not be saved: {message}',

  'settings.dictionaries': 'Installed dictionaries',
  'settings.selectMode': 'Select dictionaries',
  'settings.selectRow': 'Select {name}',
  'settings.selectAll': 'Select all',
  'settings.selectionCount': '{count} selected',
  'settings.bulkEnabled': '{count} dictionaries enabled.',
  'settings.bulkDisabled': '{count} dictionaries disabled.',
  'settings.bulkDeleted': '{count} dictionaries deleted.',
  'settings.bulkDeleteConfirm':
    'Delete {count} selected dictionaries ({names}) and all their data? This cannot be undone.',
  'settings.import': 'Import a dictionary dataset',
  'settings.importHint':
    'Accepted formats: (1) Shirabe JSONL v1/v2, one `shirabe-dictionary` header line (schemaVersion {schemaVersion}) followed by one JSON entry per line; (2) Yomitan ZIP format 3 (`index.json` plus term/kanji/meta banks). Limits: {fileSize} per file, {entries} entries per dictionary, {line} code points per line.',
  'settings.importYomitanHint':
    'Yomitan ZIP dictionaries (format 3) are imported directly: term, kanji, and meta banks (pitch accent/frequency) are converted during import, and images referenced by definitions are stored. Ignored and reported: kanji_meta_bank, tag_bank, custom CSS, audio, and `a` links flattened to text.',
  'settings.importProgress': 'Import progress',
  'settings.importBatchProgress': 'File {done} of {total} · {running} running',
  'settings.importFileRow': '{phase} · {percent}% · {lines} lines · {entries} entries',
  'settings.importFileQueued': 'Waiting',
  'settings.importFileDone': 'Finished',
  'settings.deleting': 'Deleting dictionary…',
  'settings.importPhaseReading': 'Reading',
  'settings.importPhaseValidating': 'Validating',
  'settings.importPhaseWriting': 'Writing',
  'settings.importPhaseCommitting': 'Committing',
  'settings.importPhaseFailed': 'Failed',
  'settings.importDone': 'Import finished: {name} ({count} entries).',
  'settings.importDoneFormat':
    'Import {format} finished: {name} — {count} entries in {duration} ({rate} entries/s; read+validate {parseDuration}, write {writeDuration}).',
  'settings.importFormatZip': 'Yomitan ZIP',
  'settings.importFormatJsonl': 'JSONL',
  'settings.importIgnored': 'Ignored archive components: {list}',
  'settings.importSkipped': '{count} entries skipped (example: {example} — {reason}).',
  'settings.importSkippedUnknown': '{count} entries skipped: {reason}.',
  'settings.importTruncatedDefinitions':
    '{count} entries had their definition list truncated to fit the schema limit.',
  'settings.importUnsupported': 'Unsupported content parts: {list}.',
  'settings.importSkippedKanji': 'Kanji row that does not match the Yomitan schema.',
  'settings.importSkippedMeta': 'Meta (pitch/frequency) row that is not recognized.',
  'settings.importAux':
    '{kanji} kanji, {meta} meta (pitch/frequency), {media} images ({size}) stored.',
  'settings.importMediaSkipped':
    '{count} media files skipped (too large, or the dictionary quota is full).',
  'settings.importKanjiOnly': 'This dictionary has no term bank: all of its content is kanji/meta.',
  'settings.dictionaryContents': '{entries} terms, {kanji} kanji, {meta} meta, {media} images',
  'settings.aboutComponents':
    'Active components: page schema v{pageSchema} ({pageBuild}) · service worker {worker}',
  'settings.workerUnreachable': 'not responding',
  'settings.staleComponents':
    'Extension components are out of sync: this page uses schema v{page} while the service worker is still v{worker}. Open chrome://extensions, click Reload on Shirabe, then reload this tab before importing.',
  'settings.importFlattenedContent': 'structured definitions flattened to text',
  'settings.importFailed': 'Import failed: {reason}',
  'settings.importBatchDone': 'Import finished for {count} files.',
  'settings.importAborted': 'Import cancelled; installed dictionaries are unchanged.',
  'settings.importCancel': 'Cancel import',
  'settings.importReplace': 'Replace the existing dictionary?',
  'settings.importReplaceBody':
    'A dictionary named "{name}" with {count} entries already uses this ID. Replacing it deletes the old version after the new import succeeds.',
  'settings.importReplaceConfirm': 'Replace dictionary',
  'settings.importReplaceCancel': 'Cancel',
  'settings.importEmptyFile': 'The file contains no entry.',
  'settings.importNoHeader': 'The first line must be a Shirabe dataset header.',
  'settings.importInvalidLine': 'Line {line} is invalid: {reason}',
  'settings.importTooLarge': 'The file exceeds the {limit} limit.',
  'settings.importReadError': 'The file could not be read: {message}',
  'settings.importFileCount': 'Importing {count} files (up to 3 at a time).',
  'settings.importsCleaned': '{count} leftover imports were cleaned at startup.',
  'settings.limitsTitle': 'Current import limits',
  'settings.empty': 'No dictionary installed yet. Import a JSONL dataset to start searching.',
  'settings.entryCount': '{count} entries',
  'settings.enabled': 'Enabled',
  'settings.disabled': 'Disabled',
  'settings.enable': 'Enable',
  'settings.disable': 'Disable',
  'settings.moveUp': 'Move up',
  'settings.moveDown': 'Move down',
  'settings.details': 'Details',
  'settings.factEntries': '{count} terms',
  'settings.factKanji': '{count} kanji',
  'settings.factMeta': '{count} meta',
  'settings.factMedia': '{count} images',
  'settings.metaStale': 'pitch/frequency data needs a re-import',
  'settings.dragHandle': 'Drag to change dictionary order',
  'settings.delete': 'Delete',
  'settings.deleteConfirm':
    'Delete "{name}" with {count} entries and {size} of data? This cannot be undone.',
  'settings.deleteConfirmButton': 'Delete dictionary',
  'settings.cancel': 'Cancel',
  'settings.deleted': 'Dictionary "{name}" deleted.',
  'settings.importedAt': 'Imported {date}',
  'settings.license': 'License: {value}',
  'settings.licenseUnknown': 'The dataset does not declare a license',
  'settings.attribution': 'Attribution: {value}',
  'settings.storage': 'Storage',
  'settings.storageUsage': '{usage} used of {quota} quota',
  'settings.storageUnavailable': 'Storage estimates are unavailable in this browser',
  'settings.storageClearHint': 'If the quota is nearly full, delete dictionaries you do not use.',
  'settings.quotaExceeded': 'Storage quota exceeded. Delete unused dictionaries and try again.',

  'settings.privacyTitle': 'Local data',
  'settings.privacyBody':
    'Shirabe stores dictionaries, preferences, and site state in your extension storage. Lookup queries are never sent to a server; page text around the cursor is read locally to pick the word, never sent to the service worker, and never stored.',
  'settings.privacyNoHistory': 'This MVP stores no lookup history, URL, or page content.',
  'settings.privacyPermissions':
    'Permissions used: storage (preferences), contextMenus (the "Cari dengan Shirabe" item), and host access to all http/https sites so scanning works immediately like Yomitan/Hachidori. No clipboard, cookie, or server permissions; scanning can be turned off globally or per site on this page.',
  'settings.aboutVersion': 'Version {version}',
  'settings.aboutSchema': 'Dataset format: Shirabe JSONL schema v{schemaVersion}',
  'settings.aboutReference':
    'Shirabe is an independent implementation and does not copy code from Yomitan or Hachidori.',

  'search.title': 'Shirabe search',
  'search.placeholder': 'Search a Japanese word…',
  'search.openSettings': 'Settings',
  'search.results': 'Results',

  'error.INVALID_MESSAGE': 'The message is not valid.',
  'error.UNKNOWN_TYPE': 'Unknown request.',
  'error.INVALID_PAYLOAD': 'The request payload is not valid.',
  'error.FORBIDDEN_SENDER': 'This request is not allowed from this context.',
  'error.NO_PERMISSION': 'Host permission has not been granted.',
  'error.NOT_FOUND': 'Data not found.',
  'error.CONFLICT': 'Another operation is still running.',
  'error.IMPORT_FAILED': 'The import failed.',
  'error.STORAGE_QUOTA': 'The extension storage quota is full.',
  'error.STORAGE_ERROR': 'Extension storage is unavailable.',
  'error.CONTEXT_INVALIDATED':
    'The extension was reloaded. Reload this page (F5) to re-enable scanning.',
  'error.INTERNAL': 'An internal error occurred.',
};

const CATALOGS: Record<UiLanguage, Messages> = { id: ID, en: EN };

let currentLanguage: UiLanguage = 'id';

export function setLanguage(language: UiLanguage): void {
  currentLanguage = language;
}

export function getLanguage(): UiLanguage {
  return currentLanguage;
}

/** Terjemahan dengan penggantian parameter `{nama}`, fallback ke Bahasa Indonesia lalu key. */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = CATALOGS[currentLanguage][key] ?? ID[key] ?? key;
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function errorMessage(code: ErrorCode, fallback: string): string {
  const key = `error.${code}`;
  const translated = CATALOGS[currentLanguage][key] ?? ID[key];
  if (translated !== undefined) {
    // Kesalahan internal tidak punya teks tetap yang informatif: sertakan pesan aslinya
    // supaya penyebabnya dapat dilaporkan, bukan sekadar "terjadi kesalahan internal".
    if (code === 'INTERNAL' && fallback.length > 0) {
      return `${translated} (${fallback})`;
    }
    return translated;
  }
  return fallback;
}
