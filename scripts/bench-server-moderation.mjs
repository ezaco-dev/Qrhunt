/**
 * Benchmark moderasi NSFWJS DI SISI SERVER.
 *
 * Menguji apakah model yang sama bisa dipakai di route handler Node (Vercel),
 * bukan hanya di browser. Yang diukur:
 *   1. Apakah model bisa dimuat di Node tanpa `tfjs-node`?
 *   2. Berapa lama inferensi dengan backend CPU murni?
 *   3. Apakah decode JPEG bisa jalan tanpa browser?
 *
 * Jalankan: node scripts/bench-server-moderation.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIR = join(ROOT, "public", "models", "mobilenet_v2");

const tf = await import("@tensorflow/tfjs");
const jpeg = (await import("jpeg-js")).default;

await tf.setBackend("cpu");
await tf.ready();
console.log(`1. backend      : ${tf.getBackend()}`);
console.log(`   versi tfjs   : ${tf.version.tfjs}`);

/**
 * Muat model di Node.
 *
 * `tf.loadLayersModel(path)` hanya jalan di browser — di Node ia mencari
 * IOHandler berbasis filesystem yang hanya ada di `@tensorflow/tfjs-node`
 * (binding native, ~300 MB, tidak muat di serverless). Jadi file dibaca manual
 * lalu dibungkus `tf.io.fromMemory`.
 */
function loadModelFromDisk() {
  const manifestJson = JSON.parse(
    readFileSync(join(MODEL_DIR, "model.json"), "utf8"),
  );

  // `weightSpecs` disusun dari seluruh grup di manifest, urutannya HARUS sama
  // dengan urutan byte di shard.
  const weightSpecs = manifestJson.weightsManifest.flatMap((group) =>
    group.weights.map((w) => ({
      name: w.name,
      shape: w.shape,
      dtype: w.dtype,
      quantization: w.quantization,
    })),
  );

  const weightData = new Uint8Array(
    manifestJson.weightsManifest.reduce(
      (total, group) => total + readFileSync(join(MODEL_DIR, group.paths[0])).length,
      0,
    ),
  );

  let offset = 0;
  for (const group of manifestJson.weightsManifest) {
    const shard = readFileSync(join(MODEL_DIR, group.paths[0]));
    weightData.set(shard, offset);
    offset += shard.length;
  }

  return tf.io.fromMemory({
    modelTopology: manifestJson.modelTopology,
    weightSpecs,
    weightData,
  });
}

let t0 = Date.now();
const model = await tf.loadLayersModel(loadModelFromDisk());
console.log(`2. load model   : ${Date.now() - t0} ms`);

// Gambar abu-abu 224x224 sintetis — cukup untuk mengukur waktu, bukan akurasi.
const pixels = new Uint8Array(224 * 224 * 4).fill(128);
const encoded = jpeg.encode({ width: 224, height: 224, data: pixels }, 90).data;
const decoded = jpeg.decode(encoded, { useTArray: true });
console.log(`3. decode jpeg  : ${decoded.width}x${decoded.height}`);

console.log("4. inferensi x5:");
const times = [];
for (let i = 0; i < 5; i++) {
  const t = Date.now();
  // Preprocessing HARUS sama persis dengan yang dilakukan NSFWJS di browser
  // (lihat preprocess() di node_modules/nsfwjs/dist/cjs/core.js), kalau tidak
  // hasil prediksinya tidak bisa dipercaya.
  const normalized = tf.browser.fromPixels(decoded).toFloat().div(255);
  const resized = tf.image.resizeBilinear(normalized, [224, 224], true);
  const input = resized.reshape([1, 224, 224, 3]);
  const output = model.predict(input);
  const data = await output.data();
  const top = data.indexOf(Math.max(...data));
  const ms = Date.now() - t;
  times.push(ms);
  console.log(`   #${i + 1}: ${ms} ms  top-kelas=${top}  skor=${data[top].toFixed(3)}`);
  input.dispose();
  output.dispose();
}

const warm = times.slice(1);
const avg = warm.reduce((a, b) => a + b, 0) / warm.length;
const max = Math.max(...warm);
console.log(`\nRata-rata (setelah warm-up): ${avg.toFixed(0)} ms`);
console.log(`Terlama                     : ${max} ms`);
console.log(
  max < 8000
    ? "=> MUDAH di dalam batas 10 detik bawaan Vercel."
    : "=> BERISIKAN terhadap batas bawaan Vercel; perlu optimasi.",
);