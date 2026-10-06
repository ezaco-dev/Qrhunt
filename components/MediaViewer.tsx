import Image from "next/image";
import { FileTextIcon, FilmIcon, ImageIcon, ImagesIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MediaType, PublicQrMedia } from "@/lib/types";

/**
 * Kelas bingkai, dipakai semua tipe media supaya ukurannya konsisten.
 * Nilai murni (tanpa efek samping) supaya aman dipanggil dari render.
 */
const FRAME_CLASS =
  "aspect-video w-full overflow-hidden rounded-xl border bg-muted";

/** Label & ikon per tipe, untuk badge di header. */
const MEDIA_META: Record<MediaType, { label: string; icon: LucideIcon }> = {
  image: { label: "Gambar", icon: ImageIcon },
  video: { label: "Video", icon: FilmIcon },
  gif: { label: "GIF", icon: ImagesIcon },
  text: { label: "Teks", icon: FileTextIcon },
};

export function MediaTypeIcon({ mediaType }: { mediaType: MediaType }) {
  const Icon = MEDIA_META[mediaType]?.icon ?? FileTextIcon;
  return <Icon className="size-4" aria-hidden="true" />;
}

export function mediaTypeLabel(mediaType: MediaType): string {
  return MEDIA_META[mediaType]?.label ?? "Media";
}

export function MediaTypeBadge({ mediaType }: { mediaType: MediaType }) {
  return (
    <Badge variant="secondary">
      <MediaTypeIcon mediaType={mediaType} />
      {mediaTypeLabel(mediaType)}
    </Badge>
  );
}

/** Fallback untuk data rusak: halaman tidak boleh 500, tapi viewer harus jujur. */
function Unavailable({ reason }: { reason: string }) {
  return (
    <div
      className={cn(FRAME_CLASS, "grid place-items-center p-6 text-center text-sm text-muted-foreground")}
    >
      {reason}
    </div>
  );
}

/**
 * Tampilan media yang sedang aktif.
 *
 * Server Component murni — tidak ada satu pun hook atau handler di sini.
 *
 * Catatan yang wajib dipertahankan saat mengubah:
 *
 *  - GIF harus `unoptimized`. Optimizer Next mengambil satu frame pertama dan
 *    menghilangkan animasinya, jadi GIF berhenti bergerak.
 *  - Video TIDAK memakai autoplay. Pemutaran otomatis tanpa suara yang tidak
 *    disentuh pengguna adalah perilaku yang menyebalkan sekaligus boros kuota
 *    data pengguna.
 *  - `alt` selalu generik. Nama berkas atau nama asli bisa membocorkan identitas
 *    pemilik media, sementara aplikasi ini anonim.
 */
export function MediaViewer({ media }: { media: PublicQrMedia }) {
  if (media.media_type === "text") {
    const text = media.text_content;
    if (!text) {
      return <Unavailable reason="Teks tidak tersedia." />;
    }

    return (
      // Teks bisa jauh lebih panjang dari video, jadi bingkai boleh tumbuh dan
      // digulir alih-alih memotong isi.
      <div className={cn(FRAME_CLASS, "flex max-h-[70vh] items-start overflow-y-auto p-5")}>
        {/* `whitespace-pre-wrap` menjaga baris baru dari author; `break-words`
            mencegah URL panjang meluber keluar kotak. */}
        <p className="text-base whitespace-pre-wrap break-words">{text}</p>
      </div>
    );
  }

  const url = media.media_url;
  if (!url) {
    return <Unavailable reason="Berkas media tidak tersedia." />;
  }

  if (media.media_type === "image" || media.media_type === "gif") {
    return (
      <div className={cn(FRAME_CLASS, "grid place-items-center")}>
        <Image
          src={url}
          alt="Media yang dibagikan"
          width={672}
          height={672}
          unoptimized={media.media_type === "gif"}
          className="max-h-full max-w-full object-contain"
          sizes="(max-width: 640px) 100vw, 672px"
        />
      </div>
    );
  }

  return (
    <div className={cn(FRAME_CLASS, "bg-black")}>
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
      >
        Browser Anda tidak mendukung pemutaran video.
      </video>
    </div>
  );
}