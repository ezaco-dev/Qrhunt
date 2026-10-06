import { z } from "zod";

import {
  ACCEPTED_MIME_TYPES,
  MAX_TEXT_LENGTH,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  type MediaType,
} from "@/lib/types";

/**
 * Validasi id QR.
 *
 * Regex ini melindungi dua hal sekaligus:
 *  1. Path traversal ke folder Cloudinary (`../../admin`).
 *  2. Karakter aneh yang merusak URL/route.
 *
 * 1..64 karakter, hanya `A-Z a-z 0-9 _ -`.
 */
export const qrCodeIdSchema = z
  .string()
  .trim()
  .min(1, "ID QR tidak boleh kosong")
  .max(64, "ID QR maksimal 64 karakter")
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "ID QR hanya boleh berisi huruf, angka, underscore, dan strip",
  );

/** True bila string adalah id QR yang valid (cek cepat, tanpa Zod). */
export function isValidQrCodeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

const mediaTypeSchema = z.enum(["image", "video", "gif", "text"]);

/**
 * Skema form unggahan.
 *
 * `superRefine` mengunci invariant yang sama dengan CHECK constraint
 * `qr_medias_payload_shape` di `schema.sql`: teks ⇔ `text_content` terisi,
 * selain teks ⇔ `text_content` kosong.
 */
export const uploadFormSchema = z
  .object({
    qrCodeId: qrCodeIdSchema,
    mediaType: mediaTypeSchema,
    textContent: z.string().optional(),
    durationSeconds: z.number().finite().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    const text = value.textContent?.trim() ?? "";

    if (value.mediaType === "text") {
      if (text.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["textContent"],
          message: "Teks tidak boleh kosong",
        });
      } else if (text.length > MAX_TEXT_LENGTH) {
        ctx.addIssue({
          code: "custom",
          path: ["textContent"],
          message: `Teks maksimal ${MAX_TEXT_LENGTH} karakter`,
        });
      }
      return;
    }

    // Media non-teks tidak boleh membawa teks.
    if (text.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["textContent"],
        message: "Media file tidak boleh punya konten teks",
      });
    }
  });

/** Skema body `POST /api/report`. */
export const reportRequestSchema = z.object({
  qrCodeId: qrCodeIdSchema,
  reason: z
    .string()
    .trim()
    .max(280, "Alasan maksimal 280 karakter")
    .optional(),
});

export type UploadFormInput = z.input<typeof uploadFormSchema>;
export type ReportRequest = z.infer<typeof reportRequestSchema>;

/** Hasil validasi berkas — pesan siap tampil ke pengguna. */
export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

function humanSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validasi berkas media.
 *
 * Dipakai DUA kali dengan sengaja:
 *  - Client (`MediaUploader`) → UX cepat, berkas ditolak sebelum menguras kuota.
 *  - Server (`/api/upload`)   → kebenaran. Client bisa dilewati, jadi validasi
 *    yang menentukan adalah yang di server.
 *
 * CATATAN KEAMANAN: `durationSeconds` dikirim oleh browser dan bisa dipalsukan.
 * Pagar kedua adalah batas ukuran 4 MB. Mengganti `duration` dengan probe
 * server-side adalah perbaikan yang masuk akal bila ini jadi produksi.
 */
export function validateMediaFile(
  file: File | null | undefined,
  mediaType: MediaType,
  durationSeconds?: number,
): FileValidationResult {
  if (mediaType === "text") {
    return { ok: true };
  }

  if (!file) {
    return { ok: false, error: "Tidak ada berkas yang dipilih." };
  }

  const accepted = ACCEPTED_MIME_TYPES[mediaType] ?? [];
  if (!accepted.includes(file.type)) {
    const readable = accepted.join(", ") || "tidak ada";
    return {
      ok: false,
      error: `Format tidak didukung. Gunakan: ${readable}.`,
    };
  }

  if (file.size === 0) {
    return { ok: false, error: "Berkas kosong." };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `Ukuran berkas ${humanSize(file.size)} melebihi batas ${humanSize(MAX_UPLOAD_BYTES)}.`,
    };
  }

  if (
    (mediaType === "video") &&
    typeof durationSeconds === "number" &&
    durationSeconds > MAX_VIDEO_DURATION_SECONDS
  ) {
    return {
      ok: false,
      error: `Durasi video maksimal ${MAX_VIDEO_DURATION_SECONDS} detik.`,
    };
  }

  return { ok: true };
}

/**
 * Ambang jumlah laporan sebelum media otomatis disembunyikan.
 * Env `REPORT_HIDE_THRESHOLD`, default 3.
 */
export function getReportHideThreshold(): number {
  const raw = process.env.REPORT_HIDE_THRESHOLD;
  if (!raw) return 3;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 3;
  return parsed;
}