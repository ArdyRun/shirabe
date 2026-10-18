/**
 * Katalog tema Shirabe (adaptasi sistem tema Hachidori/GSM, PRD 3.1 & 5.4).
 *
 * Struktur mengikuti referensi: satu daftar palet, tiap palet berisi `base-100/200/300`,
 * `base-content`, dan warna aksen/status beserta warna teks di atasnya; tiap tema
 * menyatakan skema (`light`/`dark`) supaya `color-scheme` dan pemilihan tema "auto"
 * tepat. Palet katalog diambil dari katalog tema yang sama dengan Hachidori
 * (daisyUI 5, sumber GSM PR #549) sehingga warna tetap konsisten dengan aplikasi
 * referensi; palet asli proyek ini adalah `shirabe-dark`/`shirabe-light` (sasaran tema
 * `auto`) dan pasangan monokrom `ereader-light`/`ereader-dark` (gaya pembaca e-ink).
 *
 * Modul ini murni data + fungsi tanpa DOM; penerapan ke CSS ada di `src/ui/theme.ts`
 * (variabel `--pal-*`), sedangkan turunan token semantik (`--bg`, `--fg`, `--accent`, …)
 * ada di `src/styles/tokens.css`.
 */

/** Nama tema "auto": mengikuti tema sistem. */
export const AUTO_THEME_ID = 'auto';

/** Tema yang dipakai saat preferensi `auto` (mengikuti `prefers-color-scheme`). */
export const AUTO_THEME_IDS: Readonly<Record<ThemeScheme, string>> = {
  light: 'shirabe-light',
  dark: 'shirabe-dark',
};

/**
 * Preferensi tema awal: palet gelap Shirabe (tema yang dipoles proyek ini). Pilihan
 * `auto` (ikut sistem) dan seluruh tema katalog tetap tersedia di pengaturan.
 */
export const DEFAULT_THEME_PREFERENCE: string = 'dark';

/** Skema warna sebuah palet. */
export type ThemeScheme = 'light' | 'dark';

/** Palet satu tema; nilainya valid untuk CSS (hex atau oklch). */
export interface ThemePalette {
  scheme: ThemeScheme;
  base100: string;
  base200: string;
  base300: string;
  /** Warna teks utama di atas base-100. */
  content: string;
  primary: string;
  primaryContent: string;
  secondary: string;
  secondaryContent: string;
  accent: string;
  accentContent: string;
  neutral: string;
  neutralContent: string;
  info: string;
  infoContent: string;
  success: string;
  warning: string;
  error: string;
}

/** Grup tema pada pemilih pengaturan. */
export type ThemeGroupId = 'auto' | 'dark' | 'light' | 'contrast';

export interface ThemeGroup {
  id: ThemeGroupId;
  labelKey: string;
}

export const THEME_GROUPS: readonly ThemeGroup[] = [
  { id: 'auto', labelKey: 'settings.theme.groupAuto' },
  { id: 'dark', labelKey: 'settings.theme.groupDark' },
  { id: 'light', labelKey: 'settings.theme.groupLight' },
  { id: 'contrast', labelKey: 'settings.theme.groupContrast' },
];

/**
 * Satu pilihan tema. `label` = nama dari katalog (nama diri, tidak diterjemahkan);
 * `labelKey` = kunci teks UI untuk tema milik Shirabe sendiri. Tema `auto` tidak punya
 * palet karena paletnya baru ditentukan saat skema sistem diketahui.
 */
export interface ThemeOption {
  id: string;
  label?: string;
  labelKey?: string;
  group: ThemeGroupId;
  palette?: ThemePalette;
}

/** Pemetaan kunci palet ke nama variabel CSS yang dipasang `src/ui/theme.ts`. */
export const PALETTE_VARIABLES: readonly (readonly [keyof ThemePalette, string])[] = [
  ['scheme', '--pal-scheme'],
  ['base100', '--pal-base-100'],
  ['base200', '--pal-base-200'],
  ['base300', '--pal-base-300'],
  ['content', '--pal-content'],
  ['primary', '--pal-primary'],
  ['primaryContent', '--pal-primary-content'],
  ['secondary', '--pal-secondary'],
  ['secondaryContent', '--pal-secondary-content'],
  ['accent', '--pal-accent'],
  ['accentContent', '--pal-accent-content'],
  ['neutral', '--pal-neutral'],
  ['neutralContent', '--pal-neutral-content'],
  ['info', '--pal-info'],
  ['infoContent', '--pal-info-content'],
  ['success', '--pal-success'],
  ['warning', '--pal-warning'],
  ['error', '--pal-error'],
];

/** Seluruh pilihan tema: `auto` di depan, lalu palet katalog per grup. */
export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: AUTO_THEME_ID, labelKey: 'settings.theme.auto', group: 'auto' },
  {
    id: 'shirabe-dark',
    labelKey: 'settings.theme.shirabeDark',
    group: 'dark',
    palette: {
      scheme: 'dark',
      base100: '#16171c',
      base200: '#212228',
      base300: '#2b2c34',
      content: '#edeef4',
      primary: '#a89ce4',
      primaryContent: '#16121f',
      secondary: '#7f8fd8',
      secondaryContent: '#101322',
      accent: '#84a99e',
      accentContent: '#14231f',
      neutral: '#2b2c34',
      neutralContent: '#edeef4',
      info: '#8db0cb',
      infoContent: '#0f1c24',
      success: '#7fb08d',
      warning: '#c9a068',
      error: '#cf878b',
    },
  },
  /* Palet "pembaca" (hitam putih): tanpa hue supaya tampilan mengikuti kertas dan tinta
     e-ink, dan pasangan terang/gelapnya bisa dipilih pengguna. Teks bacaan memakai serif
     lewat selektor `[data-theme-name]` di `src/styles/tokens.css`. */
  {
    id: 'ereader-dark',
    labelKey: 'settings.theme.ereaderDark',
    group: 'dark',
    palette: {
      scheme: 'dark',
      base100: '#111111',
      base200: '#1c1c1c',
      base300: '#2a2a2a',
      content: '#ececec',
      primary: '#ececec',
      primaryContent: '#111111',
      secondary: '#c4c4c4',
      secondaryContent: '#111111',
      accent: '#d6d6d6',
      accentContent: '#111111',
      neutral: '#2a2a2a',
      neutralContent: '#ececec',
      /* Status tetap monokrom, dibedakan lewat tingkat keabuan; teksnya tetap membawa
         arti (mis. "Siap" vs pesan gagal), jadi warna bukan satu-satunya penanda. */
      info: '#cfcfcf',
      infoContent: '#111111',
      success: '#dcdcdc',
      warning: '#b3b3b3',
      error: '#ffffff',
    },
  },
  {
    id: 'default',
    label: 'Hachidori (default)',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: '#272630', base200: '#302f3b', base300: '#3b3b49',
      content: '#e8e5eb', primary: '#a89ce4', primaryContent: '#211d30', secondary: '#af8fa7',
      secondaryContent: '#271d25', accent: '#84a99e', accentContent: '#14231f',
      neutral: '#3a3946', neutralContent: '#dfdbe4', info: '#86a6be', infoContent: '#14202a',
      success: '#7fa58d', warning: '#c29a65', error: '#c67d80',
    },
  },
  {
    id: 'miku',
    label: 'Miku',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: '#1c2529', base200: '#233034', base300: '#2e3d43',
      content: '#e6f4f2', primary: '#39c5bb', primaryContent: '#062421', secondary: '#e56aa0',
      secondaryContent: '#2a0d1b', accent: '#5ce0d6', accentContent: '#052421',
      neutral: '#2e3d43', neutralContent: '#e6f4f2', info: '#4fb8d8', infoContent: '#04171e',
      success: '#5fc98d', warning: '#e0b23c', error: '#e5695f',
    },
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: '#181825', base200: '#1e1e2e', base300: '#313244',
      content: '#cdd6f4', primary: '#89b4fa', primaryContent: '#11111b', secondary: '#cba6f7',
      secondaryContent: '#11111b', accent: '#94e2d5', accentContent: '#11111b',
      neutral: '#313244', neutralContent: '#cdd6f4', info: '#89dceb', infoContent: '#11111b',
      success: '#a6e3a1', warning: '#f9e2af', error: '#f38ba8',
    },
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: '#002b36', base200: '#073642', base300: '#0a4a5a',
      content: '#93a1a1', primary: '#268bd2', primaryContent: '#002b36', secondary: '#2aa198',
      secondaryContent: '#002b36', accent: '#859900', accentContent: '#002b36',
      neutral: '#073642', neutralContent: '#93a1a1', info: '#268bd2', infoContent: '#002b36',
      success: '#859900', warning: '#b58900', error: '#dc322f',
    },
  },
  {
    id: 'dark',
    label: 'Dark',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(25.33% 0.016 252.42)',
      base200: 'oklch(23.26% 0.014 253.1)', base300: 'oklch(21.15% 0.012 254.09)',
      content: 'oklch(97.807% 0.029 256.847)', primary: 'oklch(58% 0.233 277.117)',
      primaryContent: 'oklch(96% 0.018 272.314)', secondary: 'oklch(65% 0.241 354.308)',
      secondaryContent: 'oklch(94% 0.028 342.258)', accent: 'oklch(77% 0.152 181.912)',
      accentContent: 'oklch(38% 0.063 188.416)', neutral: 'oklch(14% 0.005 285.823)',
      neutralContent: 'oklch(92% 0.004 286.32)', info: 'oklch(74% 0.16 232.661)',
      infoContent: 'oklch(29% 0.066 243.157)', success: 'oklch(76% 0.177 163.223)',
      warning: 'oklch(82% 0.189 84.429)', error: 'oklch(71% 0.194 13.428)',
    },
  },
  {
    id: 'synthwave',
    label: 'Synthwave',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(15% 0.09 281.288)', base200: 'oklch(20% 0.09 281.288)',
      base300: 'oklch(25% 0.09 281.288)', content: 'oklch(78% 0.115 274.713)',
      primary: 'oklch(71% 0.202 349.761)', primaryContent: 'oklch(28% 0.109 3.907)',
      secondary: 'oklch(82% 0.111 230.318)', secondaryContent: 'oklch(29% 0.066 243.157)',
      accent: 'oklch(75% 0.183 55.934)', accentContent: 'oklch(26% 0.079 36.259)',
      neutral: 'oklch(45% 0.24 277.023)', neutralContent: 'oklch(87% 0.065 274.039)',
      info: 'oklch(74% 0.16 232.661)', infoContent: 'oklch(29% 0.066 243.157)',
      success: 'oklch(77% 0.152 181.912)', warning: 'oklch(90% 0.182 98.111)',
      error: 'oklch(73.7% 0.121 32.639)',
    },
  },
  {
    id: 'halloween',
    label: 'Halloween',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(21% 0.006 56.043)', base200: 'oklch(14% 0.004 49.25)',
      base300: 'oklch(0% 0 0)', content: 'oklch(84.955% 0 0)',
      primary: 'oklch(77.48% 0.204 60.62)', primaryContent: 'oklch(19.693% 0.004 196.779)',
      secondary: 'oklch(45.98% 0.248 305.03)', secondaryContent: 'oklch(89.196% 0.049 305.03)',
      accent: 'oklch(64.8% 0.223 136.073)', accentContent: 'oklch(0% 0 0)',
      neutral: 'oklch(24.371% 0.046 65.681)', neutralContent: 'oklch(84.874% 0.009 65.681)',
      info: 'oklch(54.615% 0.215 262.88)', infoContent: 'oklch(90.923% 0.043 262.88)',
      success: 'oklch(62.705% 0.169 149.213)', warning: 'oklch(66.584% 0.157 58.318)',
      error: 'oklch(65.72% 0.199 27.33)',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(20.84% 0.008 17.911)',
      base200: 'oklch(18.522% 0.007 17.911)', base300: 'oklch(16.203% 0.007 17.911)',
      content: 'oklch(83.768% 0.001 17.911)', primary: 'oklch(68.628% 0.185 148.958)',
      primaryContent: 'oklch(0% 0 0)', secondary: 'oklch(69.776% 0.135 168.327)',
      secondaryContent: 'oklch(13.955% 0.027 168.327)', accent: 'oklch(70.628% 0.119 185.713)',
      accentContent: 'oklch(14.125% 0.023 185.713)', neutral: 'oklch(30.698% 0.039 171.364)',
      neutralContent: 'oklch(86.139% 0.007 171.364)', info: 'oklch(72.06% 0.191 231.6)',
      infoContent: 'oklch(0% 0 0)', success: 'oklch(64.8% 0.15 160)',
      warning: 'oklch(84.71% 0.199 83.87)', error: 'oklch(71.76% 0.221 22.18)',
    },
  },
  {
    id: 'aqua',
    label: 'Aqua',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(37% 0.146 265.522)', base200: 'oklch(28% 0.091 267.935)',
      base300: 'oklch(22% 0.091 267.935)', content: 'oklch(90% 0.058 230.902)',
      primary: 'oklch(85.661% 0.144 198.645)', primaryContent: 'oklch(40.124% 0.068 197.603)',
      secondary: 'oklch(60.682% 0.108 309.782)', secondaryContent: 'oklch(96% 0.016 293.756)',
      accent: 'oklch(93.426% 0.102 94.555)', accentContent: 'oklch(18.685% 0.02 94.555)',
      neutral: 'oklch(27% 0.146 265.522)', neutralContent: 'oklch(80% 0.146 265.522)',
      info: 'oklch(54.615% 0.215 262.88)', infoContent: 'oklch(90.923% 0.043 262.88)',
      success: 'oklch(62.705% 0.169 149.213)', warning: 'oklch(66.584% 0.157 58.318)',
      error: 'oklch(73.95% 0.19 27.33)',
    },
  },
  {
    id: 'black',
    label: 'Black',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(0% 0 0)', base200: 'oklch(19% 0 0)',
      base300: 'oklch(22% 0 0)', content: 'oklch(87.609% 0 0)', primary: 'oklch(35% 0 0)',
      primaryContent: 'oklch(100% 0 0)', secondary: 'oklch(35% 0 0)',
      secondaryContent: 'oklch(100% 0 0)', accent: 'oklch(35% 0 0)',
      accentContent: 'oklch(100% 0 0)', neutral: 'oklch(35% 0 0)',
      neutralContent: 'oklch(100% 0 0)', info: 'oklch(45.201% 0.313 264.052)',
      infoContent: 'oklch(89.04% 0.062 264.052)', success: 'oklch(51.975% 0.176 142.495)',
      warning: 'oklch(96.798% 0.211 109.769)', error: 'oklch(62.795% 0.257 29.233)',
    },
  },
  {
    id: 'luxury',
    label: 'Luxury',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(14.076% 0.004 285.822)',
      base200: 'oklch(20.219% 0.004 308.229)', base300: 'oklch(23.219% 0.004 308.229)',
      content: 'oklch(75.687% 0.123 76.89)', primary: 'oklch(100% 0 0)',
      primaryContent: 'oklch(20% 0 0)', secondary: 'oklch(27.581% 0.064 261.069)',
      secondaryContent: 'oklch(85.516% 0.012 261.069)', accent: 'oklch(36.674% 0.051 338.825)',
      accentContent: 'oklch(87.334% 0.01 338.825)', neutral: 'oklch(24.27% 0.057 59.825)',
      neutralContent: 'oklch(93.203% 0.089 90.861)', info: 'oklch(79.061% 0.121 237.133)',
      infoContent: 'oklch(15.812% 0.024 237.133)', success: 'oklch(78.119% 0.192 132.154)',
      warning: 'oklch(86.127% 0.136 102.891)', error: 'oklch(71.753% 0.176 22.568)',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(28.822% 0.022 277.508)',
      base200: 'oklch(26.805% 0.02 277.508)', base300: 'oklch(24.787% 0.019 277.508)',
      content: 'oklch(97.747% 0.007 106.545)', primary: 'oklch(75.461% 0.183 346.812)',
      primaryContent: 'oklch(15.092% 0.036 346.812)',
      secondary: 'oklch(74.202% 0.148 301.883)',
      secondaryContent: 'oklch(14.84% 0.029 301.883)', accent: 'oklch(83.392% 0.124 66.558)',
      accentContent: 'oklch(16.678% 0.024 66.558)', neutral: 'oklch(39.445% 0.032 275.524)',
      neutralContent: 'oklch(87.889% 0.006 275.524)', info: 'oklch(88.263% 0.093 212.846)',
      infoContent: 'oklch(17.652% 0.018 212.846)', success: 'oklch(87.099% 0.219 148.024)',
      warning: 'oklch(95.533% 0.134 112.757)', error: 'oklch(68.22% 0.206 24.43)',
    },
  },
  {
    id: 'business',
    label: 'Business',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(24.353% 0 0)', base200: 'oklch(22.648% 0 0)',
      base300: 'oklch(20.944% 0 0)', content: 'oklch(84.87% 0 0)',
      primary: 'oklch(41.703% 0.099 251.473)', primaryContent: 'oklch(88.34% 0.019 251.473)',
      secondary: 'oklch(64.092% 0.027 229.389)',
      secondaryContent: 'oklch(12.818% 0.005 229.389)', accent: 'oklch(67.271% 0.167 35.791)',
      accentContent: 'oklch(13.454% 0.033 35.791)', neutral: 'oklch(27.441% 0.013 253.041)',
      neutralContent: 'oklch(85.488% 0.002 253.041)', info: 'oklch(62.616% 0.143 240.033)',
      infoContent: 'oklch(12.523% 0.028 240.033)', success: 'oklch(70.226% 0.094 156.596)',
      warning: 'oklch(77.482% 0.115 81.519)', error: 'oklch(51.61% 0.146 29.674)',
    },
  },
  {
    id: 'night',
    label: 'Night',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(20.768% 0.039 265.754)',
      base200: 'oklch(19.314% 0.037 265.754)', base300: 'oklch(17.86% 0.034 265.754)',
      content: 'oklch(84.153% 0.007 265.754)', primary: 'oklch(75.351% 0.138 232.661)',
      primaryContent: 'oklch(15.07% 0.027 232.661)', secondary: 'oklch(68.011% 0.158 276.934)',
      secondaryContent: 'oklch(13.602% 0.031 276.934)', accent: 'oklch(72.36% 0.176 350.048)',
      accentContent: 'oklch(14.472% 0.035 350.048)', neutral: 'oklch(27.949% 0.036 260.03)',
      neutralContent: 'oklch(85.589% 0.007 260.03)', info: 'oklch(68.455% 0.148 237.251)',
      infoContent: 'oklch(0% 0 0)', success: 'oklch(78.452% 0.132 181.911)',
      warning: 'oklch(83.242% 0.139 82.95)', error: 'oklch(71.785% 0.17 13.118)',
    },
  },
  {
    id: 'coffee',
    label: 'Coffee',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(24% 0.023 329.708)', base200: 'oklch(21% 0.021 329.708)',
      base300: 'oklch(16% 0.019 329.708)', content: 'oklch(72.354% 0.092 79.129)',
      primary: 'oklch(71.996% 0.123 62.756)', primaryContent: 'oklch(14.399% 0.024 62.756)',
      secondary: 'oklch(34.465% 0.029 199.194)',
      secondaryContent: 'oklch(86.893% 0.005 199.194)', accent: 'oklch(42.621% 0.074 224.389)',
      accentContent: 'oklch(88.524% 0.014 224.389)', neutral: 'oklch(16.51% 0.015 326.261)',
      neutralContent: 'oklch(83.302% 0.003 326.261)', info: 'oklch(79.49% 0.063 184.558)',
      infoContent: 'oklch(15.898% 0.012 184.558)', success: 'oklch(74.722% 0.072 131.116)',
      warning: 'oklch(88.15% 0.14 87.722)', error: 'oklch(77.318% 0.128 31.871)',
    },
  },
  {
    id: 'dim',
    label: 'Dim',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(30.857% 0.023 264.149)',
      base200: 'oklch(28.036% 0.019 264.182)', base300: 'oklch(26.346% 0.018 262.177)',
      content: 'oklch(82.901% 0.031 222.959)', primary: 'oklch(86.133% 0.141 139.549)',
      primaryContent: 'oklch(17.226% 0.028 139.549)', secondary: 'oklch(73.375% 0.165 35.353)',
      secondaryContent: 'oklch(14.675% 0.033 35.353)', accent: 'oklch(74.229% 0.133 311.379)',
      accentContent: 'oklch(14.845% 0.026 311.379)', neutral: 'oklch(24.731% 0.02 264.094)',
      neutralContent: 'oklch(82.901% 0.031 222.959)', info: 'oklch(86.078% 0.142 206.182)',
      infoContent: 'oklch(17.215% 0.028 206.182)', success: 'oklch(86.171% 0.142 166.534)',
      warning: 'oklch(86.163% 0.142 94.818)', error: 'oklch(82.418% 0.099 33.756)',
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(22% 0.019 237.69)', base200: 'oklch(20% 0.019 237.69)',
      base300: 'oklch(18% 0.019 237.69)', content: 'oklch(77.383% 0.043 245.096)',
      primary: 'oklch(74.703% 0.158 39.947)', primaryContent: 'oklch(14.94% 0.031 39.947)',
      secondary: 'oklch(72.537% 0.177 2.72)', secondaryContent: 'oklch(14.507% 0.035 2.72)',
      accent: 'oklch(71.294% 0.166 299.844)', accentContent: 'oklch(14.258% 0.033 299.844)',
      neutral: 'oklch(26% 0.019 237.69)', neutralContent: 'oklch(70% 0.019 237.69)',
      info: 'oklch(85.559% 0.085 206.015)', infoContent: 'oklch(17.111% 0.017 206.015)',
      success: 'oklch(85.56% 0.085 144.778)', warning: 'oklch(85.569% 0.084 74.427)',
      error: 'oklch(85.511% 0.078 16.886)',
    },
  },
  {
    id: 'abyss',
    label: 'Abyss',
    group: 'dark',
    palette: {
      scheme: 'dark', base100: 'oklch(20% 0.08 209)', base200: 'oklch(15% 0.08 209)',
      base300: 'oklch(10% 0.08 209)', content: 'oklch(90% 0.076 70.697)',
      primary: 'oklch(92% 0.2653 125)', primaryContent: 'oklch(50% 0.2653 125)',
      secondary: 'oklch(83.27% 0.0764 298.3)', secondaryContent: 'oklch(43.27% 0.0764 298.3)',
      accent: 'oklch(43% 0 0)', accentContent: 'oklch(98% 0 0)',
      neutral: 'oklch(30% 0.08 209)', neutralContent: 'oklch(90% 0.076 70.697)',
      info: 'oklch(74% 0.16 232.661)', infoContent: 'oklch(29% 0.066 243.157)',
      success: 'oklch(79% 0.209 151.711)', warning: 'oklch(84.8% 0.1962 84.62)',
      error: 'oklch(65% 0.1985 24.22)',
    },
  },
  {
    id: 'shirabe-light',
    labelKey: 'settings.theme.shirabeLight',
    group: 'light',
    palette: {
      scheme: 'light',
      base100: '#ffffff',
      base200: '#eef0f6',
      base300: '#e9ebf3',
      content: '#1b1c23',
      primary: '#5f4fd8',
      primaryContent: '#ffffff',
      secondary: '#4b5bbf',
      secondaryContent: '#ffffff',
      accent: '#1f6f63',
      accentContent: '#ffffff',
      neutral: '#e9ebf3',
      neutralContent: '#1b1c23',
      info: '#1f5678',
      infoContent: '#ffffff',
      success: '#1d6f42',
      warning: '#8a5a12',
      error: '#b3261e',
    },
  },
  {
    id: 'ereader-light',
    labelKey: 'settings.theme.ereaderLight',
    group: 'light',
    palette: {
      scheme: 'light',
      base100: '#ffffff',
      base200: '#f4f4f4',
      base300: '#e6e6e6',
      /* Tinta pekat di atas putih: rasio teks redup terendah (`--faint` = #707070)
         tetap 4.83:1 di atas permukaan terang, jadi tema ini lolos WCAG AA. */
      content: '#000000',
      primary: '#000000',
      primaryContent: '#ffffff',
      secondary: '#333333',
      secondaryContent: '#ffffff',
      accent: '#262626',
      accentContent: '#ffffff',
      neutral: '#e6e6e6',
      neutralContent: '#000000',
      info: '#333333',
      infoContent: '#ffffff',
      success: '#1a1a1a',
      warning: '#4d4d4d',
      error: '#000000',
    },
  },
  {
    id: 'girlypop',
    label: 'Girlypop',
    group: 'light',
    palette: {
      scheme: 'light', base100: '#fff7fc', base200: '#fbe9f5', base300: '#f2d6ec',
      content: '#4a2442', primary: '#c43b8c', primaryContent: '#fff7fc', secondary: '#7651c9',
      secondaryContent: '#ffffff', accent: '#ef8fc4', accentContent: '#421631',
      neutral: '#665064', neutralContent: '#fff7fc', info: '#4d7fc4', infoContent: '#f8fbff',
      success: '#3c8d70', warning: '#b36b10', error: '#c43f68',
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    group: 'light',
    palette: {
      scheme: 'light', base100: '#fdf6e3', base200: '#eee8d5', base300: '#ded8c3',
      content: '#586e75', primary: '#268bd2', primaryContent: '#fdf6e3', secondary: '#2aa198',
      secondaryContent: '#fdf6e3', accent: '#859900', accentContent: '#fdf6e3',
      neutral: '#eee8d5', neutralContent: '#586e75', info: '#268bd2', infoContent: '#fdf6e3',
      success: '#859900', warning: '#b58900', error: '#dc322f',
    },
  },
  {
    id: 'light',
    label: 'Light',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(100% 0 0)', base200: 'oklch(98% 0 0)',
      base300: 'oklch(95% 0 0)', content: 'oklch(21% 0.006 285.885)',
      primary: 'oklch(45% 0.24 277.023)', primaryContent: 'oklch(93% 0.034 272.788)',
      secondary: 'oklch(65% 0.241 354.308)', secondaryContent: 'oklch(94% 0.028 342.258)',
      accent: 'oklch(77% 0.152 181.912)', accentContent: 'oklch(38% 0.063 188.416)',
      neutral: 'oklch(14% 0.005 285.823)', neutralContent: 'oklch(92% 0.004 286.32)',
      info: 'oklch(74% 0.16 232.661)', infoContent: 'oklch(29% 0.066 243.157)',
      success: 'oklch(76% 0.177 163.223)', warning: 'oklch(82% 0.189 84.429)',
      error: 'oklch(71% 0.194 13.428)',
    },
  },
  {
    id: 'cupcake',
    label: 'Cupcake',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(97.788% 0.004 56.375)',
      base200: 'oklch(93.982% 0.007 61.449)', base300: 'oklch(91.586% 0.006 53.44)',
      content: 'oklch(23.574% 0.066 313.189)', primary: 'oklch(85% 0.138 181.071)',
      primaryContent: 'oklch(43% 0.078 188.216)', secondary: 'oklch(89% 0.061 343.231)',
      secondaryContent: 'oklch(45% 0.187 3.815)', accent: 'oklch(90% 0.076 70.697)',
      accentContent: 'oklch(47% 0.157 37.304)', neutral: 'oklch(27% 0.006 286.033)',
      neutralContent: 'oklch(92% 0.004 286.32)', info: 'oklch(68% 0.169 237.323)',
      infoContent: 'oklch(29% 0.066 243.157)', success: 'oklch(69% 0.17 162.48)',
      warning: 'oklch(79% 0.184 86.047)', error: 'oklch(64% 0.246 16.439)',
    },
  },
  {
    id: 'bumblebee',
    label: 'Bumblebee',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(100% 0 0)', base200: 'oklch(97% 0 0)',
      base300: 'oklch(92% 0 0)', content: 'oklch(20% 0 0)', primary: 'oklch(85% 0.199 91.936)',
      primaryContent: 'oklch(42% 0.095 57.708)', secondary: 'oklch(75% 0.183 55.934)',
      secondaryContent: 'oklch(40% 0.123 38.172)', accent: 'oklch(0% 0 0)',
      accentContent: 'oklch(100% 0 0)', neutral: 'oklch(37% 0.01 67.558)',
      neutralContent: 'oklch(92% 0.003 48.717)', info: 'oklch(74% 0.16 232.661)',
      infoContent: 'oklch(39% 0.09 240.876)', success: 'oklch(76% 0.177 163.223)',
      warning: 'oklch(82% 0.189 84.429)', error: 'oklch(70% 0.191 22.216)',
    },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(100% 0 0)', base200: 'oklch(93% 0 0)',
      base300: 'oklch(86% 0 0)', content: 'oklch(35.519% 0.032 262.988)',
      primary: 'oklch(76.662% 0.135 153.45)', primaryContent: 'oklch(33.387% 0.04 162.24)',
      secondary: 'oklch(61.302% 0.202 261.294)', secondaryContent: 'oklch(100% 0 0)',
      accent: 'oklch(72.772% 0.149 33.2)', accentContent: 'oklch(0% 0 0)',
      neutral: 'oklch(35.519% 0.032 262.988)', neutralContent: 'oklch(98.462% 0.001 247.838)',
      info: 'oklch(72.06% 0.191 231.6)', infoContent: 'oklch(0% 0 0)',
      success: 'oklch(64.8% 0.15 160)', warning: 'oklch(84.71% 0.199 83.87)',
      error: 'oklch(71.76% 0.221 22.18)',
    },
  },
  {
    id: 'corporate',
    label: 'Corporate',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(100% 0 0)', base200: 'oklch(93% 0 0)',
      base300: 'oklch(86% 0 0)', content: 'oklch(22.389% 0.031 278.072)',
      primary: 'oklch(58% 0.158 241.966)', primaryContent: 'oklch(100% 0 0)',
      secondary: 'oklch(55% 0.046 257.417)', secondaryContent: 'oklch(100% 0 0)',
      accent: 'oklch(60% 0.118 184.704)', accentContent: 'oklch(100% 0 0)',
      neutral: 'oklch(0% 0 0)', neutralContent: 'oklch(100% 0 0)',
      info: 'oklch(60% 0.126 221.723)', infoContent: 'oklch(100% 0 0)',
      success: 'oklch(62% 0.194 149.214)', warning: 'oklch(85% 0.199 91.936)',
      error: 'oklch(70% 0.191 22.216)',
    },
  },
  {
    id: 'retro',
    label: 'Retro',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(91.637% 0.034 90.515)',
      base200: 'oklch(88.272% 0.049 91.774)', base300: 'oklch(84.133% 0.065 90.856)',
      content: 'oklch(41% 0.112 45.904)', primary: 'oklch(80% 0.114 19.571)',
      primaryContent: 'oklch(39% 0.141 25.723)', secondary: 'oklch(92% 0.084 155.995)',
      secondaryContent: 'oklch(44% 0.119 151.328)', accent: 'oklch(68% 0.162 75.834)',
      accentContent: 'oklch(41% 0.112 45.904)', neutral: 'oklch(44% 0.011 73.639)',
      neutralContent: 'oklch(86% 0.005 56.366)', info: 'oklch(58% 0.158 241.966)',
      infoContent: 'oklch(96% 0.059 95.617)', success: 'oklch(51% 0.096 186.391)',
      warning: 'oklch(64% 0.222 41.116)', error: 'oklch(70% 0.191 22.216)',
    },
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(94.51% 0.179 104.32)',
      base200: 'oklch(91.51% 0.179 104.32)', base300: 'oklch(85.51% 0.179 104.32)',
      content: 'oklch(0% 0 0)', primary: 'oklch(74.22% 0.209 6.35)',
      primaryContent: 'oklch(14.844% 0.041 6.35)', secondary: 'oklch(83.33% 0.184 204.72)',
      secondaryContent: 'oklch(16.666% 0.036 204.72)', accent: 'oklch(71.86% 0.217 310.43)',
      accentContent: 'oklch(14.372% 0.043 310.43)', neutral: 'oklch(23.04% 0.065 269.31)',
      neutralContent: 'oklch(94.51% 0.179 104.32)', info: 'oklch(72.06% 0.191 231.6)',
      infoContent: 'oklch(0% 0 0)', success: 'oklch(64.8% 0.15 160)',
      warning: 'oklch(84.71% 0.199 83.87)', error: 'oklch(71.76% 0.221 22.18)',
    },
  },
  {
    id: 'valentine',
    label: 'Valentine',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(97% 0.014 343.198)',
      base200: 'oklch(94% 0.028 342.258)', base300: 'oklch(89% 0.061 343.231)',
      content: 'oklch(52% 0.223 3.958)', primary: 'oklch(65% 0.241 354.308)',
      primaryContent: 'oklch(100% 0 0)', secondary: 'oklch(62% 0.265 303.9)',
      secondaryContent: 'oklch(97% 0.014 308.299)', accent: 'oklch(82% 0.111 230.318)',
      accentContent: 'oklch(39% 0.09 240.876)', neutral: 'oklch(40% 0.153 2.432)',
      neutralContent: 'oklch(89% 0.061 343.231)', info: 'oklch(86% 0.127 207.078)',
      infoContent: 'oklch(44% 0.11 240.79)', success: 'oklch(84% 0.143 164.978)',
      warning: 'oklch(75% 0.183 55.934)', error: 'oklch(63% 0.237 25.331)',
    },
  },
  {
    id: 'garden',
    label: 'Garden',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(92.951% 0.002 17.197)',
      base200: 'oklch(86.445% 0.002 17.197)', base300: 'oklch(79.938% 0.001 17.197)',
      content: 'oklch(16.961% 0.001 17.32)', primary: 'oklch(62.45% 0.278 3.836)',
      primaryContent: 'oklch(100% 0 0)', secondary: 'oklch(48.495% 0.11 355.095)',
      secondaryContent: 'oklch(89.699% 0.022 355.095)', accent: 'oklch(56.273% 0.054 154.39)',
      accentContent: 'oklch(100% 0 0)', neutral: 'oklch(24.155% 0.049 89.07)',
      neutralContent: 'oklch(92.951% 0.002 17.197)', info: 'oklch(72.06% 0.191 231.6)',
      infoContent: 'oklch(0% 0 0)', success: 'oklch(64.8% 0.15 160)',
      warning: 'oklch(84.71% 0.199 83.87)', error: 'oklch(71.76% 0.221 22.18)',
    },
  },
  {
    id: 'lofi',
    label: 'Lofi',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(100% 0 0)', base200: 'oklch(97% 0 0)',
      base300: 'oklch(94% 0 0)', content: 'oklch(0% 0 0)', primary: 'oklch(15.906% 0 0)',
      primaryContent: 'oklch(100% 0 0)', secondary: 'oklch(21.455% 0.001 17.278)',
      secondaryContent: 'oklch(100% 0 0)', accent: 'oklch(26.861% 0 0)',
      accentContent: 'oklch(100% 0 0)', neutral: 'oklch(0% 0 0)',
      neutralContent: 'oklch(100% 0 0)', info: 'oklch(79.54% 0.103 205.9)',
      infoContent: 'oklch(15.908% 0.02 205.9)', success: 'oklch(90.13% 0.153 164.14)',
      warning: 'oklch(88.37% 0.135 79.94)', error: 'oklch(78.66% 0.15 28.47)',
    },
  },
  {
    id: 'pastel',
    label: 'Pastel',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(100% 0 0)', base200: 'oklch(98.462% 0.001 247.838)',
      base300: 'oklch(92.462% 0.001 247.838)', content: 'oklch(20% 0 0)',
      primary: 'oklch(90% 0.063 306.703)', primaryContent: 'oklch(49% 0.265 301.924)',
      secondary: 'oklch(89% 0.058 10.001)', secondaryContent: 'oklch(51% 0.222 16.935)',
      accent: 'oklch(90% 0.093 164.15)', accentContent: 'oklch(50% 0.118 165.612)',
      neutral: 'oklch(55% 0.046 257.417)', neutralContent: 'oklch(92% 0.013 255.508)',
      info: 'oklch(86% 0.127 207.078)', infoContent: 'oklch(52% 0.105 223.128)',
      success: 'oklch(87% 0.15 154.449)', warning: 'oklch(83% 0.128 66.29)',
      error: 'oklch(80% 0.114 19.571)',
    },
  },
  {
    id: 'fantasy',
    label: 'Fantasy',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(100% 0 0)', base200: 'oklch(93% 0 0)',
      base300: 'oklch(86% 0 0)', content: 'oklch(27.807% 0.029 256.847)',
      primary: 'oklch(37.45% 0.189 325.02)', primaryContent: 'oklch(87.49% 0.037 325.02)',
      secondary: 'oklch(53.92% 0.162 241.36)', secondaryContent: 'oklch(90.784% 0.032 241.36)',
      accent: 'oklch(75.98% 0.204 56.72)', accentContent: 'oklch(15.196% 0.04 56.72)',
      neutral: 'oklch(27.807% 0.029 256.847)', neutralContent: 'oklch(85.561% 0.005 256.847)',
      info: 'oklch(72.06% 0.191 231.6)', infoContent: 'oklch(0% 0 0)',
      success: 'oklch(64.8% 0.15 160)', warning: 'oklch(84.71% 0.199 83.87)',
      error: 'oklch(71.76% 0.221 22.18)',
    },
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(100% 0 0)', base200: 'oklch(97% 0 0)',
      base300: 'oklch(94% 0 0)', content: 'oklch(20% 0 0)', primary: 'oklch(87% 0 0)',
      primaryContent: 'oklch(26% 0 0)', secondary: 'oklch(87% 0 0)',
      secondaryContent: 'oklch(26% 0 0)', accent: 'oklch(87% 0 0)',
      accentContent: 'oklch(26% 0 0)', neutral: 'oklch(87% 0 0)',
      neutralContent: 'oklch(26% 0 0)', info: 'oklch(44% 0.11 240.79)',
      infoContent: 'oklch(90% 0.058 230.902)', success: 'oklch(43% 0.095 166.913)',
      warning: 'oklch(47% 0.137 46.201)', error: 'oklch(44% 0.177 26.899)',
    },
  },
  {
    id: 'cmyk',
    label: 'Cmyk',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(100% 0 0)', base200: 'oklch(95% 0 0)',
      base300: 'oklch(90% 0 0)', content: 'oklch(20% 0 0)',
      primary: 'oklch(71.772% 0.133 239.443)', primaryContent: 'oklch(14.354% 0.026 239.443)',
      secondary: 'oklch(64.476% 0.202 359.339)',
      secondaryContent: 'oklch(12.895% 0.04 359.339)', accent: 'oklch(94.228% 0.189 105.306)',
      accentContent: 'oklch(18.845% 0.037 105.306)', neutral: 'oklch(21.778% 0 0)',
      neutralContent: 'oklch(84.355% 0 0)', info: 'oklch(68.475% 0.094 217.284)',
      infoContent: 'oklch(13.695% 0.018 217.284)', success: 'oklch(46.949% 0.162 321.406)',
      warning: 'oklch(71.236% 0.159 52.023)', error: 'oklch(62.013% 0.208 28.717)',
    },
  },
  {
    id: 'autumn',
    label: 'Autumn',
    group: 'light',
    palette: {
      scheme: 'light', base100: '#fbf6e9', base200: '#f0e4cd', base300: '#ddc9a8',
      content: '#2f3127', primary: '#596b3b', primaryContent: '#fffdf7', secondary: '#9a5136',
      secondaryContent: '#fffaf2', accent: '#d09a46', accentContent: '#302416',
      neutral: '#675746', neutralContent: '#fffaf2', info: '#426879', infoContent: '#f8fcfb',
      success: '#326b54', warning: '#85520d', error: '#983f35',
    },
  },
  {
    id: 'acid',
    label: 'Acid',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(98% 0 0)', base200: 'oklch(95% 0 0)',
      base300: 'oklch(91% 0 0)', content: 'oklch(0% 0 0)',
      primary: 'oklch(71.9% 0.357 330.759)', primaryContent: 'oklch(14.38% 0.071 330.759)',
      secondary: 'oklch(73.37% 0.224 48.25)', secondaryContent: 'oklch(14.674% 0.044 48.25)',
      accent: 'oklch(92.78% 0.264 122.962)', accentContent: 'oklch(18.556% 0.052 122.962)',
      neutral: 'oklch(21.31% 0.128 278.68)', neutralContent: 'oklch(84.262% 0.025 278.68)',
      info: 'oklch(60.72% 0.227 252.05)', infoContent: 'oklch(12.144% 0.045 252.05)',
      success: 'oklch(85.72% 0.266 158.53)', warning: 'oklch(91.01% 0.212 100.5)',
      error: 'oklch(64.84% 0.293 29.349)',
    },
  },
  {
    id: 'lemonade',
    label: 'Lemonade',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(98.71% 0.02 123.72)',
      base200: 'oklch(91.8% 0.018 123.72)', base300: 'oklch(84.89% 0.017 123.72)',
      content: 'oklch(19.742% 0.004 123.72)', primary: 'oklch(58.92% 0.199 134.6)',
      primaryContent: 'oklch(11.784% 0.039 134.6)', secondary: 'oklch(77.75% 0.196 111.09)',
      secondaryContent: 'oklch(15.55% 0.039 111.09)', accent: 'oklch(85.39% 0.201 100.73)',
      accentContent: 'oklch(17.078% 0.04 100.73)', neutral: 'oklch(30.98% 0.075 108.6)',
      neutralContent: 'oklch(86.196% 0.015 108.6)', info: 'oklch(86.19% 0.047 224.14)',
      infoContent: 'oklch(17.238% 0.009 224.14)', success: 'oklch(86.19% 0.047 157.85)',
      warning: 'oklch(86.19% 0.047 102.15)', error: 'oklch(86.19% 0.047 25.85)',
    },
  },
  {
    id: 'winter',
    label: 'Winter',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(100% 0 0)', base200: 'oklch(97.466% 0.011 259.822)',
      base300: 'oklch(93.268% 0.016 262.751)', content: 'oklch(41.886% 0.053 255.824)',
      primary: 'oklch(56.86% 0.255 257.57)', primaryContent: 'oklch(91.372% 0.051 257.57)',
      secondary: 'oklch(42.551% 0.161 282.339)',
      secondaryContent: 'oklch(88.51% 0.032 282.339)', accent: 'oklch(59.939% 0.191 335.171)',
      accentContent: 'oklch(11.988% 0.038 335.171)', neutral: 'oklch(19.616% 0.063 257.651)',
      neutralContent: 'oklch(83.923% 0.012 257.651)', info: 'oklch(88.127% 0.085 214.515)',
      infoContent: 'oklch(17.625% 0.017 214.515)', success: 'oklch(80.494% 0.077 197.823)',
      warning: 'oklch(89.172% 0.045 71.47)', error: 'oklch(73.092% 0.11 20.076)',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(95.127% 0.007 260.731)',
      base200: 'oklch(93.299% 0.01 261.788)', base300: 'oklch(89.925% 0.016 262.749)',
      content: 'oklch(32.437% 0.022 264.182)', primary: 'oklch(59.435% 0.077 254.027)',
      primaryContent: 'oklch(11.887% 0.015 254.027)',
      secondary: 'oklch(69.651% 0.059 248.687)',
      secondaryContent: 'oklch(13.93% 0.011 248.687)', accent: 'oklch(77.464% 0.062 217.469)',
      accentContent: 'oklch(15.492% 0.012 217.469)', neutral: 'oklch(45.229% 0.035 264.131)',
      neutralContent: 'oklch(89.925% 0.016 262.749)', info: 'oklch(69.207% 0.062 332.664)',
      infoContent: 'oklch(13.841% 0.012 332.664)', success: 'oklch(76.827% 0.074 131.063)',
      warning: 'oklch(85.486% 0.089 84.093)', error: 'oklch(60.61% 0.12 15.341)',
    },
  },
  {
    id: 'caramellatte',
    label: 'Caramellatte',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(98% 0.016 73.684)', base200: 'oklch(95% 0.038 75.164)',
      base300: 'oklch(90% 0.076 70.697)', content: 'oklch(40% 0.123 38.172)',
      primary: 'oklch(0% 0 0)', primaryContent: 'oklch(100% 0 0)',
      secondary: 'oklch(22.45% 0.075 37.85)', secondaryContent: 'oklch(90% 0.076 70.697)',
      accent: 'oklch(46.44% 0.111 37.85)', accentContent: 'oklch(90% 0.076 70.697)',
      neutral: 'oklch(55% 0.195 38.402)', neutralContent: 'oklch(98% 0.016 73.684)',
      info: 'oklch(42% 0.199 265.638)', infoContent: 'oklch(90% 0.076 70.697)',
      success: 'oklch(43% 0.095 166.913)', warning: 'oklch(82% 0.189 84.429)',
      error: 'oklch(70% 0.191 22.216)',
    },
  },
  {
    id: 'silk',
    label: 'Silk',
    group: 'light',
    palette: {
      scheme: 'light', base100: 'oklch(97% 0.0035 67.78)', base200: 'oklch(95% 0.0081 61.42)',
      base300: 'oklch(90% 0.0081 61.42)', content: 'oklch(40% 0.0081 61.42)',
      primary: 'oklch(23.27% 0.0249 284.3)', primaryContent: 'oklch(94.22% 0.2505 117.44)',
      secondary: 'oklch(23.27% 0.0249 284.3)', secondaryContent: 'oklch(73.92% 0.2135 50.94)',
      accent: 'oklch(23.27% 0.0249 284.3)', accentContent: 'oklch(88.92% 0.2061 189.9)',
      neutral: 'oklch(20% 0 0)', neutralContent: 'oklch(80% 0.0081 61.42)',
      info: 'oklch(80.39% 0.1148 241.68)', infoContent: 'oklch(30.39% 0.1148 241.68)',
      success: 'oklch(83.92% 0.0901 136.87)', warning: 'oklch(83.92% 0.1085 80)',
      error: 'oklch(75.1% 0.1814 22.37)',
    },
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    group: 'contrast',
    palette: {
      scheme: 'dark', base100: '#000000', base200: '#141414', base300: '#2a2a2a',
      content: '#ffffff', primary: '#ffe000', primaryContent: '#000000', secondary: '#00e5ff',
      secondaryContent: '#000000', accent: '#5bff9d', accentContent: '#000000',
      neutral: '#2a2a2a', neutralContent: '#ffffff', info: '#5bc8ff', infoContent: '#000000',
      success: '#51ff8f', warning: '#ffd400', error: '#ff5b5b',
    },
  },];

const THEME_INDEX: ReadonlyMap<string, ThemeOption> = new Map(
  THEME_OPTIONS.map((option) => [option.id, option]),
);

/** Pilihan tema berdasarkan id; `null` bila tidak dikenal. */
export function themeOption(id: string): ThemeOption | null {
  return THEME_INDEX.get(id) ?? null;
}

/** Tema katalog milik satu grup, urut sesuai katalog. */
export function themesInGroup(group: ThemeGroupId): ThemeOption[] {
  return THEME_OPTIONS.filter((option) => option.group === group);
}

/**
 * Ubah preferensi tema (termasuk `auto`) menjadi id tema konkret yang punya palet.
 * Nilai lama (`system`, `light`, `dark`) tetap diterima supaya preferensi yang sudah
 * tersimpan tidak berubah tampilan.
 */
export function resolveThemeId(preference: string, prefersDark: boolean): string {
  if (preference === AUTO_THEME_ID || preference === 'system') {
    return prefersDark ? AUTO_THEME_IDS.dark : AUTO_THEME_IDS.light;
  }
  if (preference === 'light') {
    return AUTO_THEME_IDS.light;
  }
  if (preference === 'dark') {
    return AUTO_THEME_IDS.dark;
  }
  return themeOption(preference)?.palette === undefined ? AUTO_THEME_IDS.dark : preference;
}

/** Palet untuk preferensi tema apa pun (selalu ada, karena `auto` ikut diselesaikan). */
export function paletteFor(preference: string, prefersDark: boolean): ThemePalette {
  const option = themeOption(resolveThemeId(preference, prefersDark));
  if (option?.palette === undefined) {
    throw new Error(`Tema ${preference} tidak punya palet`);
  }
  return option.palette;
}

/** Normalisasi preferensi tersimpan dari versi lama. */
export function normaliseThemePreference(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_THEME_PREFERENCE;
  }
  if (value === 'system') {
    return AUTO_THEME_ID;
  }
  if (value === 'light' || value === 'dark') {
    return value;
  }
  return themeOption(value) === null ? DEFAULT_THEME_PREFERENCE : value;
}
