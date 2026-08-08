# RSS Reader — Chrome Extension

RSS reader di Chrome Side Panel. Manifest V3, vanilla JS, tanpa build step.

## Fitur

- **Tambah feed dari tab aktif** — deteksi `<link rel="alternate">` di halaman; kalau tidak ada, coba path umum (`/feed`, `/rss.xml`, `/atom.xml`, …); bisa juga tempel URL manual
- **Reader view** (default) — fetch artikel asli, ekstrak konten bersih dengan [Mozilla Readability](https://github.com/mozilla/readability); fallback ke isi feed kalau ekstraksi gagal
- **Polling background** tiap 30 menit + badge jumlah unread di icon
- Dukung RSS 2.0, Atom, RDF/RSS 1.0; dark mode otomatis

## Instalasi (load unpacked)

1. Buka `chrome://extensions`
2. Aktifkan **Developer mode** (kanan atas)
3. Klik **Load unpacked** → pilih folder proyek ini
4. Klik icon extension → side panel terbuka

## Struktur

| File | Peran |
|---|---|
| `background.js` | Service worker: alarm polling, merge item, badge unread |
| `offscreen.js` | Parsing XML feed untuk service worker (SW tak punya `DOMParser`) |
| `sidepanel.js` | UI: feed list → article list → reader view; tambah feed; sanitasi HTML |
| `common/feed-parser.js` | Normalisasi RSS 2.0 / Atom / RDF → objek item |
| `common/sanitize.js` | Sanitasi HTML remote + pemulihan gambar lazy-load |
| `common/storage.js` | Skema & helper `chrome.storage.local` (cap 100 item/feed) |
| `lib/readability.js` | Vendored Mozilla Readability v0.5.0 (Apache-2.0) |
| `icons/light/`, `icons/dark/` | Icon toolbar 16/32/48/128 px, dua varian tema |

## Catatan: icon mengikuti tema sistem

Chrome tidak mendukung varian icon per tema di manifest — `theme_icons` hanya ada di
Firefox. Jadi pergantiannya dilakukan saat runtime lewat `chrome.action.setIcon()`.

Tema dideteksi dengan `matchMedia('(prefers-color-scheme: dark)')` di dokumen offscreen
(reason `MATCH_MEDIA`), karena service worker MV3 tidak punya `matchMedia`. Offscreen
mengirim perubahan tema ke service worker, dan service worker menanyakan tema saat
bangun — dokumen offscreen bertahan melewati restart service worker sehingga pesan
awalnya tidak terkirim ulang.

- Tema terang → `icons/light/` (glif hitam)
- Tema gelap → `icons/dark/` (glif putih)

Kunci `icons` di manifest — dipakai halaman `chrome://extensions` — tidak bisa ikut
bertukar, jadi dipatok ke varian light.

## Catatan: gambar lazy-load

Banyak situs (WordPress + Google PageSpeed, WP Rocket, lazysizes) mengisi `src` dengan
placeholder dan menyimpan URL gambar asli di atribut `data-*`, lalu menukarnya lewat
JavaScript. Reader view membuang JavaScript situs, jadi `common/sanitize.js` melakukan
penukaran itu sendiri sebelum render.

## Tes

```bash
python3 -m http.server 8765
```

- `http://localhost:8765/tests/test-parser.html` — parseFeed untuk RSS 2.0, Atom, RDF (20 assertion)
- `http://localhost:8765/tests/test-sanitize.html` — sanitasi, lazy-load, dan integrasi Readability (21 assertion)
