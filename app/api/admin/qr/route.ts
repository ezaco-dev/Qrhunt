import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { qrCodeIdSchema } from "@/lib/validation";

export const runtime = "nodejs";

const bodySchema = z.object({
  qr_code_id: qrCodeIdSchema.optional(),
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

  let payload: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      payload = JSON.parse(text);
    }
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

  // Generate QR ID super unik jika tidak dikirim dari client
  const qrCodeId =
    parsed.data.qr_code_id ||
    `qr_${crypto.randomBytes(6).toString("hex")}`;
  const mediaId = crypto.randomUUID();

  let supabase;
  try {
    supabase = getSupabaseAdminClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Env Supabase belum terkonfigurasi." },
      { status: 503 },
    );
  }

  const { data, error } = await supabase
    .from("qr_medias")
    .insert({
      id: mediaId,
      qr_code_id: qrCodeId,
      media_type: "text",
      text_content: DEFAULT_TEXT,
    })
    .select("id, qr_code_id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "ID QR ini sudah dipakai. Silakan coba klik generate lagi.",
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

  return NextResponse.json({
    ok: true,
    qr_code_id: data.qr_code_id,
    media_id: data.id,
  });
}
