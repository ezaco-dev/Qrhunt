/**
 * Cari cara tercepat untuk menjalankan inferensi di CPU murni.
 *
 * Kenapa ini penting dan bukan sekadar soal kecepatan: aplikasi Next.js ada di Vercel yang
 * membatasi fungsi 10 detik. Video sekarang butuh 9,2 detik JUSTRU ke service
 * saja, jadi tidak ada ruang sama sekali untuk hop jaringan. Kalau tidak ada
 * yang dipercepat, moderasi video tidak mungkin diTTPS dari Vercel.
 *
 * Yang diuji:
 *   A. Bobot terkuantisasi uint8 apa adanya (cara sekarang)
 *   B. Bobot didekuantisasi ke float32 sekali di awal
 *
 * Jalankan: node bench-dequant.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIR = join(ROOT, "public", "models", "mobilenet_v2");
const FRAME_SIZE = 224;

const tf = await import("@tensorflow/tfjs");
await tf.setBackend("cpu");
await tf.ready();

function readArtifacts() {
  const manifest = JSON.parse(readFileSync(join(MODEL_DIR, "model.json"), "utf8"));
  const weightSpecs = manifest.weightsManifest.flatMap((g) =>
    g.weights.map((w) => ({
      name: w.name,
      shape: w.shape,
      dtype: w.dtype,
      quantization: w.quantization,
    })),
  );
  const shards = manifest.weightsManifest.map((g) =>
    new Uint8Array(readFileSync(join(MODEL_DIR, g.paths[0]))),
  );
  const weightData = new Uint8Array(shards.reduce((t, s) => t + s.length, 0));
  let offset = 0;
  for (const s of shards) {
    weightData.set(s, offset);
    offset += s.length;
  }
  return { manifest, weightSpecs, weightData };
}

function toRgb(path) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-loglevel", "error", "-i", path,
        "-vf", `scale=${FRAME_SIZE}:${FRAME_SIZE}`,
        "-frames:v", "1",
        "-pix_fmt", "rgb24",
        "-f", "rawvideo", "-",
      ],
      { maxBuffer: FRAME_SIZE * FRAME_SIZE * 3 + 1024, encoding: "buffer" },
      (err, so) => (err ? reject(err) : resolve(new Uint8Array(so))),
    );
  });
}

/** Ubah uint8 + scale/min menjadi float32. */
function dequantize(specs, uint8Data) {
  const parts = [];
  let offset = 0;
  for (const spec of specs) {
    const count = spec.shape.reduce((a, b) => a * b, 1);
    if (spec.quantization) {
      const { scale, min, dtype } = spec.quantization;
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const q = dtype === "uint8" ? uint8Data[offset + i] : uint8Data[offset + i];
        out[i] = q * scale + min;
      }
      parts.push(out);
    } else {
      parts.push(new Float32Array(uint8Data.buffer, offset * 4, count));
    }
    offset += count;
  }
  return parts;
}

async function timePredict(label, model, rgb, frames) {
  const bytesPerFrame = FRAME_SIZE * FRAME_SIZE * 3;
  const batch = new Uint8Array(rgb.length * frames);
  for (let f = 0; f < frames; f++) batch.set(rgb, f * bytesPerFrame);

  const runOnce = () => {
    const out = tf.tidy(() => {
      const t = tf.tensor4d(batch, [frames, FRAME_SIZE, FRAME_SIZE, 3]);
      return model.predict(t.toFloat().div(255));
    });
    const data = Array.from(out.dataSync());
    out.dispose();
    return data;
  };

  runOnce(); // warm-up
  const times = [];
  let last = null;
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    last = runOnce();
    times.push(Date.now() - t);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(
    `  ${label.padEnd(34)} ${frames} frame: rata-rata ${avg.toFixed(0)} ms` +
      `  [${times.join(", ")}]  top=${last[3].toFixed(4)}`,
  );
  return { avg, scores: last };
}

const rgb = await toRgb(join(ROOT, "tmp-smoke", "sample.mp4"));

console.log(`\n1. Bobot uint8 apa adanya (cara sekarang)`);
{
  const { manifest, weightSpecs, weightData } = readArtifacts();
  const model = await tf.loadLayersModel(
    tf.io.fromMemory({ modelTopology: manifest.modelTopology, weightSpecs, weightData }),
  );
  await timePredict("uint8 (quantized)", model, rgb, 1);
  await timePredict("uint8 (quantized)", model, rgb, 3);
}

console.log(`\n2. Bobot didekuantisasi ke float32`);
{
  const { manifest, weightSpecs, weightData } = readArtifacts();
  const floatParts = dequantize(weightSpecs, weightData);

  const floatSpecs = weightSpecs.map((s) => ({
    name: s.name,
    shape: s.shape,
    dtype: "float32",
  }));
  const totalFloats = floatParts.reduce((t, p) => t + p.length, 0);
  const flat = new Float32Array(totalFloats);
  let off = 0;
  for (const p of floatParts) {
    flat.set(p, off);
    off += p.length;
  }

  const model = await tf.loadLayersModel(
    tf.io.fromMemory({
      modelTopology: manifest.modelTopology,
      weightSpecs: floatSpecs,
      weightData: flat.buffer,
    }),
  );
  await timePredict("float32 (dekuantisasi)", model, rgb, 1);
  await timePredict("float32 (dekuantisasi)", model, rgb, 3);
}
