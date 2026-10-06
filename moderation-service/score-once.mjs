/**
 * Cetak skor satu gambar dari SATU jalur saja.
 *
 * Dipakai untuk membandingkan pipeline kita dengan pustaka NSFWJS. Keduanya
 * sengaja dijalankan di proses terpisah: memuat dua model dengan nama bobot
 * yang sama (Conv1/kernel dst) ke dalam satu engine tfjs bentrok dan membuat
 * perbandingan tidak bermakna.
 *
 * Jalankan: node score-once.mjs <berkas> mine|nsfwjs
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES = join(REPO, "tmp-smoke");

const file = process.argv[2] || "sample.jpg";
const mode = process.argv[3] || "mine";

const { FRAME_SIZE, classifyFrames, MODEL_DIR } = await import("./lib/model.mjs");

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
      (err, stdout) => (err ? reject(err) : resolve(new Uint8Array(stdout))),
    );
  });
}

const rgb = await toRgb(join(SAMPLES, file));

let scores;
if (mode === "mine") {
  const [frame] = await classifyFrames(rgb, 1);
  scores = frame.perClass;
} else {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const tf = require("@tensorflow/tfjs");
  const { NSFWJS } = require("nsfwjs/core");

  const manifest = JSON.parse(readFileSync(join(MODEL_DIR, "model.json"), "utf8"));
  const weightSpecs = manifest.weightsManifest.flatMap((g) =>
    g.weights.map((w) => ({ name: w.name, shape: w.shape, dtype: w.dtype, quantization: w.quantization })),
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

  const nsfwjs = new NSFWJS(
    tf.io.fromMemory({ modelTopology: manifest.modelTopology, weightSpecs, weightData }),
    { size: FRAME_SIZE, type: "layers" },
  );
  await nsfwjs.load();
  const list = await nsfwjs.classify({ width: FRAME_SIZE, height: FRAME_SIZE, data: rgb }, 5);
  scores = {};
  for (const item of list) scores[item.className] = item.probability;
}

console.log(
  Object.entries(scores)
    .map(([k, v]) => `${k}=${v.toFixed(6)}`)
    .join(" "),
);
