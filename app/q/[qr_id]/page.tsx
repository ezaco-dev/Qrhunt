import { notFound, redirect } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import { getActiveMedia } from "@/lib/media";
import { isSupabaseAdminConfigured } from "@/lib/supabase";

/**
 * Halaman pemindaian QR statis (`/q/[qr_id]`).
 *
 * Pemindaian fisik QR menunjuk ke path ini. Ketika dipindai, server langsung
 * mengalihkan (HTTP 307 redirect) ke URL sub-ID media aktif (`/m/[media_id]`),
 * sehingga ID QR fisik tidak pernah tampil di baris URL browser pengguna.
 */
export default async function QrPage(props: PageProps<"/q/[qr_id]">) {
  const { qr_id: rawQrId } = await props.params;
  const qrCodeId = decodeURIComponent(rawQrId);

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(qrCodeId)) {
    notFound();
  }

  if (!isSupabaseAdminConfigured()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <SetupNotice />
      </main>
    );
  }

  const media = await getActiveMedia(qrCodeId);

  if (!media) {
    notFound();
  }

  // Pengalihan otomatis ke sub-ID media
  redirect(`/m/${media.id}`);
}
