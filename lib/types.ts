/**
 * Sumber kebenaran untuk seluruh tipe & konstanta batas aplikasi.
 *
 * File ini HARUS tetap aman diimpor dari client maupun server (tidak ada
 * import, tidak ada akses process.env yang bocor ke bundle).
 */

/** Tipe media yang didukung QrHunt. */
export type MediaType = "image" | "video" | "gif" | "text";

/** Semua tipe media, untuk iterate UI. */
export const MEDIA_TYPES: readonly MediaType[] = ["image", "video", "gif", "text"];

/** Bentuk baris di tabel `public.qr_medias`. */
export interface QrMedia {
  id: string;
  qr_code_id: string;
  media_type: MediaType;
  media_url: string | null;
  text_content: string | null;
  report_count: number;
  /**
   * Status moderasi. TIDAK BOLEH pernah dikirim ke browser — lihat
   * `PublicQrMedia` di bawah dan `lib/media.ts`.
   */
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Payload publik untuk halaman QR.
 *
 * `is_hidden` sengaja di-omit: kolom ini adalah status moderasi internal.
 * Objeknya harus dibangun eksplisit kolom-per-kolom (lihat `lib/media.ts`),
 * bukan dengan spread `{ ...row }`.
 */
export type PublicQrMedia = Omit<QrMedia, "is_hidden">;

/** Hasil seragam untuk route handler API. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

/** Satu prediksi per frame dari model NSFW. */
export interface NsfwPrediction {
  /** "Porn" | "Hentai" | "Sexy" | "Neutral" | "Draw" | "Bikini" */
  className: string;
  /** Keyakinan 0..1. */
  probability: number;
}

/** Hasil pemindaian NSFWJS di browser. */
export interface NsfwScanResult {
  /** True bila ada kategori terlarang di atas threshold. */
  isBlocked: boolean;
  /** Prediksi tiap frame yang disampel (gambar = 1 frame). */
  frames: NsfwPrediction[][];
  /** Skor tertinggi di antara seluruh frame. */
  worstScore: number;
  /** Nama kategori dari `worstScore`. */
  worstCategory: string;
  /** Berapa frame yang benar-benar diklasifikasi. */
  sampledFrames: number;
}

/** Batas durasi video, detik. */
export const MAX_VIDEO_DURATION_SECONDS = 10;

/** Batas ukuran unggahan, 4 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Batas panjang teks untuk `media_type = 'text'`. */
export const MAX_TEXT_LENGTH = 500;

/** Berapa frame video yang disampel untuk pemindaian NSFW. */
export const VIDEO_SCAN_FRAME_COUNT = 3;

/** Format `File` yang diizinkan per tipe media. */
export const ACCEPTED_MIME_TYPES: Record<MediaType, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  gif: ["image/gif"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  text: [],
};