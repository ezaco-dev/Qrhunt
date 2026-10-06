/**
 * Skrip sekali pakai — ekstrak model NSFWJS dari bundel `.min.js` npm menjadi
 * berkas TFJS mentah supaya bisa di-host sendiri di `public/models/`.
 *
 * Bundel nsfwjs menyimpan:
 *   - `model.min.js`            → objek { modelTopology, weightsManifest }
 *   - `group1-shard1of1.min.js` → string base64 berisi bobot biner
 *
 * Yang dibutuhkan `tf.loadLayersModel(url, { type: "layers" })` adalah:
 *   - `model.json`          → JSON { modelTopology, weightsManifest }
 *   - `group1-shard1of1`    → biner mentah (TIDAK base64)
 *
 * PENTING soal `type: "layers"`: topologi model ini format Keras, bukan graph.
 * Dimuat dengan `type: "graph"` ia gagal dengan
 * "Cannot read properties of undefined (reading 'producer')" — gejala yang sama
 * persis dengan "model rusak" padahal berkasnya utuh.
 *
 * Jalankan: node scripts/extract-model.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "node_modules/nsfwjs/dist/models/mobilenet_v2");
const OUT = path.join(ROOT, "public/models/mobilenet_v2");

fs.mkdirSync(OUT, { recursive: true });

const topology = require(path.join(SRC, "model.min.js"));
const shardBase64 = require(path.join(SRC, "group1-shard1of1.min.js"));

if (typeof topology !== "object" || !topology.modelTopology) {
  throw new Error("model.min.js tidak Mengekspor modelTopology — format paket berubah.");
}
if (typeof shardBase64 !== "string") {
  throw new Error("group1-shard1of1.min.js tidak mengekspor string base64.");
}

const modelJson = {
  modelTopology: topology.modelTopology,
  weightsManifest: topology.weightsManifest,
};

const modelPath = path.join(OUT, "model.json");
fs.writeFileSync(modelPath, JSON.stringify(modelJson));

const shardBuffer = Buffer.from(shardBase64, "base64");
const shardPath = path.join(OUT, "group1-shard1of1");
fs.writeFileSync(shardPath, shardBuffer);

// Verifikasi ukuran shard cocok dengan manifest.
//
// PENTING: MobileNetV2 dari nsfwjs di-kuantisasi — semua bobot pada manifest
// ber-`dtype: "float32"` (tipe logis) tapi punya `quantization.dtype: "uint8"`,
// jadi yang disimpan di shard adalah 1 BYTE per parameter, bukan 4.
const BYTES_PER_ELEMENT = { float32: 4, int32: 4, bool: 1, uint8: 1 };

const expectedBytes = topology.weightsManifest.reduce(
  (total, group) =>
    total +
    group.weights.reduce((sum, w) => {
      const elements = w.shape.reduce((a, b) => a * b, 1);
      const dtype = w.quantization?.dtype ?? w.dtype;
      return sum + elements * (BYTES_PER_ELEMENT[dtype] ?? 4);
    }, 0),
  0,
);

const weightCount = topology.weightsManifest.reduce(
  (n, g) => n + g.weights.length,
  0,
);

console.log(`model.json         ${fs.statSync(modelPath).size} B`);
console.log(`group1-shard1of1   ${shardBuffer.length} B`);
console.log(`manifest           ${weightCount} bobot, paths: ${topology.weightsManifest.flatMap((g) => g.paths).join(", ")}`);
console.log(`expected shard     ${expectedBytes} B (kuantisasi uint8 → 1 B/param)`);

if (shardBuffer.length !== expectedBytes) {
  console.error(
    `PERINGATAN: ukuran shard ${shardBuffer.length} B tidak sama dengan manifest ` +
      `${expectedBytes} B. Periksa dekode base64.`,
  );
  process.exitCode = 1;
} else {
  console.log("OK: ukuran shard cocok dengan manifest.");
}