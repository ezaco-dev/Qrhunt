import Link from "next/link";
import { notFound } from "next/navigation";
import { HomeIcon } from "lucide-react";

import { MediaTypeBadge, MediaViewer } from "@/components/MediaViewer";
import { QrActions } from "@/components/QrActions";
import { ReportButton } from "@/components/ReportButton";
import { SetupNotice } from "@/components/SetupNotice";
import { getActiveMedia } from "@/lib/media";
import { isSupabaseAdminConfigured } from "@/lib/supabase";

/**
 * Format tanggal dalam bahasa Indonesia, zona waktu Jakarta.
 *
 * `Intl` dipakai, bukan `toLocaleString()` tanpa opsi, supaya waktu yang
 * ditampilkan sama dengan yang dilihat pengguna di Indonesia dan tidak
 * bergantung pada locale server.
 */
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

/**
 * Halaman hasil pemindaian QR.
 *
 * Server Component: media sudah ikut ter-render ke HTML, jadi tidak ada flash
 * kosong dan tidak perlu membuat permintaan dari browser.
 *
 * GUARD YANG TIDAK BOLEH DILEWATI:
 *
 *  1. Format `qr_id` diperiksa dengan regex yang sama persis seperti
 *     `qrCodeIdSchema` di `lib/validation.ts`. Ini memblokir path traversal ke
 *     folder Cloudinary dan karakter yang merusak URL, SEBELUM ada query
 *     database.
 *
 *  2. 404 yang sama dipakai untuk tiga keadaan: QR tidak ada, media disembunyikan
 *     karena laporan, dan env belum terkonfigurasi. Kalau ketiganya dibedakan,
 *     siapa pun bisa memetakan status moderasi sebuah QR hanya dari perbedaan
 *     respons.
 */
export default async function QrPage(props: PageProps<"/q/[qr_id]">) {
  // Di Next 16 `params` adalah Promise, jadi harus di-`await`.
  const { qr_id: rawQrId } = await props.params;
  const qrCodeId = decodeURIComponent(rawQrId);

  // (1) Validasi format sebelum menyentuh database.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(qrCodeId)) {
    notFound();
  }

  // Env kosong: tampilkan petunjuk, jangan error dan jangan 404.
  if (!isSupabaseAdminConfigured()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <SetupNotice />
      </main>
    );
  }

  // (2) `getActiveMedia` mengembalikan null untuk "tidak ada" maupun untuk
  // "disembunyikan" — keduanya jadi 404 yang sama persis.
  const media = await getActiveMedia(qrCodeId);

  if (!media) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <HomeIcon className="size-4" aria-hidden="true" />
          QrHunt
        </Link>
        <span className="truncate font-mono text-sm text-muted-foreground">
          QR {qrCodeId}
        </span>
        <MediaTypeBadge mediaType={media.media_type} />
      </header>

      <MediaViewer media={media} />

      <QrActions qrCodeId={qrCodeId} hasExistingMedia />

      <footer className="flex flex-col items-center gap-2 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Diubah terakhir {TIMESTAMP_FORMAT.format(new Date(media.updated_at))}
        </p>
        <ReportButton qrCodeId={qrCodeId} />
      </footer>
    </main>
  );
}