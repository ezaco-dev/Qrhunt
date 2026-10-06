# AGENTS.md

Panduan kerja untuk agent (dan manusia) yang mengubah repositori ini.
Baca **sepenuhnya sebelum menyentuh kode**. Sebagian besar keputusan di bawah
sudah dibayar dengan bug nyata; menyingkirinya berarti memperbaikinya lagi.

---

## 1. Ringkas proyek

QrHunt = berbagi media anonim lewat satu QR code. Satu `qr_code_id` punya satu
media aktif; siapa pun bisa menggantinya tanpa login; media lama dihapus begitu
media baru tersimpan.

Antrean yang wajib, daribrowser sampai database:

```
NSFWJS (browser) → Turnstile (anti-bot) → NSFWJS (server, di VPS)
  → Cloudinary (penyimpanan) → Supabase (database)
```

Berkas ini berisi aturan kerja dan sudah cukup untuk mengubah kode dengan aman.
`CLAUDE.md` hanya berisi `@AGENTS.md`.

---

## 2. (Next.js 16) Baca dokumentasi dulu

Next 16 punya breaking change dibanding materi pelatihan model. Dokumentasi
resmi disertakan di `node_modules/next/dist/docs/` — baca berkas yang relevan
sebelum menulis kode, jangan menebak dari Next 14/15.

`AGENTS.md` sendiri dapat disisipkan ulang oleh `next dev`. Blok yang ditulis
otomatis memakai tanda:

```
BEGIN:nextjs-agent-rules
...
END:nextjs-agent-rules
```

**Jangan hapus blok itu.** Melepasnya memicu perubahan uncommitted yang tidak
diminta dan mencemari diff.

`PageProps<"/q/[qr_id]">` dan `LayoutProps<"/">` adalah tipe global yang
dihasilkan Next ke `.next/types/routes.d.ts` — jangan di-import manual dan jangan
dideklarasikan ulang sendiri. Karena itu `tsc --noEmit` gagal sampai build
pertama selesai.

---

## 3. Aturan yang tidak boleh dilanggar

### Pasangan env Turnstile harus terisi bersamaan

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` dan `TURNSTILE_SECRET_KEY` tidak boleh diisi
satu per satu:

- **Secret terisi, site key kosong** → semua unggahan ditolak **403**. Client
  mengirim `PLACEHOLDER_TOKEN`, server memverifikasinya terhadap secret
  sungguhan, dan Cloudflare menolaknya.
- **Site key terisi, secret kosong** → widget asli tampil dan tantangan diselesaikan,
  tapi server menerima placeholder apa pun. Proteksi bot tidak ada, dan tampilnya
  widget menyesatkan.

`MediaUploader` sengaja menonaktifkan tombol unggah selama
`isAwaitingTurnstile` — tanpa itu, balapan antara widget dan klik pengguna
menghasilkan 403 yang sulit dijelaskan.

### Token Turnstile hanya dipakai sekali

Selesai mengunggah, token harus di-reset supaya percobaan berikutnya tidak
mengirim token yang sudah dipakai. Menyerahkan token basi menghasilkan
`timeout-or-duplicate` dari Cloudflare.

### `CLOUDINARY_URL` boleh dipakai, tapi diurai sendiri

SDK Cloudinary membaca `CLOUDINARY_URL` sendiri. `configureCloudinary()` tetap
menguraikannya sendiri dengan `new URL` plus pemeriksaan protocol, karena
`parseCloudinaryUrl` di berkas yang sama adalah kebalikan dari URL yang ditulis
Cloudinary. Kalau konfigurasi masuk lewat jalur yang sama, satu kesalahan
penulisan jadi dua masalah terpisah: unggahan gagal **dan** aset lama tidak
terhapus.

### Urutan di `app/api/upload/route.ts` adalah kontrak

Sepuluh langkah di route itu bukan gaya penulisan. Yang menentukan keamanan:

1. Turnstile 2. Moderasi (layanan VPS) 3. Tulis DB (`upsert`) 4. **Hapus media lama**

Membalik langkah 3 dan 4 meninggalkan QR dengan tanpa media bila terjadi
kegagalan di tengah. Menghapus media lama lebih dulu membuat pengguna melihat
halaman kosong selama unggahan berikutnya berjalan.

### Moderasi server wajib fail-closed

Kalau layanan moderasi di VPS tidak bisa dihubungi, jawabannya **503
`moderation-unavailable`**, bukan "lolos". Pelonggaran moderasi adalah kegagalan
total filter. Kredensial yang kosong harus menghasilkan 503 juga, bukan lolos.

### Admin: satu password, cookie HMAC, tidak ada jalur tulis kedua

`/admin` dan `/admin/login` memakai `lib/admin-auth.ts`. Aturannya:

- `ADMIN_PASSWORD` dan `ADMIN_SESSION_SECRET` hanya dibaca di modul itu.
  Mengimpor modul ini di client component berarti menarik `node:crypto` ke
  bundel browser — larang. Komponen yang butuh nama cookie menerima lewat props.
- Token cookie adalah HMAC-SHA256 dari payload tetap `"admin-v1"`. Tidak ada
  data pengguna di dalam token, jadi tidak ada yang bisa dibaca atau diputar
  dari isinya; ganti `ADMIN_SESSION_SECRET` untuk membatalkan semua sesi.
- Semua perbandingan lewat `crypto.timingSafeEqual`. Password dengan panjang
  berbeda tetap menjalankan satu pembandingan dummy supaya waktunya mirip.
- `/api/admin/qr` satu-satunya endpoint tulis admin. Ia memakai
  `qrCodeIdSchema` (skema yang sama dengan halaman publik), membalas 409 untuk
  ID duplikat, dan membuat baris `qr_medias` bertipe `text` supaya QR yang baru
  dicetak tidak mendarat di 404.
- Env `ADMIN_PASSWORD` kosong berarti login DITOLAK, bukan diterima dengan
  password apa pun.

### Layanan moderasi di VPS hanya boleh di loopback

`moderation-service/server.mjs` mengikat ke `127.0.0.1` dan itu wajib. Caddy yang
menghadap internet meneruskannya lewat TLS. Mengubahnya ke `0.0.0.0` membuka
endpoint moderasi tanpa TLS dan tanpa device gate ke seluruh internet.

Blok Caddy untuk moderasi (site block `103.210.69.31`, dengan `tls` eksplisit ke
`/etc/caddy/certs/qrhunt-ip.{crt,key}`) **sengaja tidak** memakai snippet
`ged_device` seperti layanan lain di VPS ini. Device gate menolak device tanpa
trust cookie, dan server Vercel tidak punya cookie itu, jadi memakainya akan
memblokir seluruh traffic moderasi.

Otentikasi ada di sisi service: `Authorization: Bearer <MODERATION_API_KEY>`,
dibandingkan dengan waktu tetap lewat `crypto.timingSafeEqual`. Header auth
sudah diperiksa **sebelum** body dibaca, supaya penyerang tidak bisa membanjiri
memori hanya dengan mengirim header.

`MODERATION_SERVICE_URL` di aplikasi menolak apa pun selain `https://` kecuali
menunjuk ke loopback. Tanpa TLS, kunci dan isi unggahan bisa dibaca orang di
tengah, dan orang itu lalu bisa memalsukan jawaban moderasi.

Domain ini tidak punya wildcard, jadi layanan moderasi tidak punya subdomain
dan dijangkau langsung di IP VPS dengan sertifikat self-signed khusus IP
(`/etc/caddy/certs/qrhunt-ip.crt`, SAN `IP:103.210.69.31`). Sertifikat itu
tidak dikenal trust store mana pun, jadi klien hanya menerimanya lewat
`MODERATION_CA_PEM` (PEM atau base64 dari PEM). Aturan yang dijaga
`lib/moderation.ts`:

- https non-loopback **tanpa** `MODERATION_CA_PEM` ditolak sebelum request
  dikirim — bukan dikirim lalu gagal di handshake, supaya pesannya jelas.
- `MODERATION_CA_PEM` yang tidak bisa diurai jadi PEM juga ditolak.
- Loopback tetap boleh `http://` tanpa pin, untuk pengembangan lokal.
- Ganti sertifikat di VPS wajib diikuti ganti `MODERATION_CA_PEM` di aplikasi;
  kalau tidak, semua unggahan 503 (fail-closed).

Klien memakai `node:http`/`node:https`, bukan `fetch`: fetch di Node tidak
menerima CA kustom tanpa dispatcher undici, dan tanpa CA kustom sertifikat
self-signed selalu ditolak.

### `frameCount = 0` dari ffmpeg berarti DITOLAK, bukan lolos

`extractFrames()` melempar error kalau ffmpeg tidak menghasilkan satu frame pun.
Kalau frame kosong dianggap aman, penyerang cukup mengirim berkas rusak atau
format tak didukung dan seluruh moderasi dilewati tanpa jejak.

Dua jebakan ffmpeg yang sudah dibayar di `moderation-service/lib/frames.mjs`:

- Filter `fps` **membuang gambar diam**. JPEG punya durasi 0,04 s dan satu frame
  di t=0; `fps=1/1` menghasilkan nol byte dan ffmpeg keluar dengan "Output file
  is empty". Cabang gambar dan cabang video/GIF harus dipisah.
- Deteksi format dari pipe (`-i pipe:0`) hanya jalan untuk video dan GIF.
  Demuxer `image2` butuh pola nama berkas, jadi gambar selalu lewat berkas
  sementara.

### Anotasi warna harus sesuai dengan apa yang di-feed ke model

Skor eksplisit yang dipakai ambang adalah skor **kelas eksplisit tertinggi**
(`Porn`/`Hentai`), bukan skor kelas tertinggi secara keseluruhan. Bedanya nyata:
gambar dengan Porn 0.55 dan Sexy 0.90 punya argmax "Sexy", tapi ambang 0.6
justru harus menilai Porn 0.55 sebagai yang menentukan.

`moderation-service/verify-model.mjs` membandingkan pipeline server dengan
`classify()` dari pustaka NSFWJS asli dan hasilnya selisih **0.00e+0**. Saat
menjalankan ulang, `fromPixels()` harus diberi PixelData **RGBA**, bukan RGB24:
di browser ia menerima hasil canvas `getImageData` yang selalu RGBA lalu
membuang alfa. Diberi RGB24 langsung, `fromPixels()` salah baca 103.574 dari
150.528 elemen, dan test membandingkan pipeline dengan kesalahan, bukan dengan
browser.

### `MODERATION_TIMEOUT_MS` harus di bawah `maxDuration` route

Bawaan 45 detik, dan `app/api/upload/route.ts` menetapkan `maxDuration = 60`.
Kalau timeout lebih besar, Vercel lebih dulu membalas 504 dan pemanggil tidak
sempat mengubahnya jadi 503 yang rapi.

Nilai lama 8 detik terlalu kecil: inferensi di VPS terukur sekitar 2,5 detik per
frame dan video dinilai sampai 8 frame, jadi satu permintaan bisa memakan hampir
20 detik. Dengan 8 detik, video yang sah selalu ditolak.

(tfjs CPU murni tidak bisa dipercepat di sini: `@tensorflow/tfjs-node` butuh
AVX/AVX2/FMA, sedangkan CPU VPS ini `QEMU Virtual CPU 2.5+` yang cuma punya
`sse4_2`. Memuat binding itu berakhir dengan SIGILL. Dekuantisasi uint8 ke
float32 juga tidak membantu — diukur, tidak lebih cepat.)

### Pemeriksaan di browser BUKAN penjaga

NSFWJS di `lib/nsfw-client.ts` bisa dilewati dengan mengedit Client Component.
Itu diterima dan disengaja: gunanya UX dan penghematan kuota. Jangan menulis
komentar yang menyatakan sebaliknya, dan jangan andalkan bahwa server tidak
memeriksa.

### Auto-hide laporan terjadi di dalam SQL

Jangan menulis `SELECT → increment → UPDATE → cek ambang` di TypeScript.
Pakai RPC `increment_report_count` yang `security definer`. Bacanya perlu
mengambil nilai basi, dan ambang batasnya bisa dilewati.

`execute` atas fungsi itu dicabut dari `public`, `anon`, dan `authenticated`.
Menambahkannya kembali berarti siapa pun dengan anon key bisa menyembunyikan
media QR mana pun.

### 404 yang sama untuk "tidak ada" dan "disembunyikan"

`/q/[qr_id]` memakai satu `notFound()` untuk keduanya. Membedakan keduanya
membocorkan status moderasi lewat perbedaan respons.

### `is_hidden` tidak pernah sampai ke browser

`PublicQrMedia = Omit<QrMedia, "is_hidden">` ada karena alasan itu. Bangun
objeknya kolom-per-kolom di `lib/media.ts`; jangan pakai `{ ...row }`, karena
kolom baru otomatis ikut bocor tanpa ada yang compilation warning.

### Tidak ada secret di bundle browser

`assertServerOnly()` adalah penjaga, bukan hiasan. Modul server memanggilnya
saat modul itu dieksekusi, sehingga salah import meledak dengan pesan jelas.

`lib/turnstile-shared.ts` sengaja tidak mengimpor apa pun supaya Client
Component bisa memakai `PLACEHOLDER_TOKEN` tanpa menarik
`lib/turnstile.ts` ke bundle. Kalau dipecah agar "lebih rapi", `TURNSTILE_SECRET_KEY`
ikut terbawa.

Verifikasi setelah build:

```bash
grep -r "SUPABASE_SERVICE_ROLE_KEY\|TURNSTILE_SECRET_KEY\|MODERATION_API_KEY\|CLOUDINARY_API_SECRET\|assertServerOnly" .next/static/chunks/
# harus nihil
```

### RLS: tidak boleh ada policy tulis

Anon hanya boleh `SELECT` baris `is_hidden = false`. Semua tulis lewat service
role. Kalau menambahkan policy tulis untuk anon, kebocoran anon key langsung
berdampak ke penulisan data.

---

## 4. Jebakan teknis yang mahal untuk diulang

### Impor NSFWJS

```ts
import { load } from "nsfwjs/core";   // BENAR
import { load } from "nsfwjs";        // JANGAN
```

Entri `"nsfwjs"` menarik ketiga model sebagai base64 (>10 MB) ke dalam bundle
dan membuat webpack gagal build dengan `Cannot statically analyse require(...)`.

Model di-host sendiri di `public/models/mobilenet_v2/`. Filing ulang model itu
dengan `node scripts/extract-model.cjs`; verifikasi dengan
`node scripts/verify-model.cjs`.

Penting: model tersebut adalah **Keras** format, bukan graph. Panggil
`load(url, { size: 224, type: "layers" })`. Dengan `type: "graph"` (atau model
yang topologinya tidak cocok) load gagal dengan
`Cannot read properties of undefined (reading 'producer')`. Gejalanya sama
persis dengan "model rusak" padahal modelnya utuh — periksa `type` dulu.

### `parseCloudinaryUrl`

Ada 23 kasus regresi di `lib/__tests__/cloudinary.test.ts`. Parser ini satu-
satunya cara menemukan kembali aset yang harus dihapus saat media diganti,
karena tabel hanya menyimpan `media_url`. Menurunkan cakupannya tanpa menambah
kasus yang setara berarti file lama tidak terhapus dan kuota bocor.

Dua aturan yang paling sering dilanggar: segmen versi `v\d+` dibuang **maksimal
satu**, dan ekstensi dibuang **hanya dari segmen terakhir**.

### AdModal tidak bisa dilewati

Dua lapis, keduanya wajib:

1. `onOpenChange` adalah fungsi no-op bernama `ignoreCloseRequest`. Base UI
   memanggilnya saat Escape atau klik luar. Handler yang memanggil
   `onComplete()` di sana adalah celah bypass nyata.
2. Timer memakai deadline absolut `Date.now() + duration * 1000`. Penghitung
   yang dikurangi tiap tick melambat saat tab di-minimize, sehingga pengguna
   ditahan lebih lama dari yang dijanjikan.

### GIF tidak boleh lewat optimizer

`unoptimized` wajib pada GIF. Optimizer Next mengambil satu frame pertama dan
animasi berhenti — gejalanya "GIF-nya tidak bergerak", penyebabnya bukan format
berkasnya.

### `performUpload` harus dideklarasikan sebelum `handleScanAndUpload`

Keduanya `useCallback` dan yang kedua memakai yang pertama. Urutannya dibalik
menghasilkan `used before defined` saat callback pertama dibuat. Bukan sekadar
preferensi gaya.

---

## 5. Platform: Termux / Android arm64

Lingkungan pengembangan adalah Termux (Node 22/26, arm64). Dua batasan:

1. **`.bin/*` tidak bisa dieksekusi.** Termux tidak punya `/usr/bin/env`,
   sedangkan script npm adalah symlink ber-shebang `#!/usr/bin/env node`.
   Jalankan `node node_modules/<pkg>/bin/...` secara eksplisit.
2. **Turbopack tidak mendukung arm64.** Hanya binding WASM yang terpasang,
   gejalanya `Turbopack is not supported on this platform (android/arm64)`.

Gunakan script `*:termux`. **Jangan** "perbaiki" ini dengan mengubah script
`dev`/`build` default — di platform lain Turbopack jauh lebih cepat.

---

## 6. Verifikasi

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build --webpack
```

Harapan setelah build:

| Route | Bentuk |
| ----- | ------ |
| `/` | statis (SSG) |
| `/_not-found` | statis |
| `/q/[qr_id]` | dinamis |
| `/api/upload` | route handler |
| `/api/report` | route handler |

Smoke test:

```bash
GET /                      # 200
GET /q/UMKM_001            # 200 (atau 404 bila env/db belum siap)
GET /q/bad%20id            # 404
GET /models/mobilenet_v2/model.json  # 200
POST /api/upload           # tanpa env → 500 {"ok":false,"code":"config"}
```

Layanan moderasi di VPS punya tes sendiri, terpisah dari aplikasi:

```bash
cd moderation-service
node verify-model.mjs      # skor identik dengan pustaka NSFWJS (selisih 0)
MODERATION_API_KEY=<kunci> node smoke-test.mjs   # 14 kasus, fail-closed
```

`verify-model.mjs` adalah yang paling penting: tanpa itu, moderasi bisa berjalan
tanpa error dan tetap menghasilkan angka yang tidak ada artinya.

Webpack di Termux lambat: halaman pertama bisa 1-2 menit karena
`@tensorflow/tfjs` besar dan tidak ada cache build.

---

## 7. Batasan yang diketahui

Jangan memperbaiki tanpa sadar. Semuanya disengaja dan tercatat di daftar di
bawah ini.

- `getSupabaseBrowserClient()` adalah **dead code**. Infra baca RLS yang
  disiapkan, belum dipakai komponen mana pun.
- Durasi video **dipercaya dari client**. Pagar kedua hanya batas ukuran 4 MB.
- `/api/report` **tanpa CAPTCHA** — anonim by design, rate limiting platform
  satu-satunya pertahanan.
- Policy SELECT RLS mengekspos `report_count` dan `is_hidden` untuk baris yang
  lolos filter (`is_hidden` jadi selalu false di hasil). Aplikasi tidak pernah
  mengirim keduanya ke browser.
- **Diskresi temporal video adalah batas modelnya.** MobileNetV2 dilatih pada
  gambar 224x224, jadi video yang isinya eksplisit hanya sesaat di antara frame
  yang bersih bisa lolos. Bukan bug — jangan diklaim sebaliknya.
- **Gambar dinilai satu frame saja; GIF dan video di-sampling merata**
  (`MAX_FRAMES = 8`), bukan setiap frame. Berkas yang sengaja menyembunyikan
  konten di antara frame sampel bisa lolos.
- **Tidak ada TTL atau rotasi kunci di layanan moderasi.** Kalau proses macet,
  `Restart=always` milik systemd yang memulihkannya; request yang menggantung
  diputus `requestTimeout` 40 detik.

---

## 8. Ceklis sebelum selesai

1. Tidak ada secret yang dapat diakses dari client. Sudah dicek dengan grep di
   `.next/static/chunks/`?
2. Urutan `POST /api/upload` masih moderasi → tulis → hapus lama?
3. Kegagalan moderasi masih fail-closed?
4. `tsc`, `eslint`, dan `build` hijau?
5. Smoke test empat endpoint jalan?
6. Tidak ada kolom baru yang ikut bocor ke payload publik?
7. `node moderation-service/verify-model.mjs` masih lewat?
8. `MODERATION_TIMEOUT_MS` masih di bawah `maxDuration` route?
9. Kalau menyentuh service moderasi: sudah `systemctl restart qrhunt-moderation`
   dan cek `curl localhost:8787/health`? Service yang berjalan dari
   `/opt/qrhunt-moderation`, bukan langsung dari repo.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
