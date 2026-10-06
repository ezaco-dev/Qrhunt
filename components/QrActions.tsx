"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon, UploadIcon } from "lucide-react";

import { MediaUploader } from "@/components/MediaUploader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";

export interface QrActionsProps {
  qrCodeId: string;
  hasExistingMedia: boolean;
}

/**
 * Tombol "Pasang Media" / "Ganti Media" beserta dialognya.
 *
 * `MediaUploader` diberi `key` berisi `qrCodeId`. Kalau dialog dibuka lagi
 * untuk QR yang berbeda, React memasang ulang seluruh subtree sehingga state
 * wizard ter-reset tanpa perlu efek samping (effect cleanup, tombol reset
 * manual, dan seterusnya). Reset manual selalu menyisakan celah di mana state
 * dari QR sebelumnya masih terbaca.
 *
 * Bundel NSFWJS + TensorFlow.js hanya dimuat ketika dialog benar-benar dibuka,
 * karena model baru dijalankan saat wizard berjalan.
 */
export function QrActions({ qrCodeId, hasExistingMedia }: QrActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleUploaded = useCallback(() => {
    setOpen(false);
    // Server Component perlu membaca ulang media baru dari database.
    router.refresh();
  }, [router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="outline" className="w-full">
        {hasExistingMedia ? <PencilIcon /> : <UploadIcon />}
        {hasExistingMedia ? "Ganti media" : "Pasang media"}
      </Button>

      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {hasExistingMedia ? "Ganti media" : "Pasang media"}
          </DialogTitle>
          <DialogDescription>
            Tidak perlu login. Siapa pun yang tahu QR ini bisa menggantinya.
          </DialogDescription>
        </DialogHeader>

        <MediaUploader
          key={qrCodeId}
          qrCodeId={qrCodeId}
          hasExistingMedia={hasExistingMedia}
          onUploaded={handleUploaded}
        />
      </DialogPopup>
    </Dialog>
  );
}