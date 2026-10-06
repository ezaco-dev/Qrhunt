import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { qrCodeIdSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * POST /api/admin/qr
 *
 * Membuat baris baru di `qr_medias` untuk ID QR yang belum dipakai.
 *
 * Kenapa baris perlu dibuat di sini, bukan menunggu unggahan pertama:
 * admin membuat QR untuk ditempel SEBELUM ada media. Tanpa baris, halaman
 * publik `/q/<id>` membalas 404 padahal QR-nya sah, dan admin tidak punya cara
 * memeriksa bahwa QR yang dicetak itu benar-benar akan bekerja.
 *
 * Keamanan:
 *   - Hanya sesi admin yang boleh membuat baris. Tidak ada jalur tulis lain
 *     yang membaca request ini.
 *   - `qr_code_id` divalidasi dengan `qrCodeIdSchema`, skema yang sama dengan
 *     halaman publik dan `/api/upload`, supaya tidak ada ID yang lolos di satu
 *     tempat tapi ditolak di tempat lain.
 *
 * Media awalnya berupa teks sambutan, jadi QR yang baru dicetak tidak menampilkan
 * halaman kosong dan pemilik tempat bisa langsung menggantinya.
 */
const bodySchema = z.object({
  qr_code_id: qrCodeIdSchema,
  label: z.string().trim().max(120).optional(),
});

const DEFAULT_TEXT =
  "Selamat datang! Media untuk QR ini belum dipasang. " +
  "Silakan pasang foto, video, atau teks Anda di sini.";

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json(
      { ok: false, error: "Tidak punya akses. Login dulu di /admin/login." },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body bukan JSON yang valid." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "ID QR tidak valid.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  const { qr_code_id: qrCodeId, label } = parsed.data;

  let supabase;
  try {
    supabase = getSupabaseAdminClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Env Supabase belum terkonfigurasi." },
      { status: 503 },
    );
  }

  // `label` hanya catatan admin dan tabel tidak punya kolom itu, jadi untuk
  // sekarang tidak disimpan. Kalau nanti dibutuhkan, tambahkan kolomnya di
  // schema.sql dan jalankan migrasi — jangan selipkan ke kolom lain.
  void label;

  const { error } = await supabase.from("qr_medias").insert({
    qr_code_id: qrCodeId,
    media_type: "text",
    text_content: DEFAULT_TEXT,
  });

  if (error) {
    // 23505 = unique_violation. Pesan khusus supaya admin tahu ID-nya sudah
    // dipakai, bukan mengira ini error sistem.
    if (error.code === "23505") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "ID QR ini sudah dipakai. Pilih ID lain atau buka halaman publiknya.",
        },
        { status: 409 },
      );
    }

    console.error("[api/admin/qr] gagal insert:", error.message);
    return NextResponse.json(
      { ok: false, error: "Gagal membuat QR di database." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, qr_code_id: qrCodeId });
}
