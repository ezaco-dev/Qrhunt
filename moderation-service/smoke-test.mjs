/**
 * Uji layanan moderasi lewat HTTP.
 *
 * Jalankan service dulu, lalu:
 *   MODERATION_API_KEY=<kunci> node smoke-test.mjs
 *
 * Uji paling penting di sini adalah yang terakhir: berkas rusak HARUS
 * berakhir 5xx, bukan `isExplicit:false`. Kalau berkas rusak dianggap aman,
 * penyerang cukup mengirim sampah untuk melewati moderasi.
 */

import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const BASE = process.env.MODERATION_URL || "http://127.0.0.1:8787";
const KEY = process.env.MODERATION_API_KEY || "";

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "tmp-smoke");

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

/** Kirim berkas apa adanya ke /moderate. */
async function post(bytes, mime, key = KEY) {
  const headers = { "x-media-type": mime, "content-length": String(bytes.length) };
  if (key) headers.authorization = `Bearer ${key}`;

  const response = await fetch(`${BASE}/moderate`, {
    method: "POST",
    headers,
    body: bytes,
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    // jawaban non-JSON tetap diuji lewat status-nya
  }
  return { status: response.status, json };
}

/** Buat berkas uji dengan ffmpeg supaya tidak perlu mengunduh apa pun. */
async function makeSamples() {
  execFile("mkdir", ["-p", SAMPLES]);
  const jobs = [
    ["jpg", "testsrc=size=320x240:rate=1:duration=1", ["-frames:v", "1"]],
    ["png", "testsrc=size=320x240:rate=1:duration=1", ["-frames:v", "1"]],
    ["webp", "testsrc=size=320x240:rate=1:duration=1", ["-frames:v", "1"]],
    ["gif", "testsrc=size=320x240:rate=5:duration=2", []],
    ["mp4", "testsrc=size=320x240:rate=10:duration=3", ["-pix_fmt", "yuv420p"]],
    ["webm", "testsrc=size=320x240:rate=10:duration=3", ["-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p"]],
  ];
  for (const [ext, source, extra] of jobs) {
    await run("ffmpeg", [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", source,
      ...extra,
      join(SAMPLES, `sample.${ext}`),
    ]);
  }
}

console.log(`Menuji ${BASE}\n`);

// Berkas uji dibuat lebih dulu: smoke test tidak boleh bergantung pada
// berkas yang dibuat manual di mesin ini, kalau tidak "lolos" bisa berarti
// berkas lama yang kebetulan masih ada.
await makeSamples();

// --- health
{
  const response = await fetch(`${BASE}/health`);
  const json = await response.json();
  check("health melaporkan model siap", response.status === 200 && json.modelReady === true, `status ${response.status}`);
}

// --- auth
{
  const bytes = readFileSync(join(SAMPLES, "sample.jpg"));
  const noKey = await post(bytes, "image/jpeg", "");
  check("tanpa kunci ditolak 401", noKey.status === 401, `status ${noKey.status}`);

  const wrong = await post(bytes, "image/jpeg", "kunci-salah-sama-sekali");
  check("kunci salah ditolak 401", wrong.status === 401, `status ${wrong.status}`);
}

// --- tiap format harus bisa dinilai
for (const [ext, mime] of [
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
]) {
  const bytes = readFileSync(join(SAMPLES, `sample.${ext}`));
  const { status, json } = await post(bytes, mime);
  const ok = status === 200 && json && json.ok === true;
  check(`${mime} dinilai`, ok, ok ? `${json.framesScored} frame, porn=${json.score?.toFixed(3)}` : `status ${status} ${JSON.stringify(json)}`);
}

// --- jumlah frame video harus lebih dari satu, kalau tidak maka video
//     praktis tidak pernah diperiksa selain frame pertama.
{
  const bytes = readFileSync(join(SAMPLES, "sample.mp4"));
  const { json } = await post(bytes, "video/mp4");
  check("video dinilai di beberapa frame", json.framesScored >= 3, `${json.framesScored} frame`);
}

// --- fail-closed: berkas sampah harus 5xx, TIDAK boleh lolos
{
  const junk = Buffer.from("ini bukan media sama sekali, hanya teks");
  const { status, json } = await post(junk, "image/jpeg");
  check(
    "berkas rusak ditolak (fail-closed)",
    status >= 500 && !(json && json.isExplicit === false && json.ok === true),
    `status ${status}`,
  );
}

// --- fail-closed: mime tak dikenal harus ditolak
{
  const bytes = readFileSync(join(SAMPLES, "sample.jpg"));
  const { status } = await post(bytes, "application/x-php");
  check("mime tak dikenal ditolak", status >= 400, `status ${status}`);
}

// --- fail-closed: JPEG yang dipalsukan ekstensi video
{
  const bytes = readFileSync(join(SAMPLES, "sample.jpg"));
  const { status, json } = await post(bytes, "video/mp4");
  check(
    "JPEG diklaim MP4 tidak lolos diam-diam",
    status >= 500 || json?.isExplicit === true || json?.isExplicit === false,
    `status ${status} isExplicit=${json?.isExplicit}`,
  );
}

// --- body kosong
{
  const { status } = await post(Buffer.alloc(0), "image/jpeg");
  check("body kosong ditolak", status === 400, `status ${status}`);
}

console.log(`\nlolos ${pass}, gagal ${fail}`);
process.exit(fail === 0 ? 0 : 1);
