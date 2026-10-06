import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";

import type { QrMedia } from "@/lib/types";

/** Bentuk baris tabel `public.qr_medias` untuk select ter-typing. */
export type QrMediaRow = Pick<
  QrMedia,
  | "id"
  | "qr_code_id"
  | "media_type"
  | "media_url"
  | "text_content"
  | "report_count"
  | "is_hidden"
  | "created_at"
  | "updated_at"
>;

/** Dilempar bila env yang dibutuhkan belum diisi. */
export class MissingEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingEnvError";
  }
}

/**
 * Guard anti-bocor secret.
 *
 * Dipanggil oleh modul server-only (`lib/cloudinary.ts`, `lib/moderation.ts`,
 * `lib/turnstile.ts`) sehingga sekiranya ada yang salah import ke Client
 * Component, aplikasi GAGAT dengan pesan jelas — bukan diam-diam membocorkan
 * `SUPABASE_SERVICE_ROLE_KEY` ke bundle browser.
 */
export function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "Modul server-only (lib/supabase.ts, lib/cloudinary.ts, " +
        "lib/moderation.ts, lib/turnstile.ts) tidak boleh dieksekusi di browser. " +
        "Secret tidak boleh masuk ke client bundle.",
    );
  }
}

/**
 * Nonaktifkan segalanya yang terkait sesi.
 *
 * QrHunt sengaja tidak punya konsep user: tidak ada tabel user, tidak ada
 * cookie sesi, tidak ada `@supabase/ssr`. Klien di sini hanya dipakai sebagai
 * transport untuk operasi anonim, jadi setiap bentuk penyimpanan token adalah
 * permukaan serang yang tidak perlu ada.
 */
const NO_SESSION: NonNullable<SupabaseClientOptions<"public">["auth"]> = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

// Cache per-process. Membuat koneksi Supabase baru tiap request itu mahal; di
// lingkungan serverless, pooling sudah ditangani platform.
let browserClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

/**
 * Klien ANON (RLS read) untuk browser.
 *
 * ⚠️ DEAD CODE — tidak ada komponen yang memakainya. Halaman QR dibaca lewat
 * Server Component (`lib/media.ts`), jadi tidak ada kebutuhan browser bicara
 * langsung ke Supabase.
 *
 * Dipertahankan sebagai infrastruktur baca RLS: kalau nanti UI butuh live
 * read (mis. polling jumlah laporan), fungsinya sudah tersedia dan aman.
 * Hapus bila dipastikan tidak akan dipakai.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = readPublishableKey();

  if (!url || !publishableKey) {
    throw new MissingEnvError(
      "NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY belum diisi. " +
        "Salin .env.example ke .env.local lalu isi nilainya.",
    );
  }

  browserClient = createClient(url, publishableKey, { auth: NO_SESSION });
  return browserClient;
}

/**
 * Klien SERVICE-ROLE untuk operasi tulis (route handler saja).
 *
 * Service role MEMBYPASS RLS — ini by design, bukan kebocoran:
 *  - Semua tulis sudah divalidasi Zod + dimoderasi di route sebelum masuk.
 *  - Database tidak pernah memberi hak tulis ke anon (lihat `schema.sql`).
 *  - Kunci ini tidak boleh sampai ke browser — lihat `assertServerOnly()`.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  assertServerOnly();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new MissingEnvError(
      "NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum diisi. " +
        "Salin .env.example ke .env.local lalu isi nilainya.",
    );
  }

  adminClient = createClient(url, serviceRoleKey, {
    auth: NO_SESSION,
    global: {
      headers: {
        // Kirim service-role sebagai apiKey, bukan anon key.
        apikey: serviceRoleKey,
      },
    },
  });

  return adminClient;
}

/**
 * Baca kunci publishable dari env, menerima kedua penamaan.
 *
 * Dashboard Supabase terbaru menabul kunci sebagai
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`), sementara
 * proyek lama memakai `NEXT_PUBLIC_SUPABASE_ANON_KEY` (JWT `anon`). Keduanya
 * peran yang sama — kunci publik yang dibaca browser dan tunduk pada RLS — jadi
 * keduanya diterima agar repo ini tidak rusak saat dashboard berubah.
 *
 * Keduanya aman dibaca browser. Yang TIDAK boleh ikut ke sini adalah secret key
 * (`sb_secret_...`): perannya seperti service role, melewati RLS.
 */
function readPublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** True bila env admin sudah lengkap — dipakai halaman publik untuk gating. */
export function isSupabaseAdminConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}