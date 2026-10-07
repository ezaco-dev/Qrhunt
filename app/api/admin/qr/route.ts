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
  group_name: z.string().trim().max(120).optional(),
  count: z.number().int().min(1).max(100).optional(),
});

const DEFAULT_TEXT =
  "Selamat datang! Media untuk QR ini belum dipasang. " +
  "Silakan pasang foto, video, atau teks Anda di sini.";

export async function GET(): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Tidak punya akses." }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdminClient();
    let { data, error } = await supabase
      .from("qr_medias")
      .select("id, qr_code_id, media_type, created_at, updated_at, is_hidden, is_disabled, admin_label, admin_group_name")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error?.code === "PGRST204") {
      const retry = await supabase
        .from("qr_medias")
        .select("id, qr_code_id, media_type, created_at, updated_at, is_hidden")
        .order("created_at", { ascending: false })
        .limit(500);
      data = (retry.data ?? []).map((row) => ({
        ...row,
        is_disabled: false,
        admin_label: null,
        admin_group_name: null,
      }));
      error = retry.error;
    }

    if (error) throw error;
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/admin/qr] gagal list:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Gagal membaca daftar QR." }, { status: 500 });
  }
}

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

  const count = parsed.data.count ?? 1;
  if (parsed.data.qr_code_id && count > 1) {
    return NextResponse.json(
      { ok: false, error: "ID manual hanya boleh dipakai untuk 1 QR." },
      { status: 400 },
    );
  }

  const groupName = parsed.data.group_name || null;

  let supabase;
  try {
    supabase = getSupabaseAdminClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Env Supabase belum terkonfigurasi." },
      { status: 503 },
    );
  }

  const rows = Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    qr_code_id: parsed.data.qr_code_id || `qr_${crypto.randomBytes(6).toString("hex")}`,
    media_type: "text",
    text_content: DEFAULT_TEXT,
    admin_label: parsed.data.label || null,
    admin_group_name: groupName,
  }));

  let { data, error } = await supabase
    .from("qr_medias")
    .insert(rows)
    .select("id, qr_code_id")
    .order("created_at", { ascending: false });

  if (error?.code === "PGRST204") {
    const fallbackRows = rows.map(({ admin_label, admin_group_name, ...row }) => {
      void admin_label;
      void admin_group_name;
      return row;
    });
    const retry = await supabase
      .from("qr_medias")
      .insert(fallbackRows)
      .select("id, qr_code_id")
      .order("created_at", { ascending: false });
    data = retry.data;
    error = retry.error;
  }

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

    console.error("[api/admin/qr] gagal insert:", error);
    return NextResponse.json(
      { ok: false, error: `Gagal membuat QR di database: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    qr_code_id: data?.[0]?.qr_code_id,
    media_id: data?.[0]?.id,
    items: data ?? [],
  });
}
