"use client";

import { useEffect } from "react";

const INSTAGRAM_URL = "https://instagram.com/qrhunt.id";

/**
 * Custom 404 Page.
 *
 * Mengalihkan pengunjung yang membuka URL/QR yang tidak ada langsung ke
 * Instagram @qrhunt.id.
 */
export default function NotFound() {
  useEffect(() => {
    window.location.href = INSTAGRAM_URL;
  }, []);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-4 text-center">
      <meta httpEquiv="refresh" content={`0;url=${INSTAGRAM_URL}`} />
      <div className="flex flex-col items-center gap-3">
        <p className="text-lg font-semibold">Halaman Tidak Ditemukan</p>
        <p className="text-sm text-muted-foreground">
          Mengalihkan Anda ke Instagram{" "}
          <a
            href={INSTAGRAM_URL}
            className="font-medium text-foreground underline underline-offset-4"
          >
            @qrhunt.id
          </a>
          ...
        </p>
      </div>
    </div>
  );
}
