import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { assertServerOnly } from "@/lib/supabase";

// Modul ini memegang ADMIN_PASSWORD dan ADMIN_SESSION_SECRET. Tidak boleh
// sampai ke browser.
assertServerOnly();

/**
 * Autentikasi admin, sengaja dibuat sederhana.
 *
 * Ini masih tahap development: satu password di env, satu cookie httpOnly.
 * Belum ada multi-user, belum ada rate limit khusus, belum ada audit log.
 * Kalau nanti dibutuhkan, modul ini satu-satunya tempat yang perlu diubah.
 *
 * Kontrak yang dijaga:
 *
 * 1. Secret tidak bocor. `ADMIN_PASSWORD` dan `ADMIN_SESSION_SECRET` hanya
 *    dipakai di sini. Yang sampai ke browser hanya sinyal "sudah login".
 *
 * 2. Cookie tidak bisa dipalsukan. Token di cookie adalah HMAC dari payload
 *    tetap dengan kunci `ADMIN_SESSION_SECRET`. Tanpa secret itu, siapa pun
 *    bisa menulis cookie bebas dan masuk.
 *
 * 3. Perbandingan selalu waktu-tetap. Membandingkan string dengan `===`
 *    menghabiskan waktu sebanding dengan jumlah karakter yang cocok, jadi
 *    bisa diukur dari luar. `timingSafeEqual` tidak punya pola seperti itu.
 */

export const ADMIN_COOKIE_NAME = "qrhunt_admin";
/** 12 jam dalam detik. */
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

/** Payload yang ditandatangani. Sengaja tetap supaya token sederhana. */
const SESSION_PAYLOAD = "admin-v1";

function getAdminPassword(): string {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      "ADMIN_PASSWORD belum diisi. Tanpa itu, siapa pun yang tahu URL /admin " +
        "bisa masuk tanpa otentikasi.",
    );
  }
  return value;
}

function getSessionSecret(): string {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value) {
    throw new Error(
      "ADMIN_SESSION_SECRET belum diisi. Cookie sesi admin bisa dipalsukan " +
        "tanpa itu.",
    );
  }
  return value;
}

/** HMAC-SHA256 dalam hex. Dipakai untuk membuat dan memverifikasi token. */
function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

/** Buat token sesi baru. */
export function createAdminToken(): string {
  return sign(SESSION_PAYLOAD, getSessionSecret());
}

/**
 * Verifikasi token dari cookie.
 *
 * Token yang benar persis sama dengan HMAC yang baru dibuat dari secret yang
 * sekarang. Mengganti `ADMIN_SESSION_SECRET` berarti semua sesi lama langsung
 * batal — itu perilaku yang diinginkan, bukan kebetulan.
 */
export function verifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const expected = createAdminToken();
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Baca cookie sesi dan verifikasi.
 *
 * `cookies()` di Next 16 adalah async, jadi harus di-`await`.
 */
export async function isAdminAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminToken(store.get(ADMIN_COOKIE_NAME)?.value);
}

/**
 * Bandingkan password yang dikirim dengan yang di env, waktu-tetap.
 *
 * Mengembalikan false juga bila kandidat kosong, jadi env yang lupa diisi
 * tidak pernah berarti "terima semua password".
 */
export function checkAdminPassword(candidate: string): boolean {
  if (!candidate) return false;
  const expected = getAdminPassword();
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");

  // Panjang yang beda tidak bisa dibandingkan timingSafeEqual (ia melempar
  // error). Untuk kasus itu, jalankan pembandingan dummy dulu supaya waktu
  // respons password salah panjang dan salah pendek tetap mirip, baru pulang.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }

  return timingSafeEqual(a, b);
}
