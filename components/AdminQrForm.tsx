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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; qrCodeId: string; publicUrl: string; dataUrl: string };

const QR_CODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Form pembuat QR code untuk admin.
 *
 * Alur:
 *   1. Admin mengetik ID QR (mis. `UMKM_002`). Divalidasi dengan aturan yang
 *      SAMA dengan `qrCodeIdSchema` di `lib/validation.ts`, supaya ID yang
 *      lolos di sini dijamin juga lolos di server dan di halaman publik.
 *   2. POST /api/admin/qr membuat baris di `qr_medias` (media_type "text",
 *      konten default). Baris ini yang membuat `/q/<id>` tidak 404.
 *   3. QR PNG digenerate di browser lewat `qrcode`, karena:
 *        - tidak ada alasan mengirim PNG dari server (boros bandwidth), dan
 *        - `qrcode` butuh canvas di browser; `toDataURL` sudah cukup.
 *
 * QR diarahkan ke URL publik yang berasal dari `window.location.origin`,
 * bukan dari env, supaya QR tetap benar walau situs dibuka dari IP maupun
 * domain.
 */
export function AdminQrForm() {
  const [qrCodeId, setQrCodeId] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const handleCreate = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setCopied(false);

      const trimmedId = qrCodeId.trim();
      if (!QR_CODE_ID_PATTERN.test(trimmedId)) {
        setStatus({
          kind: "error",
          message:
            "ID QR hanya boleh huruf, angka, garis bawah, dan garis miring " +
            "singkat (1-64 karakter). Contoh: UMKM_002.",
        });
        return;
      }

      setStatus({ kind: "loading" });
      try {
        const response = await fetch("/api/admin/qr", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            qr_code_id: trimmedId,
            label: label.trim() || undefined,
          }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          error?: string;
        };

        if (!response.ok || !payload.ok) {
          setStatus({
            kind: "error",
            message: payload.error ?? `Gagal membuat QR (HTTP ${response.status}).`,
          });
          return;
        }

        const publicUrl = `${window.location.origin}/q/${encodeURIComponent(trimmedId)}`;
        const dataUrl = await QRCode.toDataURL(publicUrl, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 512,
          color: { dark: "#000000", light: "#ffffff" },
        });
        setStatus({ kind: "done", qrCodeId: trimmedId, publicUrl, dataUrl });
      } catch {
        setStatus({
          kind: "error",
          message: "Tidak bisa menghubungi server. Coba lagi.",
        });
      }
    },
    [qrCodeId, label],
  );

  const handleCopy = useCallback(async () => {
    if (status.kind !== "done") return;
    try {
      await navigator.clipboard.writeText(status.publicUrl);
      setCopied(true);
    } catch {
      // Clipboard API butuh HTTPS atau localhost. Kalau gagal, biarkan saja —
      // URL tetap terlihat dan bisa disalin manual.
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
    // class dibuang setelah print selesai; sebagian browser tidak menandai
    // kapan itu selesai, jadi setTimeout aman untuk keperluan ini.
    window.setTimeout(() => document.body.classList.remove("printing-qr"), 500);
  }, [status]);

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleCreate} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="qr-code-id">ID QR</Label>
          <Input
            id="qr-code-id"
            value={qrCodeId}
            onChange={(event) => setQrCodeId(event.target.value)}
            placeholder="UMKM_002"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            required
          />
          <p className="text-xs text-muted-foreground">
            Hanya huruf, angka, garis bawah, dan tanda hubung. Ini yang muncul
            di URL publik: <code>/q/UMKM_002</code>.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="qr-label">
            Nama tempat <span className="text-muted-foreground">(opsional)</span>
          </Label>
          <Input
            id="qr-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Warung Bu Sari"
            maxLength={120}
          />
          <p className="text-xs text-muted-foreground">
            Cukup untuk catatan admin, tidak muncul di halaman publik.
          </p>
        </div>

        {/* Base UI: render element menang atas props yang dikirim, jadi
            `type="submit"` harus ada di elemen render-nya, bukan di prop
            Button. Menulis `type="submit"` di prop akan kalah oleh render
            bawaan `<button type="button" />` dan tombol tidak men-submit. */}
        <Button
          render={<button type="submit" />}
          disabled={status.kind === "loading"}
        >
          <QrCodeIcon />
          {status.kind === "loading" ? "Membuat…" : "Buat QR code"}
        </Button>
      </form>

      {status.kind === "error" && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {status.message}
        </p>
      )}

      {status.kind === "done" && (
        <section
          aria-label="QR code siap"
          className="flex flex-col gap-4 rounded-xl border p-4"
        >
          <div ref={printRef} className="print:qr-card flex flex-col items-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={status.dataUrl}
              alt={`QR code untuk ${status.qrCodeId}`}
              className="size-48 rounded-lg border bg-white"
            />
            <div>
              <p className="font-mono text-sm">{status.publicUrl}</p>
              {label.trim() && (
                <p className="mt-1 text-xs text-muted-foreground">{label.trim()}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
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
              Buka halaman publik
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            QR ini menunjuk ke <code>{status.publicUrl}</code>. Tempel di meja
            atau dinding; siapa pun yang memindainya bisa langsung mengganti
            medianya.
          </p>
        </section>
      )}
    </div>
  );
}
