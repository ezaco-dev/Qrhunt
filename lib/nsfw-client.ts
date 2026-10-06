"use client";

import { load, type NSFWJS } from "nsfwjs/core";
import * as tf from "@tensorflow/tfjs";

import { VIDEO_SCAN_FRAME_COUNT, type NsfwPrediction, type NsfwScanResult } from "@/lib/types";

// PENTING: import dari "nsfwjs/core", BUKAN `from "nsfwjs"`.
//
// Entri "nsfwjs" menarik ketiga model sebagai base64 (>10 MB) ke dalam bundle
// dan membuat webpack gagal build dengan "Cannot statically analyse
// require(...)". Impor ini juga membuat bundel model (~3,5 MB) tidak ikut
// terkirim ke browser. `nsfwjs/core` tidak membawa model; kita menunjuk
// model sendiri yang di-host di /public.

/**
 * Model NSFWJS yang di-host sendiri.
 *
 * Self-host disengaja: model default nsfwjs diambil dari CDN pihak ketiga,
 * yang bisa hilang atau berubah kapan saja. File ini hasil ekstraksi dari
 * bundel npm (lihat `scripts/extract-model.cjs`).
 */
const MODEL_URL = "/models/mobilenet_v2/model.json";

/** Kategori yang memblokir unggahan. */
const BLOCKED_CATEGORIES = new Set(["Porn", "Hentai", "Sexy"]);

/** Ambang probabilitas untuk memblokir. Env `NEXT_PUBLIC_NSFW_THRESHOLD`, default 0.6. */
function getThreshold(): number {
  const raw = process.env.NEXT_PUBLIC_NSFW_THRESHOLD;
  if (!raw) return 0.6;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0.6;
  return parsed;
}

// Memoize satu Promise: model hefty (±3 MB) dan user bisa memindai berkali-kali
// dalam satu sesi. Janji yang sama dikembalikan supaya model tidak di-load dua
// kali saat React StrictMode memanggil efek dua kali.
let modelPromise: Promise<NSFWJS> | null = null;

export function getNsfwModel(): Promise<NSFWJS> {
  modelPromise ??= (async () => {
    tf.enableProdMode();
    return load(MODEL_URL, { size: 224, type: "layers" });
  })();
  return modelPromise;
}

/** True kalau model sedang diunduh, belum siap dipakai. */
export function isNsfwModelLoading(): boolean {
  return modelPromise === null;
}

/** Sumber gambar sebagai object URL dari `File`. */
function toImageElement(file: File): { element: HTMLImageElement; url: string } {
  const url = URL.createObjectURL(file);
  const element = new Image();
  element.src = url;
  return { element, url };
}

/** Tunggu gambar benar-benar ter-decode. */
function waitForImage(image: HTMLImageElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (image.complete && image.naturalWidth > 0) {
      resolve();
      return;
    }
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Gambar tidak dapat dibaca."));
  });
}

/**
 * Pindai satu gambar.
 *
 * Pembersihan object URL selalu jalan di `finally` supaya tidak
 * ada Blob yang menggantung di memori selama wizard terbuka.
 */
export async function scanImageFile(file: File): Promise<NsfwScanResult> {
  const model = await getNsfwModel();
  const { element, url } = toImageElement(file);

  try {
    await waitForImage(element);

    const predictions = (await model.classify(element)) as NsfwPrediction[];

    const threshold = getThreshold();
    let worstScore = 0;
    let worstCategory = "";
    let isBlocked = false;

    for (const prediction of predictions) {
      if (!BLOCKED_CATEGORIES.has(prediction.className)) continue;
      if (prediction.probability > worstScore) {
        worstScore = prediction.probability;
        worstCategory = prediction.className;
      }
      if (prediction.probability > threshold) isBlocked = true;
    }

    return {
      isBlocked,
      frames: [predictions],
      worstScore,
      worstCategory,
      sampledFrames: 1,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Pindai video dengan mengambil beberapa frame yang tersebar merata sepanjang
 * durasi, lalu mengklasifikasi tiap frame.
 *
 * Video satu frame saja bisa dilewati dengan menaruh konten sensitif di detik
 * pertama atau terakhir. Tiga frame tersebar menutup sebagian besar
 * kasus itu tanpa biaya yang tidak proporsional.
 */
export async function scanVideoFile(file: File): Promise<NsfwScanResult> {
  const model = await getNsfwModel();
  const url = URL.createObjectURL(file);

  try {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Video tidak dapat dibaca."));
    });

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Durasi video tidak dapat dibaca.");
    }

    // `requestVideoFrameCallback` lebih akurat daripada `seeked` untuk
    // mengambil frame yang benar-benar sudah ter-render. Browser lama tidak
    // punya API ini, jadi ada fallback ke `requestAnimationFrame`.
    const seekTo = (time: number): Promise<void> =>
      new Promise((resolve, reject) => {
        if ("requestVideoFrameCallback" in video) {
          video.requestVideoFrameCallback(() => resolve());
        } else {
          requestAnimationFrame(() => resolve());
        }
        video.currentTime = time;
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("Gagal seek video."));
      });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D tidak tersedia.");

    const threshold = getThreshold();
    const frames: NsfwPrediction[][] = [];
    let worstScore = 0;
    let worstCategory = "";
    let isBlocked = false;

    for (let index = 0; index < VIDEO_SCAN_FRAME_COUNT; index += 1) {
      // Sebar merata: untuk 3 frame berarti 0%, 50%, 100%. Frame pertama dan
      // terakhir sama-sama diperiksa karena konten bisa diletakkan di mana saja.
      const lastIndex = VIDEO_SCAN_FRAME_COUNT - 1;
      const ratio = lastIndex === 0 ? 0 : index / lastIndex;
      await seekTo(duration * ratio);

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Serahkan objek ImageData apa adanya — `classify` diteruskan ke
      // `tf.browser.fromPixels()` yang sudah mengenali ImageData.
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);

      const predictions = (await model.classify(frame)) as NsfwPrediction[];

      frames.push(predictions);

      for (const prediction of predictions) {
        if (!BLOCKED_CATEGORIES.has(prediction.className)) continue;
        if (prediction.probability > worstScore) {
          worstScore = prediction.probability;
          worstCategory = prediction.className;
        }
        if (prediction.probability > threshold) isBlocked = true;
      }
    }

    return {
      isBlocked,
      frames,
      worstScore,
      worstCategory,
      sampledFrames: frames.length,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Baca durasi video dalam detik. Dipakai untuk menolak video >10 detik. */
export function readVideoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);

  return new Promise<number>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    const cleanup = () => URL.revokeObjectURL(url);

    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("Durasi video tidak dapat dibaca."));
        return;
      }
      resolve(duration);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Video tidak dapat dibaca atau formatnya tidak didukung."));
    };

    video.src = url;
  });
}

/**
 * Pindai berkas sesuai tipenya. `text` tidak pernah perlu diskanning.
 *
 * Sengaja melempar error untuk tipe yang tidak dikenal supaya bug di pemanggil
 * menjadi kegagalan yang terlihat, bukan berkas yang lolos tanpa diperiksa.
 */
export async function scanMediaFile(
  file: File,
  mediaType: "image" | "video" | "gif",
): Promise<NsfwScanResult> {
  if (mediaType === "image" || mediaType === "gif") {
    return scanImageFile(file);
  }
  if (mediaType === "video") {
    return scanVideoFile(file);
  }
  throw new Error(`Tipe media tidak dikenal: ${String(mediaType)}`);
}