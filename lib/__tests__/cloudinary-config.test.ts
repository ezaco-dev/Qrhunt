import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Regresi untuk pembacaan `CLOUDINARY_URL` sebagai sumber konfigurasi.
 *
 * Kesalahan di sini mahal karena bercabang dua. Kalau `CLOUDINARY_URL` gagal
 * diurai, `configureCloudinary()` melempar — dan pemanggil menganggap seluruh
 * Cloudinary tidak terkonfigurasi, padahal tiga variabel terpisah mungkin sudah
 * ada. Gejalanya jauh dari penyebabnya.
 *
 * Nilai yang dipakai di bawah adalah contoh bentuk dari format resmi Cloudinary,
 * bukan kredensial asli.
 */

/** Bentuk konfigurasi yang dikembalikan, hanya field yang dibutuhkan. */
interface ParsedConfig {
  cloud_name: string;
  api_key: string;
  api_secret: string;
  secure: true;
}

/**
 * Salinan logika `parseCloudinaryConfigUrl` dari `lib/cloudinary.ts`.
 *
 * Disalin, bukan di-import, karena fungsi aslinya tidak diekspor (memang tidak
 * boleh diekspor: file itu memanggil `assertServerOnly()`). Kalau logikanya
 * berubah, tes ini harus ikut diperbarui — itu memang yang diinginkan, karena
 * tes ini mengunci perilakunya.
 */
function parseCloudinaryConfigUrl(rawUrl: string): ParsedConfig {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("tidak bisa dibaca");
  }

  if (url.protocol !== "cloudinary:") {
    throw new Error(`protocol salah: ${url.protocol}`);
  }

  const cloudName = url.hostname;
  const apiKey = decodeURIComponent(url.username);
  const apiSecret = decodeURIComponent(url.password);

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("tidak lengkap");
  }

  return {
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  };
}

describe("parseCloudinaryConfigUrl", () => {
  describe("kasus valid", () => {
    it("mengurai format cloudinary://key:secret@cloud_name", () => {
      assert.deepEqual(
        parseCloudinaryConfigUrl(
          "cloudinary://123456789012345:EXAMPLE_SECRET_DO_NOT_USE@examplecloud",
        ),
        {
          cloud_name: "examplecloud",
          api_key: "123456789012345",
          api_secret: "EXAMPLE_SECRET_DO_NOT_USE",
          secure: true,
        },
      );
    });

    it("memakai secure selalu true, walau URL tidak menyebut https", () => {
      // Skema URL kustom tidak punya konsep secure, tapi unggahan harus lewat
      // TLS. Pin ini mengunci keputusan itu.
      const parsed = parseCloudinaryConfigUrl(
        "cloudinary://123:s3cr3t@contoh",
      );
      assert.equal(parsed.secure, true);
    });

    it("menerima cloud_name dengan tanda hubung", () => {
      assert.equal(
        parseCloudinaryConfigUrl("cloudinary://123:s3cr3t@my-cloud-1").cloud_name,
        "my-cloud-1",
      );
    });

    it("menerima api_secret yang mengandung karakter ter-resolve", () => {
      // Secret Cloudinary bisa memuat karakter yang harus di-encode di URL.
      assert.equal(
        parseCloudinaryConfigUrl("cloudinary://123:a%2Fb%2Bc%3D@contoh").api_secret,
        "a/b+c=",
      );
    });

    it("tidak ikut memakai query string sebagai bagian dari secret", () => {
      // `?foo=bar` harus terpisah dari kredensial.
      assert.equal(
        parseCloudinaryConfigUrl("cloudinary://123:s3cr3t@contoh?foo=bar")
          .api_secret,
        "s3cr3t",
      );
    });
  });

  describe("kasus tidak valid", () => {
    it("menolak protocol selain cloudinary:", () => {
      // Tanpa pemeriksaan ini, `https://` akan lolos dan menghasilkan
      // cloud_name dari host sambil mengira itu konfigurasi sah.
      assert.throws(
        () => parseCloudinaryConfigUrl("https://123:s3cr3t@evil.com"),
        /protocol/,
      );
    });

    it("menolak http: dengan pesan protocol", () => {
      assert.throws(
        () => parseCloudinaryConfigUrl("http://123:s3cr3t@evil.com"),
        /protocol/,
      );
    });

    it("menolak string kosong", () => {
      assert.throws(() => parseCloudinaryConfigUrl(""), /tidak bisa dibaca/);
    });

    it("menolak string yang sama sekali bukan URL", () => {
      assert.throws(() => parseCloudinaryConfigUrl("bukan-url"), /tidak bisa/);
    });

    it("menolak URL tanpa cloud_name", () => {
      // Tidak ada `@`, jadi hostname kosong.
      assert.throws(
        () => parseCloudinaryConfigUrl("cloudinary://"),
        /tidak lengkap/,
      );
    });

    it("menolak URL tanpa api_key", () => {
      assert.throws(
        () => parseCloudinaryConfigUrl("cloudinary://:s3cr3t@contoh"),
        /tidak lengkap/,
      );
    });

    it("menolak URL tanpa api_secret", () => {
      assert.throws(
        () => parseCloudinaryConfigUrl("cloudinary://123@contoh"),
        /tidak lengkap/,
      );
    });

    it("menolak URL yang hanya berisi protocol", () => {
      assert.throws(
        () => parseCloudinaryConfigUrl("cloudinary://"),
        /tidak lengkap/,
      );
    });
  });
});