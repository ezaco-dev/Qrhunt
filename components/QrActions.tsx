"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, PencilIcon, UploadIcon } from "lucide-react";

import { MediaUploader } from "@/components/MediaUploader";
import { Button } from "@/components/ui/button";

export interface QrActionsProps {
  qrCodeId: string;
  hasExistingMedia: boolean;
}

/**
 * Tombol "Pasang Media" / "Ganti Media" beserta overlay full-screen-nya.
 *
 * `MediaUploader` diberi `key` berisi `qrCodeId`. Kalau overlay dibuka lagi
 * untuk QR yang berbeda, React memasang ulang seluruh subtree sehingga state
 * wizard ter-reset.
 */
export function QrActions({ qrCodeId, hasExistingMedia }: QrActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleUploaded = useCallback(
    (newMediaId?: string) => {
      setOpen(false);
      if (newMediaId) {
        router.push(`/m/${newMediaId}`);
      } else {
        router.refresh();
      }
    },
    [router],
  );

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" className="w-full">
        {hasExistingMedia ? <PencilIcon /> : <UploadIcon />}
        {hasExistingMedia ? "Ganti media" : "Pasang media"}
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          {/* Header */}
          <header className="flex items-center gap-3 border-b px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              aria-label="Kembali"
            >
              <ArrowLeftIcon className="size-5" />
            </Button>
            <h1 className="text-lg font-semibold">
              {hasExistingMedia ? "Ganti media" : "Pasang media"}
            </h1>
          </header>

          {/* Content — scrollable, centered */}
          <div className="flex flex-1 items-start justify-center overflow-y-auto p-4">
            <div className="w-full max-w-lg py-4">
              <p className="mb-4 text-sm text-muted-foreground">
                Tidak perlu login. Siapa pun yang tahu QR ini bisa menggantinya.
              </p>
              <MediaUploader
                key={qrCodeId}
                qrCodeId={qrCodeId}
                hasExistingMedia={hasExistingMedia}
                onUploaded={handleUploaded}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
