/**
 * Bungkus model NSFWJS supaya bisa dipakai di Node, di luar browser.
 *
 * Dua jebakan yang sudah dibayar di AGENTS.md, diulang di sini supaya tidak
 * dihapus saat refactor:
 *
 * 1. Format model. Berkas `public/models/mobilenet_v2/model.json` berformat
 *    LAYERS, bukan graph. `loadGraphModel` di sini akan gagal dengan
 *    `Cannot read properties of undefined (reading 'producer')` — gejalanya
 *    persis sama dengan "model rusak", padahal modelnya utuh.
 *
 * 2. Jalur berkas. `loadLayersModel(path)` hanya jalan di browser: di Node ia
 *    mencari IOHandler berbasis filesystem yang hanya ada di
 *    `@tensorflow/tfjs-node` (binding native, tidak muat di serverless, dan
 *    di VPS ini bahkan crash dengan SIGILL karena CPU-nya tidak punya AVX).
 *    Jadi berkas dibaca manual lalu dibungkus `tf.io.fromMemory`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as tf from "@tensorflow/tfjs";

await tf.setBackend("cpu");
await tf.ready();

/** Ukuran input model. */
export const FRAME_SIZE = 224;

/** Kelas keluaran model, sesuai `nsfwjs`. */
const CLASSES = ["Drawing", "Hentai", "Neutral", "Porn", "Sexy"];

/**
 * Kelas yang dianggap eksplisit.
 *
 * `Drawing` dan `Sexy` sengaja TIDAK masuk. Klasifikasi pornografi dan menggoda berbeda: lingerie atau siluet bikini
 * tidak otomatis berarti eksplisit, sementara dua kelas di atas memang iya.
 * Hanya dua kelas yang benar-benar eksplisit.
 */
const EXPLICIT_CLASSES = new Set(["Porn", "Hentai"]);

const DEFAULT_MODEL_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "models",
  "mobilenet_v2",
);

/** Di-export supaya `verify-model.mjs` memuat persis model yang sama. */
export const MODEL_DIR = process.env.MODERATION_MODEL_DIR || DEFAULT_MODEL_DIR;

let modelPromise = null;

/**
 * Baca artefak model dari diska menjadi IOHandler tfjs.
 *
 * Urutan byte `weightData` HARUS sama dengan urutan `weightSpecs`. Kalau tidak,
 * bobot akan menempel ke layer yang salah dan hasilnya bukan sekadar "buruk" —
 * tapi diam-diam tidak terkait sama sekali dengan model aslinya.
 */
function buildMemoryHandler(modelDir) {
  const manifest = JSON.parse(
    readFileSync(join(modelDir, "model.json"), "utf8"),
  );

  const weightSpecs = manifest.weightsManifest.flatMap((group) =>
    group.weights.map((w) => ({
      name: w.name,
      shape: w.shape,
      dtype: w.dtype,
      quantization: w.quantization,
    })),
  );

  const shards = manifest.weightsManifest.map((group) => {
    const path = join(modelDir, group.paths[0]);
    return new Uint8Array(readFileSync(path));
  });

  const weightData = new Uint8Array(
    shards.reduce((total, shard) => total + shard.length, 0),
  );
  let offset = 0;
  for (const shard of shards) {
    weightData.set(shard, offset);
    offset += shard.length;
  }

  return tf.io.fromMemory({
    modelTopology: manifest.modelTopology,
    weightSpecs,
    weightData,
  });
}

/**
 * Muat model sekali lalu dipakai selamanya proses.
 *
 * Sengaja di-cache sebagai Promise: kalau dua request datang bersamaan saat
 * layanan baru start, keduanya harus berbagi satu pemuatan, bukan memuat
 * model dua kali (2,6 MB parsing dua kali).
 */
export function loadModel(modelDir = process.env.MODERATION_MODEL_DIR || DEFAULT_MODEL_DIR) {
  if (!modelPromise) {
    const started = Date.now();
    modelPromise = tf.loadLayersModel(buildMemoryHandler(modelDir)).then((model) => {
      console.log(
        `[model] dimuat dari ${modelDir} dalam ${Date.now() - started} ms`,
      );
      return model;
    });
    // Kalau gagal, cache harus dibuang supaya request berikutnya bisa retry
    // setelah ada perbaikan, bukan menerima error yang sama selamanya.
    modelPromise.catch(() => {
      modelPromise = null;
    });
  }
  return modelPromise;
}

/**
 * Tebak skor tiap frame.
 *
 * `pixels` adalah RGB24 mentah sepanjang FRAME_SIZE*FRAME_SIZE*3 per frame,
 * sesuai keluaran `ffmpeg -pix_fmt rgb24`. Frame dikirim apa adanya tanpa
 * resize karena ffmpeg sudah menskalanya; hanya normalisasi 1/255 yang
 * dilakukan, sama seperti `preprocess()` di NSFWJS.
 *
 * Mengembalikan satu objek per frame, urut sama dengan urutan frame.
 */
export async function classifyFrames(pixels, frameCount) {
  const model = await loadModel();

  const bytesPerFrame = FRAME_SIZE * FRAME_SIZE * 3;
  const expected = bytesPerFrame * frameCount;
  if (pixels.length !== expected) {
    throw new Error(
      `ukuran frame tidak cocok: dapat ${pixels.length} byte, diharapkan ${expected}`,
    );
  }

  const scores = tf.tidy(() => {
    // tensor4d, bukan tensor3d: satu batch berisi frameCount frame, jadi
    // bentuknya 4 dimensi. Memakai tensor3d di sini gagal dengan
    // "requires shape to have three numbers".
    const tensor = tf.tensor4d(pixels, [frameCount, FRAME_SIZE, FRAME_SIZE, 3]);
    const normalized = tensor.toFloat().div(255);
    const output = model.predict(normalized);
    return output.dataSync();
  });

  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const perClass = {};
    let best = { score: -1, category: CLASSES[2] };

    for (let c = 0; c < CLASSES.length; c++) {
      const score = scores[i * CLASSES.length + c];
      perClass[CLASSES[c]] = score;
      if (score > best.score) {
        best = { score, category: CLASSES[c] };
      }
    }

    // Skor yang dipakai ambang adalah skor kelas eksplisit TERTINGGI, bukan
    // skor kelas tertinggi secara keseluruhan. Bedanya penting: gambar dengan
    // Porn 0.55 dan Sexy 0.90 adalah "Sexy" versi argmax, tapi ambang 0.6
    // mestinya tetap menilai Porn 0.55 sebagai yang menentukan.
    let explicitScore = 0;
    let explicitCategory = null;
    for (const [name, value] of Object.entries(perClass)) {
      if (EXPLICIT_CLASSES.has(name) && value > explicitScore) {
        explicitScore = value;
        explicitCategory = name;
      }
    }

    frames.push({
      index: i,
      perClass,
      top: best,
      explicitScore,
      explicitCategory,
    });
  }

  return frames;
}

export { CLASSES, EXPLICIT_CLASSES };
