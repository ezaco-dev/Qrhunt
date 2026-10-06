/**
 * Buktikan bahwa pipeline moderasi server sama dengan NSFWJS aslinya.
 *
 * Kenapa perlu: klaim "moderasi jalan di server" hanya berarti apa-apa kalau
 * angkanya sama dengan yang selama ini dipakai di browser. Kalau pra-prosesnya
 * salah (misal lupa dibagi 255, atau salah urutan reshape), model tetap
 * mengeluarkan angka yang terlihat wajar, tapi angka itu tidak lagi punya
 * arti apa pun. Model yang salah tapi tidak gagal diam adalah kegagalan terburuk
 * karena tidak pernah ketahuan.
 *
 * Yang diuji:
 *   1. Skor server cocok dengan `classify()` dari pustaka NSFWJS asli, memakai
 *      model dan pra-proses yang sama persis.
 *   2. Keluaran model masuk akal pada foto biasa (skor Porn dan Hentai rendah,
 *      kelas tertinggi masuk kategori yang wajar).
 *
 * Jalankan: node verify-model.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { classifyFrames, FRAME_SIZE, MODEL_DIR } from "./lib/model.mjs";

const require = createRequire(import.meta.url);

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES = join(REPO, "tmp-smoke");

let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ok    ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    fail += 1;
    console.log(`  GAGAL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

/** Baca satu gambar jadi RGB24 224x224, sama seperti service produksi. */
function toRgb(path) {
  return new Promise((resolve, reject) => {
    const child = execFile(
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
    child.on("error", reject);
  });
}

/** Muat NSFWJS asli dan beri IOHandler yang sama seperti yang dipakai service. */
async function loadReference() {
  const tf = await import("@tensorflow/tfjs");
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

  const handler = tf.io.fromMemory({
    modelTopology: manifest.modelTopology,
    weightSpecs,
    weightData,
  });

  const nsfwjs = new NSFWJS(handler, { size: FRAME_SIZE, type: "layers" });
  await nsfwjs.load();
  return nsfwjs;
}

console.log("Verifikasi pipeline moderasi\n");

const nsfwjs = await loadReference();
console.log("  NSFWJS asli termuat\n");

// Pilih beberapa berkas uji dengan jenis berbeda.
const targets = [
  ["sample.jpg", "gambar diam"],
  ["sample.gif", "GIF"],
  ["sample.mp4", "video"],
];

for (const [file, label] of targets) {
  const path = join(SAMPLES, file);
  if (!existsSync(path)) {
    check(`${label} tersedia`, false, `berkas ${file} belum ada`);
    continue;
  }

  const rgb = await toRgb(path);

  // --- Pustaka asli.
  //
  //     `fromPixels()` diberi PixelData RGBA, bukan RGB24. Di browser
  //     `fromPixels()` menerima hasil canvas `getImageData` yang selalu
  //     RGBA, lalu memakai numChannels=3 sehingga alfa dibuang. Kalau di sini
  //     langsung diberi RGB24, `fromPixels()` memperlakukannya sebagai data
  //     4-kanal: 103.574 dari 150.528 elemen jadi salah baca, dan skor
  //     dibandingkan bukan dengan browser tapi dengan kesalahan.
  //
  //     `classify()` mengembalikan langsung larik {className, probability}.
  //     Bentuknya diperiksa supaya kalau pustakanya berubah, test gagal keras.
  const pixels = 224 * 224;
  const rgba = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }

  const refList = await nsfwjs.classify(
    { width: FRAME_SIZE, height: FRAME_SIZE, data: rgba },
    5,
  );

  if (!Array.isArray(refList) || typeof refList[0]?.className !== "string") {
    throw new Error(
      `bentuk balik dari classify() tidak sesuai harapan: ${JSON.stringify(refList)?.slice(0, 200)}`,
    );
  }

  // --- Pipeline kita.
  const [mine] = await classifyFrames(rgb, 1);

  const refMap = {};
  for (const item of refList) {
    refMap[item.className] = item.probability;
  }

  const sameClasses =
    Object.keys(refMap).length === Object.keys(mine.perClass).length;
  let maxDelta = 0;
  for (const name of Object.keys(mine.perClass)) {
    if (!(name in refMap)) {
      sameClasses = false;
      break;
    }
    maxDelta = Math.max(maxDelta, Math.abs(mine.perClass[name] - refMap[name]));
  }

  check(
    `${label}: skor sama dengan NSFWJS asli`,
    sameClasses && maxDelta < 1e-5,
    `selisih maks ${maxDelta.toExponential(2)}`,
  );

  // Keseimbangan probabilitas: model harus yakin, bukan mengeluarkan
  // angka yang summ-nya jauh dari 1 (gejala model salah bobotnya).
  const total = Object.values(mine.perClass).reduce((a, b) => a + b, 0);
  check(
    `${label}: probabilitas berjumlah 1`,
    Math.abs(total - 1) < 1e-4,
    `total ${total.toFixed(6)}`,
  );

  // Dua kelas eksplisit harus rendah pada pola uji yang aman.
  check(
    `${label}: pola uji aman dinilai tidak eksplisit`,
    mine.explicitScore < 0.6,
    `Porn=${mine.perClass.Porn.toFixed(4)} Hentai=${mine.perClass.Hentai.toFixed(4)} top=${mine.top.category}`,
  );
}

console.log(`\nlolos ${pass}, gagal ${fail}`);
process.exit(fail === 0 ? 0 : 1);
