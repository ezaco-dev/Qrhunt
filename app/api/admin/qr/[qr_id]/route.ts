import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { qrCodeIdSchema } from "@/lib/validation";

export const runtime = "nodejs";

const bodySchema = z.object({
  is_disabled: z.boolean().optional(),
  admin_label: z.string().trim().max(120).nullable().optional(),
  admin_group_name: z.string().trim().max(120).nullable().optional(),
});

export async function PATCH(
  request: Request,
  props: { params: Promise<{ qr_id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Tidak punya akses." }, { status: 401 });
  }

  const { qr_id: rawQrId } = await props.params;
  const qrCodeId = decodeURIComponent(rawQrId);
  const parsedQr = qrCodeIdSchema.safeParse(qrCodeId);
  if (!parsedQr.success) {
    return NextResponse.json({ ok: false, error: "ID QR tidak valid." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body bukan JSON yang valid." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Body tidak valid." },
      { status: 400 },
    );
  }

  const update = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: "Tidak ada perubahan." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("qr_medias")
    .update(update)
    .eq("qr_code_id", parsedQr.data);

  if (error) {
    console.error("[api/admin/qr/[qr_id]] gagal update:", error.message);
    return NextResponse.json({ ok: false, error: "Gagal menyimpan perubahan." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ qr_id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Tidak punya akses." }, { status: 401 });
  }

  const { qr_id: rawQrId } = await props.params;
  const qrCodeId = decodeURIComponent(rawQrId);
  const parsedQr = qrCodeIdSchema.safeParse(qrCodeId);
  if (!parsedQr.success) {
    return NextResponse.json({ ok: false, error: "ID QR tidak valid." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("qr_medias")
    .delete()
    .eq("qr_code_id", parsedQr.data);

  if (error) {
    console.error("[api/admin/qr/[qr_id]] gagal delete:", error.message);
    return NextResponse.json({ ok: false, error: `Gagal menghapus QR: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
