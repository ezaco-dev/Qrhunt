import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { HomeIcon } from "lucide-react";

import { AdsenseAdUnit } from "@/components/AdsenseAdUnit";
import { MediaTypeBadge, MediaViewer } from "@/components/MediaViewer";
import { QrActions } from "@/components/QrActions";
import { QrKickedNotice } from "@/components/QrKickedNotice";
import { ReportButton } from "@/components/ReportButton";
import { SetupNotice } from "@/components/SetupNotice";
import { checkQrAccess, getMediaBySubId } from "@/lib/media";
import { isSupabaseAdminConfigured } from "@/lib/supabase";

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

/**
 * Halaman publik media berdasarkan Sub-ID Media (`/m/[media_id]`).
 *
 * Ini adalah URL yang tampil di browser bar pengguna. ID QR fisik disembunyikan
 * dari pengguna.
 */
export default async function MediaSubIdPage(props: {
  params: Promise<{ media_id: string }>;
}) {
  const { media_id: rawMediaId } = await props.params;
  const mediaId = decodeURIComponent(rawMediaId);

  if (!isSupabaseAdminConfigured()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <SetupNotice />
      </main>
    );
  }

  // (1) Ambil media berdasarkan sub ID dan pastikan media ini masih aktif terkini
  const media = await getMediaBySubId(mediaId);

  if (!media) {
    notFound();
  }

  // (2) Cek apakah pengguna ditendang dari QR code ini (rate limit per device)
  const cookieStore = await cookies();
  const deviceId = cookieStore.get("qrhunt_device_id")?.value;
  const lastUploadCookie = cookieStore.get(`qrhunt_last_upload_${media.qr_code_id}`)?.value;
  const cookieTs = lastUploadCookie ? Number.parseInt(lastUploadCookie, 10) : null;

  const accessBlock = await checkQrAccess(media.qr_code_id, deviceId, cookieTs);

  if (accessBlock.isBlocked) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-16">
        <QrKickedNotice
          qrCodeId={media.qr_code_id}
          hoursLeft={accessBlock.hoursLeft}
          minutesLeft={accessBlock.minutesLeft}
          uniqueUploadersLeft={accessBlock.uniqueUploadersLeft}
        />
      </main>
    );
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
        <MediaTypeBadge mediaType={media.media_type} />
      </header>

      <MediaViewer media={media} />

      <QrActions qrCodeId={media.qr_code_id} hasExistingMedia />

      <footer className="flex flex-col items-center gap-2 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Diubah terakhir {TIMESTAMP_FORMAT.format(new Date(media.updated_at))}
        </p>
        <ReportButton qrCodeId={media.qr_code_id} />
        <div className="mt-4 flex w-full justify-center">
          <AdsenseAdUnit
            slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM || ""}
            width={300}
            height={250}
            format="rectangle"
          />
        </div>
      </footer>
    </main>
  );
}
