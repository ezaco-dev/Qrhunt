import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  checkAdminPassword,
  createAdminToken,
} from "@/lib/admin-auth";
import { isSupabaseAdminConfigured } from "@/lib/supabase";

/**
 * POST /api/admin/login
 *
 * Body JSON: { "password": "..." }
 *
 * Membandingkan password dengan waktu tetap, lalu menaruh token HMAC di cookie
 * httpOnly. Sengaja tidak mengirim apa pun selain status: tidak ada pesan yang
 * membedakan "password salah" dari "user salah", karena hanya ada satu user.
 */
const bodySchema = z.object({ password: z.string().min(1).max(256) });

export async function POST(request: Request): Promise<NextResponse> {
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
    return NextResponse.json(
      { ok: false, error: "Password wajib diisi." },
      { status: 400 },
    );
  }

  // Env kosong berarti setup belum selesai. Jangan biarkan login "berhasil"
  // dengan password apa pun hanya karena env belum diisi.
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Env belum terkonfigurasi." },
      { status: 503 },
    );
  }

  if (!checkAdminPassword(parsed.data.password)) {
    return NextResponse.json(
      { ok: false, error: "Password salah." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: createAdminToken(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
  return response;
}
