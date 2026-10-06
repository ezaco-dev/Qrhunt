/**
 * Ekstrak frame dari media yang diunggah memakai ffmpeg, lalu ubah jadi
 * RGB24 mentah 224x224 yang bisa langsung jadi tensor.
 *
 * Kenapa ffmpeg dan bukan pustaka decoder per-format: satu perintah menutup
 * JPEG, PNG, WebP, GIF, MP4, WebM, dan MOV sekaligus. Menulis tujuh decoder
 * (jpeg-js, pngjs, WASM WebP, ...) berarti tujuh tempat bug baru.
 *
 * Dua jebakan ffmpeg yang sudah diuji di sini, bukan ditebak:
 *
 * 1. Filter `fps` MEMBUANG gambar diam. Sebuah JPEG punya durasi 0,04 s dan
 *    hanya satu frame pada t=0; filter `fps=1/1` tidak menghasilkan apa pun
 *    dan ffmpeg keluar dengan "Output file is empty". Tanpa filter itu, satu
 *    JPEG menghasilkan tepat satu frame. Jadi cabang gambar dan cabang
 *    video/GIF memang wajib dipisah.
 *
 * 2. Deteksi format dari pipe (`-i pipe:0`) hanya jalan untuk video dan GIF.
 *    Demuxer `image2` memerlukan pola nama berkas, jadi gambar SELALU harus
 *    lewat berkas sementara.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FRAME_SIZE } from "./model.mjs";

/** Berapa frame paling banyak yang dinilai per unggahan. */
export const MAX_FRAMES = 8;

/** Durasi maksimum video/GIF yang boleh diproses, dalam detik. */
export const MAX_DURATION_SECONDS = 60;

/**
 * Peta mime ke ekstensi berkas sementara.
 *
 * Extensi di sini TIDAK berasal dari nama berkas kiriman. Kalau berasal dari
 * kiriman, penyerang bisa menuliskan `evil.php` atau `../../etc/passwd` dan
 * controlling nama berkas. Allowlist di bawah menutup kemungkinan itu: mime
 * yang tidak dikenal ditolak sebelum menyentuh diska.
 */
const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** Timeout tiap proses child. ffmpeg yang macet tidak boleh menahan selamanya. */
const TIMEOUT_MS = 15_000;

/** Batas output. 8 frame x 224 x 224 x 3 = 1.204.224 byte. */
const MAX_OUTPUT_BYTES = MAX_FRAMES * FRAME_SIZE * FRAME_SIZE * 3;

/**
 * Jalankan satu perintah dan kembalikan stdout sebagai Buffer.
 *
 * stderr tidak dibuang diam-diam: kalau ffmpeg gagal, alasannya ada di sana
 * dan tanpanya sulit membedakan "video rusak" dari "ffmpeg tidak terpasang".
 */
function run(cmd, args, { input, maxBuffer }) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { timeout: TIMEOUT_MS, maxBuffer, encoding: "buffer" },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr ? stderr.toString().trim().split("\n").pop() : "";
          reject(new Error(`${cmd} gagal: ${err.message}${detail ? ` (${detail})` : ""}`));
          return;
        }
        resolve(stdout);
      },
    );
    if (input) {
      child.stdin.end(input);
    }
  });
}

/** Baca durasi media. Gagal atau tidak ada durasi -> 0, yang ditangani pemanggil. */
async function probeDuration(path) {
  try {
    const out = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    const seconds = Number.parseFloat(out.toString().trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    // Durasi tidak diketahui bukan alasan menolak: beberapa container yang sah
    // tidak melaporkannya. Pemanggil akan jatuh ke sampling yang aman.
    return 0;
  }
}

/**
 * Ubah media menjadi frame RGB24.
 *
 * Mengembalikan `{ pixels, frameCount, durationSeconds }`. Kalau ffmpeg tidak
 * menghasilkan satu pun frame, fungsi ini melempar error.
 *
 * Melempar di sini disengaja dan penting: kalau frame kosong dianggap "aman",
 * penyerang cukup mengirim berkas yang rusak atau format tak didukung untuk
 * melewati moderasi sepenuhnya. Nol frame berarti "tidak bisa dinilai", dan
 * "tidak bisa dinilai" harus berakhir sebagai penolakan, bukan kelulusan.
 */
export async function extractFrames(buffer, mime) {
  const ext = MIME_TO_EXT[mime];
  if (!ext) {
    throw new Error(`tipe media tidak didukung: ${mime}`);
  }

  const dir = mkdtempSync(join(tmpdir(), "qrhunt-mod-"));
  // mkdtemp sudah bikin 0700 di POSIX, tapi namesake eksplisit lebih aman
  // daripada bergantung pada perilaku itu.
  chmodSync(dir, 0o700);
  const path = join(dir, `input.${ext}`);

  try {
    writeFileSync(path, buffer, { mode: 0o600 });

    const isStillImage = mime.startsWith("image/") && mime !== "image/gif";
    const durationSeconds = isStillImage ? 0 : await probeDuration(path);

    if (durationSeconds > MAX_DURATION_SECONDS) {
      throw new Error(
        `durasi ${durationSeconds.toFixed(1)} d detik melebihi batas ${MAX_DURATION_SECONDS} d detik`,
      );
    }

    // Untuk video/GIF, jumlah frame diambil merata sepanjang durasi.
    // Durasi 0 (tidak dilaporkan) -> cukup satu frame, sama seperti gambar.
    const frameCount =
      isStillImage || durationSeconds === 0
        ? 1
        : Math.min(MAX_FRAMES, Math.max(1, Math.ceil(durationSeconds)));

    const rate = frameCount / durationSeconds;
    const filter = isStillImage
      ? `scale=${FRAME_SIZE}:${FRAME_SIZE}`
      : `fps=${rate},scale=${FRAME_SIZE}:${FRAME_SIZE}`;

    const pixels = await run(
      "ffmpeg",
      [
        "-loglevel",
        "error",
        "-i",
        path,
        "-an", // buang audio
        "-sn", // buang subtitle
        "-dn", // buang data
        "-vf",
        filter,
        "-frames:v",
        String(frameCount),
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
      ],
      { maxBuffer: MAX_OUTPUT_BYTES },
    );

    const bytesPerFrame = FRAME_SIZE * FRAME_SIZE * 3;
    const actual = Math.floor(pixels.length / bytesPerFrame);
    if (actual === 0) {
      throw new Error("ffmpeg tidak menghasilkan frame sama sekali");
    }

    return {
      pixels: pixels.subarray(0, actual * bytesPerFrame),
      frameCount: actual,
      durationSeconds,
    };
  } finally {
    // Hapus apa pun yang terjadi. Isi unggahan pengguna tidak boleh tertinggal
    // di /tmp kalau ffmpeg gagal atau prosesnya dibunuh.
    rmSync(dir, { recursive: true, force: true });
  }
}
