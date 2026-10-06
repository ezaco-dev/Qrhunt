import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { assertServerOnly } from "@/lib/supabase";

// Modul ini memegang MODERATION_API_KEY dan MODERATION_CA_PEM - tidak boleh
// masuk ke browser.
assertServerOnly();

/**
 * Klien untuk layanan moderasi yang berjalan di VPS.
 *
 * Layanan itu menjalankan model NSFWJS yang sama dengan yang dipakai di
 * browser, tapi di sisi server, jadi inilah satu-satunya penjaga moderasi.
 * Pemeriksaan di `lib/nsfw-client.ts` tetap hanya UX.
 *
 * Kontrak yang dijaga file ini:
 *
 * 1. Fail-closed. Apapun yang membuat jawaban meragukan - layanan mati, timeout,
 *    koneksi terputus, HTTP 5xx, JSON rusak, `isExplicit` yang bukan boolean -
 *    dilempar sebagai error. Pemanggil membalas 503 `moderation-unavailable`.
 *    Tidak ada satu pun dari kondisi itu yang boleh berakhir sebagai "lolos".
 *
 * 2. Rahasia tidak bocor. MODERATION_API_KEY hanya dipakai di sini dan hanya
 *    di sisi server.
 *
 * 3. Sertifikat dipin, bukan dipercaya buta.
 *
 *    VPS tidak punya record DNS untuk subdomain moderasi, jadi layanan itu
 *    dilayani langsung di IP dengan sertifikat self-signed. Sertifikat itu
 *    TIDAK ada di system trust store siapa pun; satu-satunya alasan klien
 *    menerimanya adalah `MODERATION_CA_PEM`. Tanpa env itu, permintaan https
 *    ke luar loopback ditolak sebelum dikirim.
 *
 *    Yang dijaga: penyerang yang berada di tengah jalur Vercel -> VPS tidak
 *    punya private key sertifikat itu, jadi tidak bisa menyamar sebagai
 *    server moderasi, dan MODERATION_API_KEY selalu terkirim terenkripsi.
 *    Karena itu `http://` ke selain loopback tetap ditolak.
 */

/** Hasil moderasi satu media. */
export interface ModerationResult {
  isExplicit: boolean;
  /** Skor kelas eksplisit tertinggi yang ditemukan. */
  score: number;
  /** Kelas yang menghasilkan skor itu: "Porn" atau "Hentai". */
  category: string;
  model: string;
  /** Alasan singkat yang aman ditampilkan ke pengguna. */
  reason: string;
  requestId: string | null;
}

/** Respons HTTP mentah dari layanan moderasi. */
interface ModerationHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<Record<string, unknown>>;
}

/**
 * Timeout pemanggilan layanan.
 *
 * HARUS lebih kecil daripada `maxDuration` route (60 detik), kalau tidak Vercel
 * yang lebih dulu membalas dengan 504 dan pemanggil tidak sempat mengubahnya
 * jadi 503 yang rapi.
 *
 * Bawaan 45 detik bukan angka sembarangan. Inferensi di VPS diukur sekitar
 * 2,5 detik per frame, dan video dinilai sampai 8 frame, jadi satu permintaan
 * bisa memang memakan waktu hampir 20 detik. Timeout 8 detik (yang pernah
 * dipakai sebelumnya) membuat video yang sah selalu gagal dimoderasi.
 */
function getTimeoutMs(): number {
  const raw = process.env.MODERATION_TIMEOUT_MS;
  if (!raw) return 45_000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1_000) return 45_000;
  return parsed;
}

/** True bila layanan moderasi dikonfigurasi. */
export function isModerationConfigured(): boolean {
  return Boolean(
    process.env.MODERATION_SERVICE_URL && process.env.MODERATION_API_KEY,
  );
}

const LOOPBACK_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/;

/**
 * Ambil jangkar kepercayaan TLS untuk layanan moderasi.
 *
 * Melempar error kalau konfigurasi tidak aman. Karena pemanggil route
 * mengubah SEMUA error moderasi jadi 503, kondisi yang gagal di sini berakhir
 * sebagai penolakan, bukan kelulusan.
 *
 * `MODERATION_CA_PEM` menerima dua bentuk:
 *   - PEM apa adanya (multiline), atau
 *   - base64 dari PEM itu, dipakai supaya tidak bergantung pada penanganan
 *     kutip multiline di berkas env maupun di dashboard Vercel.
 */
function resolveTrustAnchor(baseUrl: string): string | undefined {
  const isLoopback = LOOPBACK_RE.test(baseUrl);

  // Plaintext ke luar loopback. Bukan soal kerapian: kunci dan isi unggahan
  // akan terbaca orang di tengah, dan orang itu bisa memalsukan jawaban
  // moderasi. Ditolak sebelum request dibuat.
  if (baseUrl.startsWith("http://") && !isLoopback) {
    throw new Error(
      "MODERATION_SERVICE_URL harus https:// kecuali menunjuk ke loopback. " +
        "http:// tanpa TLS membuat MODERATION_API_KEY dan isi unggahan " +
        "terbaca oleh siapa pun yang berada di tengah jalur.",
    );
  }

  // Loopback tidak melewati internet, jadi tidak perlu pin.
  if (isLoopback) return undefined;

  const raw = process.env.MODERATION_CA_PEM?.trim();
  if (!raw) {
    throw new Error(
      "MODERATION_CA_PEM belum diisi. Sertifikat layanan moderasi di VPS " +
        "bersifat self-signed, jadi tanpa pin ini tidak ada jaminan bahwa " +
        "kita sedang bicara dengan server kita sendiri.",
    );
  }

  const pem = raw.includes("-----BEGIN CERTIFICATE-----")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");

  if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error(
      "MODERATION_CA_PEM bukan sertifikat PEM yang valid, baik dalam bentuk " +
        "PEM maupun base64 dari PEM.",
    );
  }

  return pem;
}

/**
 * Kirim satu POST ke layanan moderasi.
 *
 * Sengaja memakai `node:http`/`node:https`, bukan `fetch`. fetch di Node tidak
 * menerima CA kustom tanpa dispatcher undici, dan tanpa CA kustom sertifikat
 * self-signed di VPS selalu ditolak sehingga semua moderasi gagal.
 *
 * `AbortSignal.timeout` dipakai sebagai batas WAKTU MUTLAK, sama seperti
 * perilaku fetch sebelumnya. Memakai timeout per-socket malah berarti permintaan
 * yang menggantung pelan-pelan dianggap sehat dan tidak pernah diputus.
 */
function postModeration(
  endpoint: string,
  apiKey: string,
  mediaType: string,
  body: Buffer,
  ca: string | undefined,
): Promise<ModerationHttpResponse> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      reject(
        new Error(`MODERATION_SERVICE_URL bukan URL yang valid: ${endpoint}`),
      );
      return;
    }

    const isSecure = url.protocol === "https:";
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : isSecure ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/octet-stream",
        "x-media-type": mediaType,
        "content-length": body.byteLength,
      },
      signal: AbortSignal.timeout(getTimeoutMs()),
    };

    if (isSecure && ca) options.ca = ca;

    const request = isSecure ? httpsRequest : httpRequest;
    let settled = false;

    const req = request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on("data", (chunk: Buffer) => chunks.push(chunk));

      res.on("end", () => {
        settled = true;
        const status = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => JSON.parse(text) as Record<string, unknown>,
        });
      });

      // Respons yang terputus di tengah jalan tidak boleh dianggap selesai.
      // Tanpa ini, respons setengah jadi bisa terbaca sebagai 5xx yang tidak
      // jelas, atau lebih buruk lagi, sebagai payload yang tidak utuh.
      res.on("close", () => {
        if (settled) return;
        reject(
          new Error(
            "Koneksi ke layanan moderasi terputus sebelum respons selesai.",
          ),
        );
      });
    });

    req.on("error", reject);
    req.end(body);
  });
}

/**
 * Moderasi media di server. Ini adalah SUMBER KEBENARAN.
 *
 * Melempar error berarti "tidak bisa dinilai", dan pemanggil wajib memperlakukannya
 * sebagai penolakan sementara (503), bukan kelulusan.
 */
export async function moderateMedia(file: File): Promise<ModerationResult> {
  const baseUrl = process.env.MODERATION_SERVICE_URL;
  const apiKey = process.env.MODERATION_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "MODERATION_SERVICE_URL dan MODERATION_API_KEY belum diisi. " +
        "Moderasi server WAJIB ada sebelum produksi.",
    );
  }

  // Normalisasi URL supaya tidak ada garis miring ganda kalau env ditulis
  // dengan trailing slash.
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/moderate`;

  // Dihitung lebih dulu supaya konfigurasi yang tidak aman gagal sebelum ada
  // satu byte pun yang dikirim.
  const ca = resolveTrustAnchor(baseUrl);

  const response = await postModeration(
    endpoint,
    apiKey,
    file.type,
    Buffer.from(await file.arrayBuffer()),
    ca,
  );

  if (!response.ok) {
    // 401 berarti konfigurasi salah (kunci tidak cocok). Itu bug, bukan
    // content policy, dan tidak boleh disamarkan jadi "moderasi gagal".
    throw new Error(
      `Layanan moderasi menjawab HTTP ${response.status}` +
        (response.status === 401
          ? " (401: MODERATION_API_KEY tidak cocok dengan yang di VPS)"
          : ""),
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Layanan moderasi mengirim JSON yang tidak bisa dibaca.");
  }

  // Validasi ketat. `isExplicit` yang hilang atau salah tipe berarti kita TIDAK
  // tahu jawabannya. `payload.isExplicit === false` yang di-cast di sini
  // persis kesalahan yang membuat filter bocor tanpa terlihat.
  if (payload.ok !== true || typeof payload.isExplicit !== "boolean") {
    throw new Error(
      "Layanan moderasi menjawab tanpa verdict yang bisa dipercaya.",
    );
  }

  const score = typeof payload.score === "number" ? payload.score : 0;
  const category = typeof payload.category === "string" ? payload.category : "";
  const model = typeof payload.model === "string" ? payload.model : "unknown";
  const isExplicit = payload.isExplicit;

  return {
    isExplicit,
    score,
    category,
    model,
    reason: isExplicit
      ? `Konten terdeteksi eksplisit (${category || "pornografi"}, skor ${score.toFixed(2)}).`
      : "Konten lolos moderasi otomatis.",
    requestId: typeof payload.requestId === "string" ? payload.requestId : null,
  };
}
