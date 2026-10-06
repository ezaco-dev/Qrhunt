import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCloudinaryUrl } from "@/lib/cloudinary";

/**
 * Regresi untuk `parseCloudinaryUrl`.
 *
 * Parser ini mencari aset yang harus dihapus saat media diganti. Karena tabel hanya
 * menyimpan `media_url`, kalau parser mengembalikan `null` untuk URL yang
 * sebenarnya valid, file lama tidak akan pernah terhapus dan kuota Cloudinary
 * bocor terus-menerus. Kalau parser terlalu longgar, ia bisa mengembalikan
 * `publicId` yang salah dan menghapus aset orang lain.
 *
 * Karena itu cakupannya TIDAK boleh dikurangi. Kalau sebuah aturan disederhanakan,
 * jumlah kasus di sini harus ikut bertambah atau sama.
 */
describe("parseCloudinaryUrl", () => {
  describe("kasus valid", () => {
    it("mengambil public_id dan resource_type dari URL dasar", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/qrhunt/UMKM_001/abc123",
        ),
        { publicId: "qrhunt/UMKM_001/abc123", resourceType: "image" },
      );
    });

    it("membuang satu segmen versi", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/v1234567890/qrhunt/UMKM_001/abc123",
        ),
        { publicId: "qrhunt/UMKM_001/abc123", resourceType: "image" },
      );
    });

    it("membuang ekstensi dari segmen terakhir saja", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/qrhunt/UMKM_001/abc123.jpg",
        ),
        { publicId: "qrhunt/UMKM_001/abc123", resourceType: "image" },
      );
    });

    it("membuang query string", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/qrhunt/UMKM_001/abc123.jpg?w_640&q_auto",
        ),
        { publicId: "qrhunt/UMKM_001/abc123", resourceType: "image" },
      );
    });

    it("membuang fragment", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/qrhunt/UMKM_001/abc123.jpg#anchor",
        ),
        { publicId: "qrhunt/UMKM_001/abc123", resourceType: "image" },
      );
    });

    it("membuang query string sekaligus fragment", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/video/upload/qrhunt/UMKM_001/vid.mp4?f_mp4#t=2",
        ),
        { publicId: "qrhunt/UMKM_001/vid", resourceType: "video" },
      );
    });

    it("menangani resource_type video", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/video/upload/qrhunt/UMKM_001/clip.mp4",
        ),
        { publicId: "qrhunt/UMKM_001/clip", resourceType: "video" },
      );
    });

    it("membuang ekstensi video", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/video/upload/qrhunt/UMKM_001/clip.webm",
        ),
        { publicId: "qrhunt/UMKM_001/clip", resourceType: "video" },
      );
    });

    it("mempertahankan titik di tengah public_id", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/qrhunt/UMKM_001/a.b.jpg",
        ),
        { publicId: "qrhunt/UMKM_001/a.b", resourceType: "image" },
      );
    });

    it("membuang hanya satu ekstensi terakhir dari nama berkilau", () => {
      // `a.b.c` dipecah dari titik TERAKHIR saja, jadi `c` adalah ekstensi dan
      // `a.b` tetap bagian dari nama. Perilaku ini konsisten dengan kasus
      // `a.b.jpg` → `a.b` di atas.
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/qrhunt/UMKM_001/a.b.c",
        ),
        { publicId: "qrhunt/UMKM_001/a.b", resourceType: "image" },
      );
    });

    it("mempertahankan titik di segmen folder", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/qrhunt/v1.2/UMKM_001/promo.png",
        ),
        { publicId: "qrhunt/v1.2/UMKM_001/promo", resourceType: "image" },
      );
    });

    it("mempertahankan folder bernama 'video'", () => {
      // Folder bernama `video` bukan segmen versi dan tidak boleh terpotong.
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/qrhunt/video/promo",
        ),
        { publicId: "qrhunt/video/promo", resourceType: "image" },
      );
    });

    it("mempertahankan public_id berawalan angka", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/qrhunt/UMKM_001/20240101",
        ),
        { publicId: "qrhunt/UMKM_001/20240101", resourceType: "image" },
      );
    });

    it("membuang paling banyak satu segmen versi", () => {
      // Hanya `v1234567890` pertama yang versi. `v2` berikutnya adalah bagian
      // dari public_id dan harus ikut tersisa.
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/v1111111111/v2/promo.png",
        ),
        { publicId: "v2/promo", resourceType: "image" },
      );
    });

    it("mengenali resource_type raw", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/raw/upload/qrhunt/UMKM_001/notes.txt",
        ),
        { publicId: "qrhunt/UMKM_001/notes", resourceType: "raw" },
      );
    });

    it("menangani path dengan slash ganda", () => {
      assert.deepEqual(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload//qrhunt/UMKM_001//abc.jpg",
        ),
        { publicId: "qrhunt/UMKM_001/abc", resourceType: "image" },
      );
    });
  });

  describe("kasus tidak valid", () => {
    it("menolak host yang bukan res.cloudinary.com", () => {
      assert.equal(
        parseCloudinaryUrl(
          "https://evil.com/demo/image/upload/qrhunt/UMKM_001/abc123",
        ),
        null,
      );
    });

    it("menolak host yang menyerupai res.cloudinary.com", () => {
      assert.equal(
        parseCloudinaryUrl(
          "https://res.cloudinary.com.evil.com/demo/image/upload/a/b/c",
        ),
        null,
      );
    });

    it("menolak http (hanya https)", () => {
      assert.equal(
        parseCloudinaryUrl(
          "http://res.cloudinary.com/demo/image/upload/qrhunt/UMKM_001/abc",
        ),
        null,
      );
    });

    it("menolak segmen deliver, bukan cuma upload", () => {
      // `deliver/...` adalah URL transformasi. Public id aslinya ada di segmen
      // `upload`, jadi URL ini tidak bisa dipakai untuk menghapus aset.
      assert.equal(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/deliver/qrhunt/UMKM_001/abc.jpg",
        ),
        null,
      );
    });

    it("menolak fewer dari empat segmen", () => {
      assert.equal(parseCloudinaryUrl("https://res.cloudinary.com/demo/image/upload"), null);
      assert.equal(parseCloudinaryUrl("https://res.cloudinary.com/demo/image"), null);
    });

    it("menolak string kosong", () => {
      assert.equal(parseCloudinaryUrl(""), null);
    });

    it("menolak string yang bukan URL sama sekali", () => {
      assert.equal(parseCloudinaryUrl("bukan-url"), null);
      assert.equal(parseCloudinaryUrl("/q/UMKM_001"), null);
    });

    it("menolak URL yang '@' menyamar sebagai kredensial", () => {
      // WHATWG URL menaruh `res.cloudinary.com` di posisi `username`, jadi
      // `hostname` sebenarnya `evil.com` dan harus ditolak.
      assert.equal(
        parseCloudinaryUrl(
          "https://res.cloudinary.com@evil.com/demo/image/upload/a/b/c",
        ),
        null,
      );
    });

    it("menolak path yang hanya berisi segmen versi", () => {
      assert.equal(
        parseCloudinaryUrl(
          "https://res.cloudinary.com/demo/image/upload/v1234567890",
        ),
        null,
      );
    });
  });
});