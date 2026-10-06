# QrHunt

**Berbagi media anonim lewat satu QR code.**

Tempel satu QR code di meja UMKM. Siapa pun yang memindainya melihat **satu
media aktif**: gambar, GIF, video pendek (maks 10 detik), atau teks. Siapa pun
bisa **menggantinya secara anonim** — tanpa login, tanpa pendaftaran. Kode QR itu
sendiri yang berperan sebagai "password".

Media lama otomatis dihapus dari Cloudinary begitu media baru tersimpan, jadi satu
`qr_code_id` benar-benar hanya punya satu media aktif.

---

## Cara kerja

```
Scan QR  →  lihat media  →  ganti sendiri kapan saja
                              (tanpa akun, tanpa pendaftaran)
```

Ketika media baru berhasil disimpan, media lama dihapus. Kalau ada kegagalan di
tengah, QR tidak pernah berakhir dalam keadaan kosong.

---

## Moderasi

Dua lapis, dan hanya satu yang benar-benar menentukan:

| Lapis | Tujuan | Bisa dilewati? | Kalau gagal |
| ----- | ----- | -------------- | ------------- |
| NSFWJS (browser) | sebelum kirim | **ya** | unggahan ditolak |
| NSFWJS (server, di VPS) | setelah diterima | **tidak** | **503, unggahan ditolak** |

Pemeriksaan browser bisa dilewati dengan mengedit Client Component; itu diterima
secara desain. Gunanya hanya UX dan penghematan kuota. Karena itu server
memeriksa ulang dan **fail-closed**: kalau moderasi tidak tersedia, unggahan
ditolak, bukan lolos.

Laporan yang cukup banyak membuat media otomatis tersembunyi, dihitung secara
atomik di dalam database.

### Layanan moderasi

Server tidak memakai API pihak ketiga. Model NSFWJS yang sama dengan yang
dipakai di browser dijalankan di VPS sebagai layanan HTTP terpisah
(`moderation-service/`), memakai ffmpeg untuk mengekstrak frame dari gambar,
GIF, dan video.

Penggunaannya:

```bash
sudo -u qrhunt npm install --omit=dev   # di moderation-service/
MODERATION_API_KEY=<rahasia> node server.mjs
```

Dua aturan yang tidak boleh dilanggar:

- **Service hanya mendengar di `127.0.0.1`.** Caddy yang menghadap internet
  meneruskannya lewat TLS. Moderasi **tidak** memakai device gate
  (`ged_device`) seperti layanan lain di VPS ini: server Vercel tidak punya
  trust cookie, jadi device gate akan memblokir semua traffic moderasi.
- **Kunci wajib, dibandingkan dengan waktu tetap.** Tanpa kunci yang benar,
  jawabannya 401 sebelum body dibaca.

Aplikasi memanggilnya lewat `MODERATION_SERVICE_URL`, yang wajib `https://`
kecuali menunjuk ke loopback.

Karena domain ini tidak punya wildcard DNS, layanan tidak dijangkau lewat
subdomain melainkan langsung ke IP VPS:

```
https://103.210.69.31   <- Caddy memakai sertifikat self-signed khusus IP
```

Sertifikatnya ada di `/etc/caddy/certs/qrhunt-ip.crt` (key `qrhunt-ip.key`,
640 `caddy:caddy`) dan dibuat dengan SAN tipe IP:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
  -keyout /etc/caddy/certs/qrhunt-ip.key \
  -out /etc/caddy/certs/qrhunt-ip.crt \
  -subj "/CN=103.210.69.31/O=QrHunt Moderation" \
  -addext "subjectAltName=IP:103.210.69.31"
```

Karena self-signed, sertifikat itu tidak ada di trust store mana pun. Aplikasi
mem-pin-nya lewat `MODERATION_CA_PEM` (isi base64 satu baris dari
`qrhunt-ip.crt`), dan menolak https non-loopback tanpa pin itu. Ganti sertifikat
di VPS berarti mengganti `MODERATION_CA_PEM` di Vercel juga, kalau tidak semua
unggahan gagal 503 — fail-closed, bukan lolos.

---

## Halaman admin

`/admin` untuk membuat QR code yang siap dicetak; `/admin/login` untuk masuk.
Masih development: satu password di `ADMIN_PASSWORD`, satu cookie sesi httpOnly
yang ditandatangani HMAC dengan `ADMIN_SESSION_SECRET` (12 jam).

- Tanpa sesi, `/admin` redirect ke `/admin/login` — tidak ada HTML admin yang
  bocor ke browser tanpa cookie yang sah.
- `/api/admin/qr` adalah satu-satunya jalur tulis admin; ia memvalidasi ID dengan
  `qrCodeIdSchema`, skema yang sama dengan halaman publik, dan membalas 409 bila
  ID sudah dipakai.
- Membuat QR artinya membuat baris `qr_medias` berisi teks sambutan, supaya
  `/q/<id>` tidak 404 ketika QR sudah dicetak tapi medianya belum dipasang.
- PNG QR dibuat di browser (`qrcode`), jadi tidak ada berkas gambar yang lewat
  server. Cetak lewat tombol Cetak, atau unduh PNG-nya.

---

## Menjalankan

```bash
npm install
cp .env.example .env.local     # isi minimal NEXT_PUBLIC_SUPABASE_URL
                                # dan SUPABASE_SERVICE_ROLE_KEY
```

Lalu jalankan `schema.sql` di SQL Editor Supabase. Setelah itu:

```bash
npm run dev
```

Buka <http://localhost:3000>. Contoh QR yang sudah terisi: `/q/UMKM_001`.

Tanpa env, aplikasi tetap berjalan dalam **mode fail-safe**: landing page
normal, halaman QR menampilkan petunjuk setup, dan unggahan ditolak dengan
pesan yang jelas.

---

## Environment variables

| Variabel | Wajib | Rahasia? | Fungsi |
| -------- | ----- | -------- | ------ |
| `NEXT_PUBLIC_SUPABASE_URL` | ya | tidak | alamat database |
| `SUPABASE_SERVICE_ROLE_KEY` | ya | **ya** | menulis ke database |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | tidak | tidak | baca RLS (belum dipakai) |
| `CLOUDINARY_URL` | untuk file | **ya** | simpan & hapus media |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | alternatif | `_API_SECRET` **ya** | sama seperti di atas |
| `MODERATION_SERVICE_URL` | untuk moderasi | tidak | alamat layanan moderasi di VPS |
| `MODERATION_API_KEY` | untuk moderasi | **ya** | kunci panggil layanan moderasi |
| `MODERATION_CA_PEM` | untuk https non-loopback | tidak | pin sertifikat self-signed layanan moderasi |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | tidak | tidak | tampilkan widget anti-bot |
| `TURNSTILE_SECRET_KEY` | tidak | **ya** | verifikasi anti-bot |
| `ADMIN_PASSWORD` | untuk /admin | **ya** | password login admin |
| `ADMIN_SESSION_SECRET` | untuk /admin | **ya** | kunci HMAC cookie sesi admin |

Nilai opsional: `MODERATION_TIMEOUT_MS` (45000), `MODERATION_THRESHOLD` (0.6),
`NEXT_PUBLIC_AD_DURATION_SECONDS` (8), `NEXT_PUBLIC_NSFW_THRESHOLD` (0.6),
`REPORT_HIDE_THRESHOLD` (3).

`MODERATION_TIMEOUT_MS` harus lebih kecil dari `maxDuration` route
(60 detik di `app/api/upload/route.ts`). Nilai bawaan Vercel untuk durasi fungsi
saat ini **300 detik**, bukan 10 detik seperti catatan lama.

Aturan: prefix `NEXT_PUBLIC_` berarti nilainya **masuk ke bundle browser**. Tidak
pernah pakai prefix itu pada secret.

---

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS v4 · shadcn/ui di atas
**Base UI** · Zod 4 · Supabase · Cloudinary · NSFWJS + TensorFlow.js · ffmpeg

---

## Verifikasi

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # regresi parseCloudinaryUrl (25 kasus)
npm run build        # next build
```

---

## Dokumentasi

- **`AGENTS.md`** — aturan kerja, jebakan teknis, dan batasan yang diketahui.
  Baca sebelum mengubah kode.
- **`CLAUDE.md`** — hanya berisi `@AGENTS.md`, untuk agent yang mencari berkas
  itu.
- **`schema.sql`** — skema, RLS, dan RPC. Wajib dijalankan di SQL Editor Supabase.

Dua hal yang paling sering jadi sumber bug:

- Model NSFWJS adalah format Keras dan harus dimuat dengan `type: "layers"`.
  Format `type: "graph"` gagal dengan
  `Cannot read properties of undefined (reading 'producer')`.
- Impor NSFWJS dari `nsfwjs/core`, bukan `nsfwjs`. Entri yang kedua menarik model
  sebagai base64 ke dalam bundle dan membuat webpack gagal build.

## Lisensi

MIT