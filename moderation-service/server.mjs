/**
 * Layanan moderasi QrHunt.
 *
 * Dijalankan di VPS, dipanggil oleh aplikasi Next.js yang ada di Vercel.
 * Aplikasi tidak pernah memoderasi media secara server-side; tugasnya
 * meneruskan berkas ke sini dan mempercayai jawabannya.
 *
 * Fail-closed adalah kewajiban utama file ini. Kalau layanan tidak bisa dipastikan,
 * jawabannya TIDAK "lolos". Semua jalur kegagalan di bawah berakhir dengan
 * HTTP 5xx supaya pemanggil berubah menjadi 503 `moderation-unavailable`,
 * bukan 422 yang terlihat seperti penolakan moderasi.
 *
 * Menjalankan:
 *   MODERATION_API_KEY=<rahasia> node server.mjs
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { classifyFrames, loadModel, FRAME_SIZE } from "./lib/model.mjs";
import { extractFrames, MAX_FRAMES } from "./lib/frames.mjs";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);

/**
 * Layanan ini hanya boleh dijangkau lewat Caddy di localhost.
 *
 * Mengikat ke 0.0.0.0 akan membuka endpoint moderasi tanpa TLS dan tanpa
 * device gate ke seluruh internet, dan itu mengembalikan seluruh upside
 * moderasi server-side.
 */
const HOST = process.env.MODERATION_HOST || "127.0.0.1";

const API_KEY = process.env.MODERATION_API_KEY || "";

/**
 * Batas ukuran body.
 *
 * Batas unggahan aplikasi 4 MB. Diberi kelonggaran supaya tidak mudah gagal
 * karena overhead, tapi tetap jauh di bawah batas Vercel (4,5 MB) supaya
 * berkas tidak pernah terpotong di tengah jalan.
 */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

/** Ambang skor eksplisit. Sama dengan default SIGHTENGINE_THRESHOLD lama. */
const THRESHOLD = Number.parseFloat(process.env.MODERATION_THRESHOLD || "0.6");

/**
 * Batas inferensi bersamaan.
 *
 tfjs adalah CPU murni: satu inferensi menahan satu inti penuh selama
 * sekitar 2 detik. Empat sekaligus di mesin 4 inti akan membuat semua
 * permintaan membloki, dan lebih baik dilayani antre daripada
 * saling berebut inti.
 */
const MAX_CONCURRENT = Number.parseInt(process.env.MODERATION_CONCURRENCY || "2", 10);

/** Panjang antrean sebelum mulai menolak. */
const MAX_QUEUE = 8;

if (!API_KEY) {
  console.error("[server] MODERATION_API_KEY wajib diisi. Service tidak dijalankan.");
  process.exit(1);
}

/** Bandingkan rahasia dengan waktu tetap, tahan timing attack. */
function secretMatches(provided) {
  if (typeof provided !== "string" || provided.length === 0) return false;
  // Dicocokkan lewat sha256 supaya panjang kedua sisi selalu sama;
  // timingSafeEqual menolak input dengan panjang berbeda.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(API_KEY).digest();
  return timingSafeEqual(a, b);
}

/** Antrean sederhana dengan batas. */
let active = 0;
const waiting = [];

function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  if (waiting.length >= MAX_QUEUE) {
    return Promise.reject(new Error("antrean penuh"));
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) {
    next();
  } else {
    active -= 1;
  }
}

/** Kumpulkan body sampai batas, lalu tolak yang berlebih. */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body melebihi batas"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks, size)));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  response.end(body);
}

/** TIMEOUT seluruh permintaan, termasuk antrean. */
const TOTAL_TIMEOUT_MS = 40_000;

const server = createServer(async (request, response) => {
  const requestId = randomUUID();

  try {
    // --- Health check: tanpa auth, tapi hanya melaporkan, tidak memoderasi.
    if (request.method === "GET" && request.url === "/health") {
      let modelReady = false;
      try {
        await loadModel();
        modelReady = true;
      } catch {
        modelReady = false;
      }
      sendJson(response, modelReady ? 200 : 503, {
        ok: modelReady,
        modelReady,
        threshold: THRESHOLD,
        maxFrames: MAX_FRAMES,
        frameSize: FRAME_SIZE,
        concurrency: { active, waiting: waiting.length },
      });
      return;
    }

    if (request.method !== "POST" || request.url !== "/moderate") {
      sendJson(response, 404, { ok: false, error: "not-found" });
      return;
    }

    // --- Auth sebelum membaca body, biar penyerang tidak bisa
    // membanjiri memori hanya dengan mengirim header.
    const auth = request.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!secretMatches(token)) {
      sendJson(response, 401, { ok: false, error: "unauthorized" });
      return;
    }

    const mime = (request.headers["x-media-type"] || "").split(";")[0].trim();
    if (!mime) {
      sendJson(response, 400, { ok: false, error: "missing-media-type" });
      return;
    }

    const buffer = await readBody(request);
    if (buffer.length === 0) {
      sendJson(response, 400, { ok: false, error: "empty-body" });
      return;
    }

    await acquire();
    let released = false;
    const done = () => {
      if (!released) {
        released = true;
        release();
      }
    };

    try {
      const { pixels, frameCount, durationSeconds } = await extractFrames(buffer, mime);
      const frames = await classifyFrames(pixels, frameCount);

      let worst = null;
      for (const frame of frames) {
        if (!worst || frame.explicitScore > worst.explicitScore) {
          worst = frame;
        }
      }

      const isExplicit = worst.explicitScore >= THRESHOLD;

      console.log(
        `[${requestId}] ${mime} frames=${frameCount} dur=${durationSeconds.toFixed(2)}s ` +
          `porn=${worst.explicitScore.toFixed(3)} kategori=${worst.explicitCategory} ` +
          `-> ${isExplicit ? "DITOLAK" : "lolos"}`,
      );

      sendJson(response, 200, {
        ok: true,
        isExplicit,
        score: worst.explicitScore,
        category: worst.explicitCategory,
        model: "nsfwjs-mobilenet-v2",
        framesScored: frameCount,
        requestId,
        // Per-frame hanya untuk log server, bukan untuk dikembalikan ke klien.
      });
      done();
      return;
    } catch (err) {
      done();
      // Kegagalan apa pun di sini = tidak bisa dinilai. 5xx supaya pemanggil
      // fail-closed, bukan lolos.
      console.error(`[${requestId}] moderasi gagal:`, err.message);
      sendJson(response, 502, {
        ok: false,
        error: "moderation-failed",
        detail: err.message,
        requestId,
      });
      return;
    }
  } catch (err) {
    console.error(`[${requestId}] permintaan gagal:`, err.message);
    if (!response.headersSent) {
      sendJson(response, 500, { ok: false, error: "internal" });
    }
  }
});

// Jaga agar request yang menggantung tidak menahan proses selamanya.
server.requestTimeout = TOTAL_TIMEOUT_MS;
server.headersTimeout = 15_000;

server.listen(PORT, HOST, async () => {
  console.log(`[server] moderasi listening di http://${HOST}:${PORT}`);
  console.log(`[server] ambang=${THRESHOLD} konkurensi=${MAX_CONCURRENT} maksFrame=${MAX_FRAMES}`);
  try {
    await loadModel();
    console.log("[server] model siap, service siap menerima request.");
  } catch (err) {
    // Service tetap hidup supaya /health melaporkan masalah, tapi jangan
    // diam-diam moderasi tanpa model.
    console.error("[server] model GAGAL dimuat:", err.message);
  }
});

// Jangan biarkan PILIHAN yang tidak disengaja menjadi default: service ini
// memegang satu-satunya gerbang moderasi, jadi "server yang diam saja" lebih
// berbahaya daripada crash.
process.on("unhandledRejection", (err) => {
  console.error("[server] unhandledRejection:", err);
});
