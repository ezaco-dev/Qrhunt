import {
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  ImagesIcon,
  ShieldCheckIcon,
} from "lucide-react";

/**
 * Tiga langkah utama produk.
 *
 * Sengaja pendek dan tanpa jargon: yang membaca halaman ini adalah pemilik
 * warung, bukan pembaca dokumentasi.
 */
const STEPS: readonly { title: string; body: string }[] = [
  {
    title: "Scan",
    body: "Pindai QR code yang tertempel. Satu media langsung tampil.",
  },
  {
    title: "Ganti",
    body: "Ingin mengubahnya? Buka lagi dan pasang yang baru. Tidak perlu login.",
  },
  {
    title: "Otomatis",
    body: "Media lama terhapus begitu media baru tersimpan. Tidak menumpuk.",
  },
];

const MEDIA_KINDS: readonly {
  label: string;
  detail: string;
  icon: typeof ImageIcon;
}[] = [
  { label: "Gambar", detail: "JPG, PNG, WebP", icon: ImageIcon },
  { label: "GIF", detail: "Bergerak seperti gif biasa", icon: ImagesIcon },
  { label: "Video pendek", detail: "MP4/WebM, maksimal 10 detik", icon: FilmIcon },
  { label: "Teks", detail: "Papan pesan atau daftar harga", icon: FileTextIcon },
];

/**
 * Landing page.
 *
 * Server Component murni, tanpa satu pun interaksi: seluruh isinya statis dan
 * boleh di-prerender saat build.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 py-12 sm:py-16">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium text-muted-foreground">QrHunt</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Satu QR code, satu media, bisa diganti siapa pun.
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Tempel satu QR code di meja Anda. Siapa pun yang memindainya melihat
          foto, video, atau teks Anda. Anda sendiri pun bisa menggantinya.
          Tidak ada akun, tidak ada pendaftaran.
        </p>
      </header>

      <section aria-labelledby="langkah-heading">
        <h2 id="langkah-heading" className="mb-4 text-lg font-semibold">
          Cara kerjanya
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-xl border p-4">
              <p className="text-xs font-medium text-muted-foreground">
                {index + 1}. {step.title}
              </p>
              <p className="mt-1 text-sm">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="media-heading">
        <h2 id="media-heading" className="mb-4 text-lg font-semibold">
          Media yang didukung
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {MEDIA_KINDS.map((kind) => (
            <li key={kind.label} className="flex items-start gap-3 rounded-xl border p-4">
              <kind.icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">{kind.label}</p>
                <p className="text-sm text-muted-foreground">{kind.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheckIcon className="size-5" aria-hidden="true" />
          Moderasi berlapis
        </h2>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>
            Browser memindai media sebelum dikirim, supaya berkas yang jelas-jelas
            bermasalah tidak pernah wasting kuota layanan moderasi.
          </li>
          <li>
            Server memeriksa ulang setiap unggahan. Pemeriksaan browser memang
            bisa dilewati; pemeriksaan server tidak.
          </li>
          <li>
            Kalau moderasi tidak tersedia, unggahan DITOLAK — bukan lolos
            diam-diam.
          </li>
          <li>Media yang dilaporkan terlalu banyak otomatis disembunyikan.</li>
        </ul>
      </section>

      <footer className="border-t pt-6 text-center text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} QrHunt. All rights reserved.
      </footer>
    </main>
  );
}