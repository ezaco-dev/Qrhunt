import { NextResponse } from "next/server";

import {
  destroyFromCloudinary,
  parseCloudinaryUrl,
  uploadToCloudinary,
} from "@/lib/cloudinary";
import { moderateMedia } from "@/lib/moderation";
import { getSupabaseAdminClient, type QrMediaRow } from "@/lib/supabase";
import { verifyTurnstileToken } from "@/lib/turnstile";
import type { ApiResult, MediaType } from "@/lib/types";
import { uploadFormSchema, validateMediaFile } from "@/lib/validation";

// Streaming/buffer penuh butuh runtime Node, bukan Edge.
export const runtime = "nodejs";

// Unggah + moderasi + penghapusan aset lama punya batas waktu nyata.
export const maxDuration = 60;

interface UploadSuccessData {
  qrCodeId: string;
  mediaType: MediaType;
  mediaUrl: string | null;
  textContent: string | null;
}

/** Membantu membangun respons error yang konsisten. */
function fail(
  status: number,
  error: string,
  code: string,
): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>({ ok: false, error, code }, { status });
}

/**
 * Ambil IP klien dari header proxy.
 *
 * Dipakai sebagai `remoteip` untuk Turnstile. Nilai ini tidak dipercaya untuk
 * keputusan keamanan apa pun; hanya diteruskan ke Cloudflare agar penilaian
 * risiko mereka lebih akurat.
 */
function extractClientIp(request: Request): string | undefined {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // `X-Forwarded-For` bisa berisi rantai proxy; yang pertama adalah klien.
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? undefined;
}

/**
 * `POST /api/upload` — jalur tulis utama.
 *
 * URUTAN DI BAWAH ADALAH KONTRAK, BUKAN GAYA PENULISAN. Jangan menata ulang.
 * Setiap langkah bergantung pada hasil langkah sebelumnya, dan urutan ini yang
 * membuat kegagalan di tengah tidak pernah meninggalkan QR dalam keadaan kosong
 * atau setengah tertulis.
 */
export async function POST(request: Request) {
  // (1) Parse multipart.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Permintaan harus berupa multipart/form-data.", "validation");
  }

  const fileValue = form.get("file");
  const file =
    fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

  // (2) Validasi bentuk form dengan Zod.
  const rawText = form.get("textContent");
  const rawDuration = form.get("durationSeconds");

  const parsed = uploadFormSchema.safeParse({
    qrCodeId: form.get("qrCodeId"),
    mediaType: form.get("mediaType"),
    textContent: typeof rawText === "string" ? rawText : undefined,
    durationSeconds:
      typeof rawDuration === "string" && rawDuration.length > 0
        ? Number(rawDuration)
        : undefined,
  });

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return fail(
      400,
      firstIssue?.message ?? "Data tidak valid.",
      "validation",
    );
  }

  const { qrCodeId, mediaType } = parsed.data;
  const textContent = parsed.data.textContent?.trim() ?? "";

  // (3) Validasi berkas. Dipakai client juga, tapi ini yang menentukan.
  if (mediaType !== "text") {
    if (!file) {
      return fail(400, "Tidak ada berkas yang dikirim.", "missing-file");
    }

    const durationSeconds =
      typeof parsed.data.durationSeconds === "number"
        ? parsed.data.durationSeconds
        : undefined;

    const fileValidation = validateMediaFile(file, mediaType, durationSeconds);
    if (!fileValidation.ok) {
      return fail(400, fileValidation.error ?? "Berkas tidak valid.", "invalid-file");
    }
  }

  // (4) Anti-bot.
  const tokenValue = form.get("turnstileToken");
  const turnstile = await verifyTurnstileToken(
    typeof tokenValue === "string" ? tokenValue : null,
    extractClientIp(request),
  );

  if (!turnstile.success) {
    return fail(
      403,
      "Verifikasi anti-bot gagal. Muat ulang halaman lalu coba lagi.",
      "turnstile",
    );
  }

  // (4.5) Rate limit per QR.
  //
  // Setelah mengganti media, user ditendang dari QR itu. Baru bisa lagi
  // setelah 3 orang lain sudah ganti, ATAU 5 jam berlalu. Ini mencegah
  // satu orang mengunci QR dengan mengganti terus-menerus.
  //
  // Pengecekan di sini, SEBELUM moderasi dan upload, supaya request yang
  // ditolak tidak membuang kuota moderasi dan Cloudinary.
  const uploaderIp = extractClientIp(request) ?? "unknown";
  const RATE_LIMIT_HOURS = 5;
  const RATE_LIMIT_UNIQUE_UPLOADERS = 3;

  try {
    const rateCheckDb = getSupabaseAdminClient();
    const { data: existing } = await rateCheckDb
      .from("qr_medias")
      .select("last_uploader_ip, unique_uploaders_since, updated_at")
      .eq("qr_code_id", qrCodeId)
      .maybeSingle();

    if (existing?.last_uploader_ip === uploaderIp) {
      const hoursSinceLastUpload =
        (Date.now() - new Date(existing.updated_at).getTime()) / (1000 * 60 * 60);
      const uniqueUploaders = existing.unique_uploaders_since ?? 0;

      if (
        hoursSinceLastUpload < RATE_LIMIT_HOURS &&
        uniqueUploaders < RATE_LIMIT_UNIQUE_UPLOADERS
      ) {
        const hoursLeft = Math.ceil(RATE_LIMIT_HOURS - hoursSinceLastUpload);
        return fail(
          429,
          `Anda baru saja mengganti media ini. Tunggu ${hoursLeft} jam lagi, ` +
            `atau sampai ${RATE_LIMIT_UNIQUE_UPLOADERS - uniqueUploaders} orang lain mengganti.`,
          "rate-limited",
        );
      }
    }
  } catch {
    // Kegagalan pengecekan rate limit TIDAK boleh memblokir upload.
    // Lebih baik lolos sekali daripada menolak upload yang sah.
  }

  // (5) Moderasi server. Ini SUMBER KEBENARAN — semua langkah sebelumnya hanya UX.
  //
  // Fail-closed: kalau layanan moderasi tidak tersedia, jawabannya 503, bukan
  // "lolos saja". Melewatkan moderasi karena API sedang down berarti seluruh
  // tujuan filter hilang seketika tanpa jejak.
  if (mediaType !== "text") {
    if (!file) {
      return fail(400, "Tidak ada berkas yang dikirim.", "missing-file");
    }

    let moderation;
    try {
      moderation = await moderateMedia(file);
    } catch (err) {
      console.error(
        "[api/upload] moderasi gagal (fail-closed):",
        err instanceof Error ? err.message : err,
      );
      return fail(
        503,
        "Moderasi sedang tidak tersedia. Coba lagi sebentar lagi.",
        "moderation-unavailable",
      );
    }

    if (moderation.isExplicit) {
      return fail(
        422,
        moderation.reason ||
          "Konten ditolak oleh moderasi otomatis.",
        "moderation-rejected",
      );
    }
  }

  // (6) Klien database. Env kosong harus jadi pesan bersih, bukan stack trace.
  let supabase;
  try {
    supabase = getSupabaseAdminClient();
  } catch (err) {
    console.error(
      "[api/upload] konfigurasi Supabase belum lengkap:",
      err instanceof Error ? err.message : err,
    );
    return fail(
      500,
      "Server belum dikonfigurasi. Isi .env.local lalu jalankan schema.sql.",
      "config",
    );
  }

  // Baca media LAMA untuk retention. Kegagalan di sini TIDAK membatalkan
  // request: tanpa media lama, hal yang lebih penting (media baru tersimpan)
  // tetap tercapai. Yang hilang hanya penghematan kuota.
  let previous: QrMediaRow | null = null;
  try {
    const { data, error } = await supabase
      .from("qr_medias")
      .select("id, media_url, media_type")
      .eq("qr_code_id", qrCodeId)
      .maybeSingle();

    if (error) {
      console.warn(
        `[api/upload] gagal membaca media lama untuk ${qrCodeId}:`,
        error.message,
      );
    } else {
      previous = data as QrMediaRow | null;
    }
  } catch (err) {
    console.warn(
      "[api/upload] exception saat membaca media lama:",
      err instanceof Error ? err.message : err,
    );
  }

  // (7) Unggah ke Cloudinary (kecuali teks, yang tidak punya berkas).
  let newMediaUrl: string | null = null;
  let newPublicId: string | null = null;
  let newResourceType: string | null = null;

  if (mediaType !== "text") {
    if (!file) {
      return fail(400, "Tidak ada berkas yang dikirim.", "missing-file");
    }

    const cloudinaryResourceType =
      mediaType === "video" ? "video" : mediaType === "gif" ? "image" : "image";

    let uploaded;
    try {
      uploaded = await uploadToCloudinary(file, qrCodeId, cloudinaryResourceType);
    } catch (err) {
      console.error(
        "[api/upload] unggah Cloudinary gagal:",
        err instanceof Error ? err.message : err,
      );
      return fail(
        502,
        "Gagal menyimpan berkas. Coba lagi sebentar lagi.",
        "cloudinary",
      );
    }

    newMediaUrl = uploaded.secureUrl;
    newPublicId = uploaded.publicId;
    newResourceType = uploaded.resourceType;
  }

  // (8) Tulis ke database dengan `upsert` pada `qr_code_id`.
  //
  // `upsert` + `onConflict` yang membuat operasi ini idempoten dan bebas race:
  // dua orang menekan "pasang" bersamaan menghasilkan satu baris, bukan dua.
  //
  // `media_url: null` ditulis EKSPLISIT untuk media teks. Kalau nilainya
  // `undefined`, PostgREST tidak akan mengirim kolom itu sama sekali dan baris
  // lama bisa menyisakan `media_url` yang melanggar CHECK
  // `qr_medias_payload_shape`.
  const nowIso = new Date().toISOString();

  // Hitung unique_uploaders_since: kalau IP baru (beda dari terakhir), naikkan
  // counter. Kalau IP sama, reset ke 0.
  let newUniqueUploaders = 0;
  try {
    const prevCheck = getSupabaseAdminClient();
    const { data: prev } = await prevCheck
      .from("qr_medias")
      .select("last_uploader_ip, unique_uploaders_since")
      .eq("qr_code_id", qrCodeId)
      .maybeSingle();

    if (prev && prev.last_uploader_ip !== uploaderIp) {
      newUniqueUploaders = (prev.unique_uploaders_since ?? 0) + 1;
    }
  } catch {
    // Kegagalan tidak boleh memblokir upload.
  }

  const row = {
    qr_code_id: qrCodeId,
    media_type: mediaType,
    media_url: newMediaUrl,
    text_content: mediaType === "text" ? textContent : null,
    report_count: 0,
    is_hidden: false,
    created_at: nowIso,
    updated_at: nowIso,
    last_uploader_ip: uploaderIp,
    unique_uploaders_since: newUniqueUploaders,
  };

  let { error: upsertError } = await supabase
    .from("qr_medias")
    .upsert(row, { onConflict: "qr_code_id" });

  // Kalau kolom `last_uploader_ip` / `unique_uploaders_since` belum ada di DB
  // (karena `ALTER TABLE` belum dijalankan di Supabase), coba upsert ulang
  // tanpa dua kolom rate-limit tersebut agar upload tidak gagal 500.
  if (upsertError && (upsertError.code === "PGRST204" || upsertError.message.includes("column"))) {
    console.warn(
      "[api/upload] Kolom rate-limit belum ada di database (PGRST204). Upsert ulang tanpa rate-limit...",
    );
    const { last_uploader_ip, unique_uploaders_since, ...baseRow } = row;
    void last_uploader_ip;
    void unique_uploaders_since;
    const retry = await supabase
      .from("qr_medias")
      .upsert(baseRow, { onConflict: "qr_code_id" });
    upsertError = retry.error;
  }

  if (upsertError) {
    console.error("[api/upload] gagal menulis ke database:", upsertError.message);

    // Anti-orphan: berkas yang baru diunggah harus ikut dihapus. Kalau tidak,
    // setiap kegagalan tulis meninggalkan file 4 MB yang tidak pernah
    // dirujuk dan menguras kuota Cloudinary.
    if (newPublicId && newResourceType) {
      await destroyFromCloudinary(newPublicId, newResourceType);
    }

    return fail(
      500,
      "Gagal menyimpan media. Coba lagi sebentar lagi.",
      "db-write",
    );
  }

  // (9) Retention — HANYA SETELAH upsert sukses.
  //
  // Urutan ini yang mencegah QR kosong: media baru sudah ada di database
  // sebelum yang lama dihapus, jadi ada jeda singkat dengan dua salinan, bukan
  // ada jeda tanpa media sama sekali.
  if (previous?.media_url && previous.media_url !== newMediaUrl) {
    const parsedOldUrl = parseCloudinaryUrl(previous.media_url);
    if (parsedOldUrl) {
      const removed = await destroyFromCloudinary(
        parsedOldUrl.publicId,
        parsedOldUrl.resourceType,
      );
      if (!removed) {
        // `destroyFromCloudinary` tidak pernah melempar; hasilnya false berarti
        // ada kebocoran kuota, bukan kegagalan request.
        console.warn(
          `[api/upload] media lama ${parsedOldUrl.publicId} belum terhapus; kuota bisa bocor.`,
        );
      }
    } else {
      console.warn(
        `[api/upload] URL lama tidak bisa diparse, dilewati: ${previous.media_url}`,
      );
    }
  }

  // (10) Sukses.
  return NextResponse.json<ApiResult<UploadSuccessData>>({
    ok: true,
    data: {
      qrCodeId,
      mediaType,
      mediaUrl: newMediaUrl,
      textContent: mediaType === "text" ? textContent : null,
    },
  });
}