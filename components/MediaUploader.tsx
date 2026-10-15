"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CheckCircleIcon,
  Loader2Icon,
  ShieldAlertIcon,
  UploadIcon,
} from "lucide-react";

import { TurnstileWidget } from "@/components/TurnstileWidget";
import { Button } from "@/components/ui/button";
import {
  getNsfwModel,
  isNsfwModelLoading,
  readVideoDuration,
  scanMediaFile,
} from "@/lib/nsfw-client";
import { PLACEHOLDER_TOKEN } from "@/lib/turnstile-shared";
import {
  ACCEPTED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  type ApiResult,
  type MediaType,
  type NsfwScanResult,
} from "@/lib/types";
import { validateMediaFile } from "@/lib/validation";

type Step = "pick" | "processing" | "done";

type FileMediaType = Exclude<MediaType, "text">;

/** MIME → MediaType. GIF tetap didukung meski tidak ada tab terpisah. */
function detectMediaType(mime: string): FileMediaType {
  if (mime === "image/gif") return "gif";
  if (mime.startsWith("video/")) return "video";
  return "image";
}

/** Semua format file yang diterima (image + gif + video). */
const ALL_ACCEPTED = [
  ...ACCEPTED_MIME_TYPES.image,
  ...ACCEPTED_MIME_TYPES.gif,
  ...ACCEPTED_MIME_TYPES.video,
].join(",");

export interface MediaUploaderProps {
  qrCodeId: string;
  hasExistingMedia: boolean;
  onUploaded: (mediaId?: string) => void;
}

/**
 * Wizard pasang/ganti media: `pick -> processing (scan + upload paralel) -> done`.
 *
 * Satu tombol file — tipe media otomatis dideteksi dari MIME.
 *
 * `performUpload` dideklarasikan SEBELUM `handleSubmit` karena yang kedua
 * memakai yang pertama di dalam callback.
 */
export function MediaUploader({
  qrCodeId,
  hasExistingMedia,
  onUploaded,
}: MediaUploaderProps) {
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<FileMediaType>("image");
  const [error, setError] = useState<string | null>(null);
  const [, setNsfwScanResult] = useState<NsfwScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedMediaId, setUploadedMediaId] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);

  const [turnstileEpoch, setTurnstileEpoch] = useState(0);

  const renewTurnstileToken = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileFailed(false);
    setTurnstileEpoch((epoch) => epoch + 1);
  }, []);

  const durationRef = useRef<number | undefined>(undefined);

  const scanDoneRef = useRef(false);
  const uploadDoneRef = useRef(false);
  const scanPassedRef = useRef(false);
  const uploadResultRef = useRef<{ mediaId: string } | null>(null);

  const isBusy = isScanning || isUploading;

  const effectiveTurnstileToken = useMemo(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    return siteKey && turnstileToken ? turnstileToken : PLACEHOLDER_TOKEN;
  }, [turnstileToken]);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0] ?? null;
      setError(null);
      setNsfwScanResult(null);
      durationRef.current = undefined;
      setFile(nextFile);

      if (!nextFile) return;

      const detected = detectMediaType(nextFile.type);
      setMediaType(detected);

      if (detected === "video") {
        try {
          durationRef.current = await readVideoDuration(nextFile);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Video tidak dapat dibaca.");
          setFile(null);
          return;
        }
      }

      const validation = validateMediaFile(nextFile, detected, durationRef.current);
      if (!validation.ok) {
        setError(validation.error ?? "Berkas tidak valid.");
        setFile(null);
      }
    },
    [],
  );

  const checkCompletion = useCallback(() => {
    if (!scanDoneRef.current || !uploadDoneRef.current) return;
    if (!scanPassedRef.current || !uploadResultRef.current) return;

    setUploadedMediaId(uploadResultRef.current.mediaId);
    setStep("done");
    renewTurnstileToken();
  }, [renewTurnstileToken]);

  const performUpload = useCallback(async (): Promise<{ mediaId: string } | null> => {
    setIsUploading(true);
    setError(null);

    try {
      const form = new FormData();
      form.append("qrCodeId", qrCodeId);
      form.append("mediaType", mediaType);
      form.append("turnstileToken", effectiveTurnstileToken);

      if (file) {
        form.append("file", file);
      } else {
        throw new Error("Tidak ada berkas yang dipilih.");
      }

      if (typeof durationRef.current === "number") {
        form.append("durationSeconds", String(durationRef.current));
      }

      const response = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });

      const payload = (await response.json()) as ApiResult<{
        qrCodeId: string;
        mediaId: string;
        mediaType: MediaType;
        mediaUrl: string | null;
        textContent: string | null;
      }>;

      if (!payload.ok) {
        setError(payload.error);
        setStep("pick");
        renewTurnstileToken();
        return null;
      }

      return { mediaId: payload.data.mediaId };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unggahan gagal.");
      setStep("pick");
      renewTurnstileToken();
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [effectiveTurnstileToken, file, mediaType, qrCodeId, renewTurnstileToken]);

  const handleSubmit = useCallback(() => {
    if (!file) {
      setError("Tidak ada berkas yang dipilih.");
      return;
    }

    setStep("processing");
    setError(null);
    scanDoneRef.current = false;
    uploadDoneRef.current = false;
    scanPassedRef.current = false;
    uploadResultRef.current = null;

    // (1) Upload ke server
    void (async () => {
      const res = await performUpload();
      if (res) {
        uploadResultRef.current = res;
        uploadDoneRef.current = true;
        checkCompletion();
      }
    })();

    // (2) Scan Client NSFW
    setIsScanning(true);
    void (async () => {
      try {
        await getNsfwModel();

        const result = await scanMediaFile(file, mediaType as FileMediaType);
        setNsfwScanResult(result);

        if (result.isBlocked) {
          setError(
            `Berkas ditolak: konten terdeteksi "${result.worstCategory}" ` +
              `(skor ${result.worstScore.toFixed(2)}).`,
          );
          setStep("pick");
          renewTurnstileToken();
          return;
        }

        scanDoneRef.current = true;
        scanPassedRef.current = true;
        checkCompletion();
      } catch (err) {
        setError(
          err instanceof Error ? `Pemindaian gagal: ${err.message}` : "Pemindaian gagal.",
        );
        setStep("pick");
        renewTurnstileToken();
      } finally {
        setIsScanning(false);
      }
    })();
  }, [checkCompletion, file, mediaType, performUpload, renewTurnstileToken]);

  const canSubmit = Boolean(file);

  const isAwaitingTurnstile =
    process.env.NODE_ENV !== "development" &&
    Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) &&
    !turnstileToken;

  return (
    <div className="flex flex-col gap-4">
      {hasExistingMedia && step === "pick" ? (
        <p className="text-sm text-muted-foreground">
          Media yang sedang tampil akan diganti dan dihapus setelah media baru
          berhasil tersimpan.
        </p>
      ) : null}

      {step === "pick" ? (
        <div className="flex flex-col gap-3">
          <label
            htmlFor="media-file"
            className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/30 px-6 py-10 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
          >
            <UploadIcon className="size-8 text-muted-foreground" />
            <span className="text-sm font-medium">
              {file ? file.name : "Pilih foto atau video"}
            </span>
            <span className="text-xs text-muted-foreground">
              Maks {MAX_UPLOAD_BYTES / (1024 * 1024)} MB
              {" · "}video maks {MAX_VIDEO_DURATION_SECONDS} detik
            </span>
          </label>
          <input
            id="media-file"
            type="file"
            accept={ALL_ACCEPTED}
            onChange={handleFileChange}
            className="sr-only"
          />
        </div>
      ) : null}

      {step === "processing" ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Loader2Icon className="size-8 animate-spin text-primary" />
          <p className="text-sm font-medium">
            {isScanning
              ? isNsfwModelLoading()
                ? "Mengunduh model moderasi..."
                : "Memindai media..."
              : isUploading
                ? "Mengunggah media..."
                : "Memproses..."}
          </p>
          {isScanning ? (
            <p className="text-xs text-muted-foreground">
              Pemeriksaan ini berjalan di browser. Server memverifikasi ulang
              sebelum menyimpan.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "done" ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <CheckCircleIcon className="size-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-lg font-semibold">Media tersimpan!</p>
          <p className="text-sm text-muted-foreground">
            QR code Anda sekarang menampilkan media baru.
          </p>
          <Button onClick={() => onUploaded(uploadedMediaId ?? undefined)} size="lg" className="mt-2">
            Lihat hasilnya
          </Button>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <TurnstileWidget
        key={turnstileEpoch}
        onToken={setTurnstileToken}
        onFailure={() => setTurnstileFailed(true)}
      />

      {turnstileFailed && !turnstileToken ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          <p>
            Verifikasi anti-bot gagal dimuat. Penyebab paling umum: hostname
            yang sedang Anda buka belum terdaftar di site key Cloudflare
            Turnstile (misalnya membuka lewat alamat IP, bukan domain).
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={renewTurnstileToken}
            className="self-start"
          >
            Coba lagi
          </Button>
        </div>
      ) : isAwaitingTurnstile ? (
        <p className="text-xs text-muted-foreground">
          Menunggu verifikasi anti-bot. Selesaikan tantangan yang muncul, lalu
          tombol di atas bisa ditekan.
        </p>
      ) : null}

      {step === "pick" ? (
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || isBusy || isAwaitingTurnstile}
          size="lg"
        >
          <UploadIcon />
          {hasExistingMedia ? "Ganti media" : "Pasang media"}
        </Button>
      ) : null}
    </div>
  );
}
