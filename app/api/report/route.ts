import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase";
import type { ApiResult } from "@/lib/types";
import { getReportHideThreshold, reportRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";

interface ReportSuccessData {
  reportCount: number;
  isHidden: boolean;
}

/** Bantu membangun respons error yang konsisten. */
function fail(
  status: number,
  error: string,
  code: string,
): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>({ ok: false, error, code }, { status });
}

/**
 * `POST /api/report` — menambah jumlah laporan untuk satu QR.
 *
 * Di sini TIDAK ada read-lalu-write.
 *
 * Versi naifnya kira-kira begini: SELECT report_count → tambah satu → UPDATE →
 * kalau `count >= threshold`, set `is_hidden = true`. Dua orang yang melapor
 * pada detik yang sama akan membaca nilai yang sama, menulis nilai yang sama,
 * dan salah satunya hilang. Ambang batasnya pun bisa dilewati.
 *
 * Yang dipanggil di sini hanya satu: `increment_report_count`, sebuah RPC
 * `security definer` yang mengunci baris, menaikkan counter, dan menyalakan
 * `is_hidden` dalam SATU transaksi. Tidak ada pembacaan nilai basi, dan ambang
 * batas ditentukan di dalam SQL, bukan di kode aplikasi, sehingga tidak bisa
 * dilewati lewat permintaan yang dibuat-buat.
 *
 * `execute` pada RPC itu dicabut dari `public`, `anon`, dan `authenticated`;
 * hanya `service_role` yang boleh memanggilnya (lihat `schema.sql`).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Body harus berupa JSON.", "validation");
  }

  const parsed = reportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message ?? "Data tidak valid.", "validation");
  }

  const { qrCodeId } = parsed.data;
  const threshold = getReportHideThreshold();

  let supabase;
  try {
    supabase = getSupabaseAdminClient();
  } catch (err) {
    console.error(
      "[api/report] konfigurasi Supabase belum lengkap:",
      err instanceof Error ? err.message : err,
    );
    return fail(
      500,
      "Server belum dikonfigurasi. Isi .env.local lalu jalankan schema.sql.",
      "config",
    );
  }

  const { data, error } = await supabase.rpc("increment_report_count", {
    p_qr_code_id: qrCodeId,
    p_threshold: threshold,
  });

  if (error) {
    console.error("[api/report] RPC increment_report_count gagal:", error.message);
    return fail(500, "Gagal mencatat laporan. Coba lagi sebentar lagi.", "rpc");
  }

  const rows = Array.isArray(data) ? data : [];
  const row = rows[0] as
    | { new_report_count?: number | null; now_hidden?: boolean | null }
    | undefined;

  // `schema.sql` sudah menyaring baris di dalam query `return query`, jadi QR
  // yang tidak ada menghasilkan nol baris. Pemeriksaan di bawah tetap menjaga
  // kalau skema dijalankan di versi lama atau dimodifikasi: baris dengan
  // `new_report_count` null berarti tidak ada QR yang cocok, dan TIDAK boleh
  // dilaporkan sebagai "laporan berhasil".
  if (!row || typeof row.new_report_count !== "number") {
    // 404 yang sama seperti halaman publik, supaya keberadaan sebuah QR tidak
    // bisa dipetakan lewat respons endpoint ini.
    return fail(404, "QR tidak ditemukan.", "not-found");
  }

  return NextResponse.json<ApiResult<ReportSuccessData>>({
    ok: true,
    data: {
      reportCount: row.new_report_count,
      isHidden: row.now_hidden === true,
    },
  });
}