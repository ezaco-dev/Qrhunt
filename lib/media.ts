import { getSupabaseAdminClient, type QrMediaRow } from "@/lib/supabase";
import type { MediaType, PublicQrMedia } from "@/lib/types";

/**
 * Kolom yang boleh dibaca untuk payload publik.
 *
 * `is_hidden` SENGAJA tidak ada di daftar ini.
 */
const PUBLIC_COLUMNS =
  "id, qr_code_id, media_type, media_url, text_content, report_count, created_at, updated_at" as const;

/**
 * Bangun objek payload publik DARI NOL.
 *
 * Jangan pernah memakai spread `{ ...row }` di sini. Kolom baru yang
 * kebetulan sensitif akan otomatis ikut bocor ke HTML. Daftar eksplisit
 * membuat kebocoran seperti itu jadi sesuatu yang terlihat di diff review.
 */
function toPublicQrMedia(row: QrMediaRow): PublicQrMedia {
  return {
    id: row.id,
    qr_code_id: row.qr_code_id,
    media_type: row.media_type as MediaType,
    media_url: row.media_url,
    text_content: row.text_content,
    report_count: row.report_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface QrAccessBlockInfo {
  isBlocked: boolean;
  hoursLeft: number;
  minutesLeft: number;
  uniqueUploadersLeft: number;
}

/**
 * Cek apakah pengguna (berdasarkan IP) ditendang dari QR ini.
 *
 * Pengguna yang baru saja memperbarui QR ditendang dan tidak bisa mengakses
 * halaman QR ini sampai 3 pengguna lain memperbaruinya ATAU 5 jam berlalu.
 */
export async function checkQrAccess(
  qrCodeId: string,
  clientIp: string,
  cookieTimestamp?: number | null,
): Promise<QrAccessBlockInfo> {
  const DEFAULT_ALLOWED: QrAccessBlockInfo = {
    isBlocked: false,
    hoursLeft: 0,
    minutesLeft: 0,
    uniqueUploadersLeft: 0,
  };

  const RATE_LIMIT_HOURS = 5;
  const RATE_LIMIT_UNIQUE_UPLOADERS = 3;

  try {
    const supabase = getSupabaseAdminClient();
    const { data } = await supabase
      .from("qr_medias")
      .select("last_uploader_ip, unique_uploaders_since, updated_at")
      .eq("qr_code_id", qrCodeId)
      .maybeSingle();

    const row = (data ?? {}) as {
      last_uploader_ip?: string | null;
      unique_uploaders_since?: number | null;
      updated_at?: string;
    };

    const uniqueUploaders = row.unique_uploaders_since ?? 0;
    const isLastIp = Boolean(clientIp && clientIp !== "unknown" && row.last_uploader_ip === clientIp);

    // Waktu unggah ditentukan dari DB jika ada, atau dari cookie pengunggah
    let uploadTimeMs: number | null = null;
    if (isLastIp && row.updated_at) {
      uploadTimeMs = new Date(row.updated_at).getTime();
    } else if (cookieTimestamp && Number.isFinite(cookieTimestamp)) {
      uploadTimeMs = cookieTimestamp;
    }

    if (uploadTimeMs && uniqueUploaders < RATE_LIMIT_UNIQUE_UPLOADERS) {
      const diffMs = Date.now() - uploadTimeMs;
      const hoursSinceLastUpload = diffMs / (1000 * 60 * 60);

      if (hoursSinceLastUpload < RATE_LIMIT_HOURS) {
        const totalMinutesLeft = Math.max(
          1,
          Math.ceil((RATE_LIMIT_HOURS * 60 * 60 * 1000 - diffMs) / (1000 * 60)),
        );
        const hoursLeft = Math.floor(totalMinutesLeft / 60);
        const minutesLeft = totalMinutesLeft % 60;
        const uniqueUploadersLeft = RATE_LIMIT_UNIQUE_UPLOADERS - uniqueUploaders;

        return {
          isBlocked: true,
          hoursLeft,
          minutesLeft,
          uniqueUploadersLeft,
        };
      }
    }

    return DEFAULT_ALLOWED;
  } catch {
    return DEFAULT_ALLOWED;
  }
}

/**
 * Baca media aktif untuk satu QR.
 *
 * Memakai service role, bukan anon, supaya pembacaan tidak bergantung pada
 * sesi browser dan baris yang disembunyikan bisa difilter di query.
 *
 * Filter `is_hidden = false` dipakai di DALAM query, bukan sesudahnya: baris
 * yang disembunyikan tidak pernah masuk ke memori server, sehingga tidak ada
 * jalur kode yang bisa kelewat dan membocorkan media tersembunyi.
 *
 * Sengaja TIDAK melempar error. Halaman publik tidak boleh menjadi 500 hanya
 * karena satu query gagal; pemanggil memperlakukan semua kegagalan sama
 * dengan "tidak ada media" dan merender 404.
 */
export async function getActiveMedia(qrCodeId: string): Promise<PublicQrMedia | null> {
  try {
    const supabase = getSupabaseAdminClient();

    const { data, error } = await supabase
      .from("qr_medias")
      .select(PUBLIC_COLUMNS)
      .eq("qr_code_id", qrCodeId)
      .eq("is_hidden", false)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[lib/media] gagal membaca media aktif:", error.message);
      return null;
    }

    if (!data) return null;

    return toPublicQrMedia(data as QrMediaRow);
  } catch (err) {
    // MissingEnvError (env kosong) ditangani sama: halaman publik menampilkan
    // 404 atau SetupNotice, bukan stack trace.
    console.error(
      "[lib/media] exception saat membaca media aktif:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Baca media berdasarkan sub ID (kolom `id`).
 *
 * Memastikan baris tersebut aktif (is_hidden = false) DAN merupakan media
 * aktif paling baru untuk `qr_code_id`-nya.
 */
export async function getMediaBySubId(mediaId: string): Promise<PublicQrMedia | null> {
  try {
    const supabase = getSupabaseAdminClient();

    const { data, error } = await supabase
      .from("qr_medias")
      .select(PUBLIC_COLUMNS)
      .eq("id", mediaId)
      .eq("is_hidden", false)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.error("[lib/media] gagal membaca media sub ID:", error.message);
      }
      return null;
    }

    const media = toPublicQrMedia(data as QrMediaRow);

    // Verifikasi bahwa media ini adalah media aktif terkini untuk QR code-nya
    const activeCurrent = await getActiveMedia(media.qr_code_id);
    if (!activeCurrent || activeCurrent.id !== media.id) {
      return null;
    }

    return media;
  } catch (err) {
    console.error(
      "[lib/media] exception saat membaca media sub ID:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}