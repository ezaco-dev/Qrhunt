"use client";

import { useCallback, useEffect, useState } from "react";
import { TimerIcon } from "lucide-react";

import {
  Dialog,
  DialogDescription,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { AdsterraBanner } from "@/components/AdsterraBanner";

/** Durasi tonton iklan, detik. Env `NEXT_PUBLIC_AD_DURATION_SECONDS`, default 8. */
function getAdDurationSeconds(): number {
  const raw = process.env.NEXT_PUBLIC_AD_DURATION_SECONDS;
  if (!raw) return 8;
  const parsed = Number.parseInt(raw, 10);
  // Nilai rusak atau absurd tidak boleh dipakai: timer negatif akan selesai
  // seketika, timer satu jam menahan pengguna tanpa alasan.
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60) return 8;
  return parsed;
}

export interface AdModalProps {
  open: boolean;
  /** Dipanggil saat pengguna menekan "Lanjut" — satu-satunya jalan keluar. */
  onComplete: () => void;
}

/**
 * Modal iklan dengan timer yang tidak bisa dilewati.
 *
 * Tiga hal membuat modal ini aman, dan ketiganya wajib dipertahankan:
 *
 *  1. `onOpenChange` memakai fungsi no-op bernama `ignoreCloseRequest`.
 *     Base UI memanggil `onOpenChange(false)` saat Escape ditekan atau saat
 *     klik di luar popup. Handler yang memanggil `onComplete()` di sana adalah
 *     celah bypass yang nyata. Fungsi ini sengaja DIBERI NAMA, bukan arrow
 *     inline, supaya identitasnya stabil antar render dan intention-nya
 *     terbaca jelas oleh reviewer.
 *
 *  2. Timer memakai DEADLINE ABSOLUT (`Date.now() + duration * 1000`), bukan
 *     penghitung yang dikurangi tiap tick. Saat tab di-minimize atau perangkat
 *     tidur, `setInterval` di-throttle sehingga hitungan melambat dan pengguna
 *     ditahan lebih lama dari yang dijanjikan. Deadline absolut tidak punya
 *     masalah itu: begitu tab aktif lagi, sisa waktu langsung benar.
 *
 *  3. `onComplete` punya dua lapis guard: tombol dinonaktifkan lewat
 *     `disabled={!isDone}`, dan `handleContinue` menambahkan
 *     `if (!isDone) return`. Guard kedua diperlukan karena pemanggilan bisa
 *     datang dari sumber selain klik tombol.
 */
export function AdModal({ open, onComplete }: AdModalProps) {
  const durationMs = getAdDurationSeconds() * 1000;

  const [remainingMs, setRemainingMs] = useState(durationMs);

  /**
   * Reset timer saat dialog dibuka, TANPA `setState` di dalam efek.
   *
   * Pola "menyesuaikan state saat prop berubah" ini adalah yang
   * direkomendasikan React sendiri. Meletakkannya di dalam `useEffect` akan
   * memicu render berantai dan ditandai oleh `react-hooks/set-state-in-effect`.
   * Efek di bawah hanya tugasnya: berlangganan timer dan memanggil
   * `setRemainingMs` dari dalam callback.
   */
  const [previousOpen, setPreviousOpen] = useState(open);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) setRemainingMs(durationMs);
  }

  const isDone = remainingMs <= 0;

  useEffect(() => {
    if (!open) return;

    const deadline = Date.now() + durationMs;

    const intervalId = window.setInterval(() => {
      const remaining = Math.max(0, deadline - Date.now());
      setRemainingMs(remaining);
      if (remaining === 0) window.clearInterval(intervalId);
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [open, durationMs]);

  /**
   * Selalu no-op. Sengaja tidak menutup dan tidak menyelesaikan apa pun.
   */
  const ignoreCloseRequest = useCallback(() => {
    // Sengaja kosong. Lihat penjelasan di dokumenasi komponen.
  }, []);

  /** Satu-satunya jalan keluar dari modal ini. */
  const handleContinue = useCallback(() => {
    if (!isDone) return;
    onComplete();
  }, [isDone, onComplete]);

  const secondsLeft = Math.ceil(remainingMs / 1000);
  const percent = Math.min(
    100,
    Math.max(0, ((durationMs - remainingMs) / durationMs) * 100),
  );

  return (
    <Dialog open={open} onOpenChange={ignoreCloseRequest}>
      <DialogPopup
        // Tombol tutup baru muncul setelah timer selesai, jadi tidak ada jalan
        // keluar yang tersembunyi selama iklan berjalan.
        showCloseButton={isDone}
        // Escape sebelum selesai tidak boleh menutup modal.
        onKeyDown={(event) => {
          if (!isDone && event.key === "Escape") event.preventDefault();
        }}
        // Area di dalam popup yang diklik bisa dianggap "pointer down outside"
        // oleh Base UI; hentikan propagasi agar tidak memicu permintaan tutup
        // yang memang sengaja dihiraukan.
        onClick={(event) => event.stopPropagation()}
        className="max-w-sm"
      >
        <DialogTitle className="flex items-center gap-2">
          <TimerIcon className="size-5" />
          Tonton sebentar
        </DialogTitle>

        <DialogDescription>
          Media Anda akan dikirim setelah iklan singkat ini selesai.
        </DialogDescription>

        <Progress value={percent} className="mt-2">
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>

        <div className="my-2 flex justify-center">
          <AdsterraBanner
            atKey={process.env.NEXT_PUBLIC_ADSTERRA_MODAL_KEY}
            width={300}
            height={250}
          />
        </div>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {isDone ? "Iklan selesai." : `Sisa waktu: ${secondsLeft} detik`}
        </p>

        <Button onClick={handleContinue} disabled={!isDone} className="w-full">
          {isDone ? "Lanjut" : `Tunggu ${secondsLeft} detik`}
        </Button>
      </DialogPopup>
    </Dialog>
  );
}