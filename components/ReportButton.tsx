"use client";

import { useCallback, useState } from "react";
import { FlagIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApiResult } from "@/lib/types";

type ReportResponseData = { reportCount: number; isHidden: boolean };

export function ReportButton({ qrCodeId }: { qrCodeId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  /**
   * Otorisasi: TIDAK ADA.
   *
   * Ini disengaja. Pelapor tidak punya akun, dan membalas "hanya bisa lapor
   * kalau login" membuat moderasi mustahil untuk pengguna yang justru melihat
   * konten yang tidak pantas. Yang paling mudah disalahgunakan dari fitur
   * anonim adalah menyembunyikan media orang lain, jadi risiko sebenarnya ada
   * di sisi enable report.
   *
   * Pertahanan yang ada sekarang hanya rate limiting platform, dan itu lemah.
   * Opsi yang lebih tepat bila ini dipakai serius: CAPTCHA sekunder pada
   * endpoint `/api/report`, plus kuota per IP di edge.
   */
  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrCodeId, reason: reason.trim() || undefined }),
      });

      const payload = (await response.json()) as ApiResult<ReportResponseData>;

      if (!payload.ok) {
        setError(payload.error);
        return;
      }

      const { reportCount, isHidden } = payload.data;
      setSuccessMessage(
        isHidden
          ? "Media ini sudah disembunyikan setelah laporan terkumpul. Terima kasih."
          : `Laporan tercatat. Total laporan: ${reportCount}.`,
      );
    } catch {
      setError("Gagal mengirim laporan. Periksa koneksi lalu coba lagi.");
    } finally {
      setIsSubmitting(false);
    }
  }, [qrCodeId, reason]);

  /**
   * Reset form saat dialog ditutup supaya laporan berikutnya tidak mewarisi
   * alasan dan pesan lama.
   */
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setReason("");
      setError(null);
      setSuccessMessage(null);
    }
  }, []);

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger
        render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}
      >
        <FlagIcon />
        Laporkan
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogTitle>Laporkan media ini?</AlertDialogTitle>
        <AlertDialogDescription>
          Laporan bersifat anonim. Setelah cukup banyak laporan, media ini
          otomatis disembunyikan sampai ada yang memasang media baru.
        </AlertDialogDescription>

        <div className="flex flex-col gap-2">
          <Label htmlFor="report-reason">Alasan (opsional)</Label>
          <Textarea
            id="report-reason"
            name="reason"
            maxLength={280}
            placeholder="Contoh: memuat konten yang tidak pantas"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">{reason.length}/280</p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {successMessage ? (
          <p role="status" className="text-sm text-muted-foreground">
            {successMessage}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel
            render={<Button variant="outline" disabled={isSubmitting} />}
          >
            Batal
          </AlertDialogCancel>
          <AlertDialogAction
            render={
              <Button disabled={isSubmitting} onClick={handleSubmit} />
            }
          >
            {isSubmitting ? "Mengirim..." : "Kirim laporan"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}