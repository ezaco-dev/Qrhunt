import { assertServerOnly } from "@/lib/supabase";
import {
  DUMMY_CLOUDFLARE_TOKEN,
  PLACEHOLDER_TOKEN,
} from "@/lib/turnstile-shared";

// Modul ini memegang TURNSTILE_SECRET_KEY — tidak boleh masuk ke browser.
assertServerOnly();

const SITEVERIFY_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Hasil verifikasi token anti-bot. */
export interface TurnstileVerification {
  success: boolean;
  /** True bila ini mode placeholder (secret belum diisi). */
  isPlaceholder: boolean;
  /** Kode alasan saat gagal, untuk logging sisi server. */
  errorCode?: string;
}

/**
 * Daftar token yang dianggap "tidak nyata".
 *
 * HARUS SINKRON dengan nilai di `lib/turnstile-shared.ts` — file itu dibaca
 * Client Component, jadi token yang sama harus hidup di kedua tempat.
 */
const PLACEHOLDER_TOKENS: readonly string[] = [
  PLACEHOLDER_TOKEN,
  DUMMY_CLOUDFLARE_TOKEN,
];

/** True bila kredensial Turnstile tersedia. */
export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/**
 * Verifikasi token Cloudflare Turnstile.
 *
 * Dua mode:
 *
 *  1. PLACEHOLDER — `TURNSTILE_SECRET_KEY` kosong. Hanya token placeholder
 *     yang diterima. Token apa pun yang lain DITOLAK, bukan diterima: kalau
 *     menerima semua token, ada/tidaknya secret sama sekali tidak berarti dan
 *     development bisa terlihat siap produksi.
 *
 *  2. ASLI — POST ke `siteverify`. Error HTTP dan exception sama-sama
 *     gagal (fail-closed): anti-bot yang gagal dinilai tidak boleh menjadi jalan
 *     bypass.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string,
): Promise<TurnstileVerification> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  const submitted = (token ?? "").trim();

  // Mode development: verifikasi anti-bot dilewati otomatis agar testing lokal
  // berjalan lancar tanpa perlu mengurusi Cloudflare Turnstile.
  if (process.env.NODE_ENV === "development") {
    return { success: true, isPlaceholder: true };
  }

  if (!secretKey) {
    if (
      submitted.length === 0 ||
      PLACEHOLDER_TOKENS.includes(submitted)
    ) {
      console.warn(
        "[lib/turnstile] TURNSTILE_SECRET_KEY kosong — verifikasi dilewati. " +
          "JANGAN deploy ke produksi dengan mode ini.",
      );
      return { success: true, isPlaceholder: true };
    }

    console.warn(
      "[lib/turnstile] secret kosong tetapi token yang dikirim bukan placeholder — ditolak.",
    );
    return {
      success: false,
      isPlaceholder: true,
      errorCode: "missing-input-secret",
    };
  }

  if (submitted.length === 0) {
    return { success: false, isPlaceholder: false, errorCode: "missing-input-response" };
  }

  const form = new FormData();
  form.append("secret", secretKey);
  form.append("response", submitted);
  if (remoteIp) form.append("remoteip", remoteIp);

  try {
    const response = await fetch(SITEVERIFY_ENDPOINT, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // Fail-closed: layanan error berarti tidak bisa membuktikan manusia.
      return {
        success: false,
        isPlaceholder: false,
        errorCode: `http-${response.status}`,
      };
    }

    const payload = (await response.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };

    if (payload.success) {
      return { success: true, isPlaceholder: false };
    }

    return {
      success: false,
      isPlaceholder: false,
      errorCode: payload["error-codes"]?.join(",") || "verification-failed",
    };
  } catch (err) {
    // Exception = timeout, DNS gagal, koneksi putus. Tetap fail-closed.
    console.error(
      "[lib/turnstile] kegagalan jaringan saat verifikasi:",
      err instanceof Error ? err.message : err,
    );
    return { success: false, isPlaceholder: false, errorCode: "network-error" };
  }
}