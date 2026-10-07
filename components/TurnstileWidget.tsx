"use client";

import { ShieldAlertIcon } from "lucide-react";
import { Turnstile } from "@marsidev/react-turnstile";

import { PLACEHOLDER_TOKEN } from "@/lib/turnstile-shared";

/**
 * Widget anti-bot Cloudflare Turnstile.
 *
 * Dua mode, dipilih oleh keberadaan `NEXT_PUBLIC_TURNSTILE_SITE_KEY`:
 *
 *  1. TANPA site key → tidak ada skrip pihak ketiga yang dimuat. Widget
 *     menampilkan penjelasan, dan yang dikirim adalah `PLACEHOLDER_TOKEN`.
 *     Server menerima token itu HANYA kalau `TURNSTILE_SECRET_KEY` juga kosong
 *     (mode placeholder). Kalau secret terisi sementara site key tidak, unggahan
 *     ditolak — memang begitu, dan itu dorongan untuk mengaktifkan.
 *
 *  2. DENGAN site key → widget asli dimuat dan token asli dikirim.
 *
 * ⚠️ Perhatikan pasangan env ini. `TURNSTILE_SECRET_KEY` terisi tapi site key
 * tidak = SEMUA unggahan ditolak 403, karena server memverifikasi token
 * placeholder terhadap secret sungguhan. Dan sebaliknya: site key terisi tapi
 * secret kosong = widget menampilkan tantangan, sementara server menerima apa pun,
 * jadi proteksi botnya tidak ada. Keduanya harus diisi bersamaan.
 *
 * `verifyTurnstileToken` di `lib/turnstile.ts` TIDAK diubah — ia sudah menerima
 * token asli maupun placeholder.
 */

export interface TurnstileWidgetProps {
  /**
   * Menerima token asli dari widget.
   *
   * Dalam mode placeholder, `onToken` TIDAK dipanggil: `MediaUploader`
   * memakai `PLACEHOLDER_TOKEN` sampai site key tersedia.
   */
  onToken?: (token: string) => void;

  /**
   * Dipanggil saat widget gagal memberi token: error, timeout, atau expire.
   *
   * Tanpa ini kegagalan widget tersembunyi (widget sendiri bisa memakai
   * `appearance: "interaction-only"` sehingga tidak terlihat), dan tombol
   * unggah terkunci selamanya tanpa pesan apa pun.
   */
  onFailure?: () => void;
}

export function TurnstileWidget({ onToken, onFailure }: TurnstileWidgetProps) {
  // Mode development: Turnstile dilewati otomatis supaya dev server lokal
  // bisa dicoba tanpa terhalang widget / pembatasan domain Cloudflare.
  if (process.env.NODE_ENV === "development") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-dashed border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          Mode Development: anti-bot Turnstile dilewati otomatis di localhost.
        </span>
      </div>
    );
  }

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  if (!siteKey) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          Anti-bot Turnstile belum diaktifkan. Isi{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            NEXT_PUBLIC_TURNSTILE_SITE_KEY
          </code>{" "}
          untuk memuat widget sungguhan. Saat ini server menerima token
          placeholder.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* `appearance: "interaction-only"` menyembunyikan widget sampai
          Cloudflare memutuskan interaksi diperlukan, sehingga tidak menambah
          tinggi layout dan tidak mengganggu di halaman yang belum butuh.

          Sengaja TIDAK memakai `execution: "execute"` + `execute()` manual.
          Token Turnstile hanya berlaku sekali dan kedaluwarsa sekitar 5 menit;
          pemicu manual yang gagal dipanggil membuat tombol unggah terkunci
          selamanya karena `onToken` tidak pernah datang. Mode otomatis tidak
          punya kegagalan itu. */}
      <Turnstile
        siteKey={siteKey}
        options={{ appearance: "interaction-only" }}
        onSuccess={onToken}
        onError={onFailure}
        onTimeout={onFailure}
        onExpire={onFailure}
      />
      <p className="text-xs text-muted-foreground">
        Token asli dikirim otomatis setelah widget terpecahkan. Kalau widget
        tidak muncul, yang terkirim adalah{" "}
        <code className="rounded bg-muted px-1 py-0.5">{PLACEHOLDER_TOKEN}</code>{" "}
        dan server akan menolaknya.
      </p>
    </div>
  );
}