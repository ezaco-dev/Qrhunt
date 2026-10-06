/**
 * Verifikasi model NSFWJS self-hosted dengan jalur yang BENAR-BENAR dipakai
 * browser: `tf.loadLayersModel("http://.../model.json")`.
 *
 * Menyalakan server statis kecil di `public/`, memanggil loadLayersModel
 * dengan tfjs 4.22, lalu menjalankan prediksi pada gambar sintetis.
 *
 * Jalankan: node scripts/verify-model.cjs
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const MIME = {
  ".json": "application/json",
  ".bin": "application/octet-stream",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(PUBLIC, path.normalize(urlPath));

  // Cegah path traversal di skrip ini juga.
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404).end("not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = MIME[ext] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": buf.length,
    });
    res.end(buf);
  });
});

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const modelUrl = `http://127.0.0.1:${port}/models/mobilenet_v2/model.json`;
  console.log(`menyaji ${PUBLIC} di port ${port}`);
  console.log(`memuat ${modelUrl}\n`);

  // Penting: muat setelah server menyala supaya fetch HTTP dipakai.
  const tf = require("@tensorflow/tfjs");

  let model;
  try {
    model = await tf.loadLayersModel(modelUrl);
    console.log("✔ loadLayersModel OK");
  } catch (err) {
    console.error("✘ loadLayersModel GAGAL:", err.message);
    server.close();
    process.exitCode = 1;
    return;
  }

  try {
    const out = model.predict(tf.zeros([1, 224, 224, 3]));
    const data = await out.data();
    console.log(`✔ prediksi OK — output ${data.length} nilai`);
    console.log("  softmax:", Array.from(data).map((v) => v.toFixed(4)).join(", "));
  } catch (err) {
    console.error("✘ prediksi GAGAL:", err.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

main();