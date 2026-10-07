"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  PrinterIcon,
  QrCodeIcon,
  SparklesIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; qrCodeId: string; mediaId: string; publicUrl: string; dataUrl: string };

export function AdminQrForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const handleCreate = useCallback(async () => {
    setCopied(false);
    setStatus({ kind: "loading" });

    try {
      const response = await fetch("/api/admin/qr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        qr_code_id?: string;
        media_id?: string;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.qr_code_id) {
        setStatus({
          kind: "error",
          message: payload.error ?? `Gagal membuat QR (HTTP ${response.status}).`,
        });
        return;
      }

      const qrCodeId = payload.qr_code_id;
      const mediaId = payload.media_id ?? "";
      const publicUrl = `${window.location.origin}/q/${encodeURIComponent(qrCodeId)}`;
      const dataUrl = await QRCode.toDataURL(publicUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 512,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setStatus({ kind: "done", qrCodeId, mediaId, publicUrl, dataUrl });
    } catch {
      setStatus({
        kind: "error",
        message: "Tidak bisa menghubungi server. Coba lagi.",
      });
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (status.kind !== "done") return;
    try {
      await navigator.clipboard.writeText(status.publicUrl);
      setCopied(true);
    } catch {
      // Ignore fallback
    }
  }, [status]);

  const handleDownload = useCallback(() => {
    if (status.kind !== "done") return;
    const link = document.createElement("a");
    link.href = status.dataUrl;
    link.download = `qr-${status.qrCodeId}.png`;
    link.click();
  }, [status]);

  const handlePrint = useCallback(() => {
    if (status.kind !== "done") return;
    document.body.classList.add("printing-qr");
    window.print();
    window.setTimeout(() => document.body.classList.remove("printing-qr"), 500);
  }, [status]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm flex flex-col items-center text-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <SparklesIcon className="size-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Generate QR Super Unik</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Klik tombol di bawah untuk membuat QR Code unik secara otomatis. QR code ini siap untuk dicetak dan ditempel di meja/lokasi.
          </p>
        </div>

        <Button
          onClick={handleCreate}
          disabled={status.kind === "loading"}
          size="lg"
          className="mt-2"
        >
          <QrCodeIcon className="size-5" />
          {status.kind === "loading" ? "Membuat QR Unik..." : "Generate QR Super Unik"}
        </Button>
      </div>

      {status.kind === "error" && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive text-center"
        >
          {status.message}
        </p>
      )}

      {status.kind === "done" && (
        <section
          aria-label="QR code siap"
          className="flex flex-col gap-4 rounded-xl border p-4 bg-background"
        >
          <div ref={printRef} className="print:qr-card flex flex-col items-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={status.dataUrl}
              alt={`QR code ${status.qrCodeId}`}
              className="size-48 rounded-lg border bg-white p-2"
            />
            <div>
              <p className="font-mono text-sm font-medium">{status.publicUrl}</p>
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                ID QR: {status.qrCodeId}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={handleCopy}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Tersalin" : "Salin URL"}
            </Button>
            <Button variant="outline" onClick={handleDownload}>
              <DownloadIcon />
              Unduh PNG
            </Button>
            <Button variant="outline" onClick={handlePrint}>
              <PrinterIcon />
              Cetak
            </Button>
            <Button render={<Link href={`/q/${status.qrCodeId}`} />}>
              Buka Halaman Publik
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            QR ini menunjuk ke <code>{status.publicUrl}</code>. Saat dipindai pengguna, URL di browser pengguna akan otomatis memakai sub-ID media aktif.
          </p>
        </section>
      )}
    </div>
  );
}
