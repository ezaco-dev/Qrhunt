import { Readable } from "node:stream";

import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

import { MissingEnvError, assertServerOnly } from "@/lib/supabase";

// Modul ini memegang CLOUDINARY_API_SECRET — tidak boleh masuk ke browser bundle.
assertServerOnly();

let configured = false;

/**
 * Konfigurasi Cloudinary sekali per proses.
 *
 * Dua bentuk env diterima, karena dashboard Cloudinary menyediakannya dua cara:
 *
 *  A. Satu baris `CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud_name>`
 *  B. Tiga baris terpisah: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
 *     `CLOUDINARY_API_SECRET`
 *
 * Bentuk A diperiksa dan diurai di sini, BUKIN diserahkan ke SDK. Alasannya:
 * `parseCloudinaryUrl` di berkas ini adalah kebalikan dari SDK — ia membaca
 * URL hasil unggah yang ditulis Cloudinary sendiri. Kalau konfigurasi masuk lewat
 * jalur yang sama, satu kesalahan penulisan diam-diam menjadi dua
 * masalah terpisah: unggahan gagal dan aset lama tidak terhapus.
 *
 * Melempar bila env belum lengkap.
 */
export function configureCloudinary(): void {
  if (configured) return;

  const envUrl = process.env.CLOUDINARY_URL;

  if (envUrl) {
    cloudinary.config(parseCloudinaryConfigUrl(envUrl));
    configured = true;
    return;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Konfigurasi Cloudinary belum lengkap. Isi salah satu dari: " +
        "CLOUDINARY_URL, atau CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + " +
        "CLOUDINARY_API_SECRET. Salin .env.example ke .env.local lalu isi nilainya.",
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  configured = true;
}

/**
 * Pecah `cloudinary://<api_key>:<api_secret>@<cloud_name>` jadi objek config.
 *
 * Sengaja memakai `new URL` dengan pemeriksaan protocol seperti
 * `parseCloudinaryUrl`: lebih dulu dicek protocol-nya `cloudinary:`, baru host
 * dan kredensialnya dibaca. Tanpa pemeriksaan protocol, string berbentuk URL lain
 * bisa ikut terurai di sini dan menghasilkan cloud_name yang tidak terduga.
 *
 * Melempar `MissingEnvError` agar pemanggil di route handler bisa membedakan
 * "belum dikonfigurasi" dari kegagalan jaringan.
 */
function parseCloudinaryConfigUrl(rawUrl: string): {
  cloud_name: string;
  api_key: string;
  api_secret: string;
  secure: true;
} {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new MissingEnvError(
      "CLOUDINARY_URL tidak bisa dibaca. Format yang benar: " +
        "cloudinary://<api_key>:<api_secret>@<cloud_name>",
    );
  }

  if (url.protocol !== "cloudinary:") {
    throw new MissingEnvError(
      `CLOUDINARY_URL harus diawali "cloudinary:", bukan "${url.protocol}".`,
    );
  }

  const cloudName = url.hostname;
  const apiKey = decodeURIComponent(url.username);
  const apiSecret = decodeURIComponent(url.password);

  if (!cloudName || !apiKey || !apiSecret) {
    throw new MissingEnvError(
      "CLOUDINARY_URL belum lengkap. Format yang benar: " +
        "cloudinary://<api_key>:<api_secret>@<cloud_name>",
    );
  }

  return {
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  };
}

/** Bentuk hasil unggah yang dipakai route handler. */
export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
  resourceType: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  format: string | null;
  bytes: number | null;
}

/**
 * Unggah satu berkas ke folder `qrhunt/<qrCodeId>`.
 *
 * Memakai `upload_stream` + `Readable.from(buffer)` supaya berkas tidak
 * dicopy dua kali di memori — penting untuk platform dengan RAM terbatas
 * seperti Termux/Android, dan untuk video 4 MB.
 */
export async function uploadToCloudinary(
  file: File,
  qrCodeId: string,
  resourceType: "image" | "video" | "raw",
): Promise<CloudinaryUploadResult> {
  configureCloudinary();

  const buffer = Buffer.from(await file.arrayBuffer());

  return new Promise<CloudinaryUploadResult>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `qrhunt/${qrCodeId}`,
        resource_type: resourceType,
        // Video butuh waktu unggah lebih lama daripada limit bawaan.
        ...(resourceType === "video" ? { timeout: 60_000 } : {}),
      },
      (error: unknown, result: UploadApiResponse | undefined) => {
        if (error || !result) {
          reject(
            error instanceof Error
              ? error
              : new Error("Unggah Cloudinary gagal tanpa pesan."),
          );
          return;
        }

        resolve({
          secureUrl: result.secure_url,
          publicId: result.public_id,
          resourceType: result.resource_type,
          width: result.width ?? null,
          height: result.height ?? null,
          duration: result.duration ?? null,
          format: result.format ?? null,
          bytes: result.bytes ?? null,
        });
      },
    );

    stream.on("error", (err: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    Readable.from(buffer).pipe(stream);
  });
}

/**
 * Hapus aset dari Cloudinary. IDEMPOTEN dan TIDAK PERNAH melempar error.
 *
 * Kenapa tidak melempar: pemanggil memakainya untuk retention (membuang media
 * lama setelah yang baru tersimpan). Kalau hapus gagal karena sementara, media
 * baru sudah aman di database dan pengguna sudah melihat respons sukses.
 * Melempar di sini akan membuat request terlihat gagal padahal tidak, dan
 * mendorong developer melakukan kesalahan yang lebih buruk: ikut menghapus
 * media yang baru saja diunggah.
 *
 * `invalidate: true` supaya derivatif (resize, transcode) ikut dibersihkan;
 * tanpa itu kuota terkuras oleh file yang tidak lagi dirujuk.
 */
export async function destroyFromCloudinary(
  publicId: string,
  resourceType: string,
): Promise<boolean> {
  try {
    configureCloudinary();

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    });

    if (result.result === "ok" || result.result === "not found") {
      return true;
    }

    console.warn(
      `[lib/cloudinary] destroy(${publicId}) menghasilkan result="${result.result}"`,
    );
    return false;
  } catch (err) {
    console.warn(
      `[lib/cloudinary] destroy(${publicId}) gagal:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** Bentuk hasil parsing URL Cloudinary. */
export interface ParsedCloudinaryUrl {
  publicId: string;
  resourceType: string;
}

/**
 * Ambil `publicId` dan `resourceType` dari URL hasil unggah Cloudinary.
 *
 * PENTING: tabel hanya menyimpan `media_url`, jadi ini satu-satunya cara
 * menemukan kembali aset untuk dihapus saat media diganti. Parser ini punya
 * banyak kasus regresi (lihat `lib/__tests__/cloudinary.test.ts`) — jangan
 * disederhanakan tanpa menambah kasus yang setara.
 *
 * Aturan:
 *  1. Pakai WHATWG `new URL`, bukan regex mentah, supaya query string dan
 *     fragment ikut terbuang.
 *  2. Hanya `https:` + hostname `res.cloudinary.com`.
 *  3. Segmen: `<cloud>/<resource_type>/upload[/v<version>]/<public_id>` —
 *     minimal 4 segmen, dan segmen `upload` wajib ada.
 *  4. Segmen versi `v\d+` opsional, maksimal SATU. Folder bernama "video"
 *     atau public_id berawalan angka tidak boleh ikut terpotong.
 *  5. Ekstensi dibuang HANYA dari segmen terakhir.
 */
export function parseCloudinaryUrl(url: string): ParsedCloudinaryUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.hostname !== "res.cloudinary.com") return null;

  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);

  // Minimal: <cloud>/<resource_type>/upload/<public_id>
  if (segments.length < 4) return null;
  if (segments[2] !== "upload") return null;

  const resourceType = segments[1];
  let publicIdSegments = segments.slice(3);

  // Buang maksimal satu segmen versi.
  if (/^v\d+$/.test(publicIdSegments[0] ?? "")) {
    publicIdSegments = publicIdSegments.slice(1);
  }

  if (publicIdSegments.length === 0) return null;

  // Ekstensi hanya dari segmen terakhir.
  const lastSegment = publicIdSegments[publicIdSegments.length - 1];
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex > 0) {
    publicIdSegments = [
      ...publicIdSegments.slice(0, -1),
      lastSegment.slice(0, dotIndex),
    ];
  }

  return {
    publicId: publicIdSegments.join("/"),
    resourceType,
  };
}