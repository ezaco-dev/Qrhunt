"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CheckCircleIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  ImagesIcon,
  Loader2Icon,
  ShieldAlertIcon,
  UploadIcon,
} from "lucide-react";

import { AdModal } from "@/components/AdModal";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  getNsfwModel,
  isNsfwModelLoading,
  readVideoDuration,
  scanMediaFile,
} from "@/lib/nsfw-client";
import { PLACEHOLDER_TOKEN } from "@/lib/turnstile-shared";
import {
  ACCEPTED_MIME_TYPES,
  MAX_TEXT_LENGTH,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  type ApiResult,
  type MediaType,
  type NsfwScanResult,
} from "@/lib/types";
import { validateMediaFile } from "@/lib/validation";

/** Langkah wizard. */
type Step = "pick" | "ad" | "scan" | "done";

/** Tipe media yang butuh berkas (teks tidak perlu). */
type FileMediaType = Exclude<MediaType, "text">;

/** Metadata tiap tab di wizard. */
const MEDIA_TABS: readonly {
  value: MediaType;
  label: string;
  icon: typeof ImageIcon;
}[] = [
  { value: "image", label: "Gambar", icon: ImageIcon },
  { value: "gif", label: "GIF", icon: ImagesIcon },
  { value: "video", label: "Video", icon: FilmIcon },
  { value: "text", label: "Teks", icon: FileTextIcon },
];

/**
 * Atribut `accept` per tipe, diturunkan dari satu sumber kebenaran
 * (`ACCEPTED_MIME_TYPES` di `lib/types.ts`). Jangan menulis daftar MIME kedua
 * kali di sini: dua daftar pasti akan berbeda pada suatu hari.
 */
function acceptFor(mediaType: MediaType): string | undefined {
  const types = ACCEPTED_MIME_TYPES[mediaType];
  if (!types || types.length === 0) return undefined;
  return types.join(",");
}

export interface MediaUploaderProps {
  qrCodeId: string;
  /** Ada media lama, jadi tombolnya berbunyi "Ganti". */
  hasExistingMedia: boolean;
  /** Dipanggil setelah server mengonfirmasi penyimpanan. */
  onUploaded: () => void;
}

/**
 * Wizard pasang/ganti media: `pick → ad → scan → done`.
 *
 * Dua hal yang mudah salah dan perlu dipertahankan:
 *
 *  1. Durasi video dibaca dan diperiksa SEBELUM iklan. Menahan orang 8 detik
 *     iklan hanya untuk memberitahu "video Anda terlalu panjang" adalah
 *     pemborosan yang tidak perlu.
 *
 *  2. `performUpload` dideklarasikan SEBELUM `handleScanAndUpload`, karena yang
 *     kedua memakai yang pertama di dalam `useCallback`. Urutannya dibalik,
 *     `performUpload` masih ada di scope tapi dibaca sebelum diinisialisasi
 *     (error `used before defined`) saat callback pertama dibuat.
 */
export function MediaUploader({
  qrCodeId,
  hasExistingMedia,
  onUploaded,
}: MediaUploaderProps) {
  const [step, setStep] = useState<Step>("pick");
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [file, setFile] = useState<File | null>(null);
  const [textContent, setTextContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nsfwResult, setNsfwScanResult] = useState<NsfwScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  /** True bila widget gagal memberi token (error/timeout/expire). */
  const [turnstileFailed, setTurnstileFailed] = useState(false);

  /**
   * Kunci remount untuk widget Turnstile.
   *
   * Token Turnstile hanya berlaku SATU KALI dan kedaluwarsa sekitar 5 menit.
   * Setelah dipakai satu unggahan, token itu tidak boleh dikirim lagi —
   * percobaan berikutnya akan ditolak `timeout-or-duplicate`.
   *
   * Naikkan kunci ini untuk memasang ulang seluruh widget, yang sekaligus
   * membuat Cloudflare menerbitkan token baru dan memanggil `onToken` lagi.
   * Menyimpan token basi di state sambil berharap keduanya tetap berlaku tidak
   * berhasil.
   */
  const [turnstileEpoch, setTurnstileEpoch] = useState(0);

  /** Minta token anti-bot yang baru. Lihat `turnstileEpoch`. */
  const renewTurnstileToken = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileFailed(false);
    setTurnstileEpoch((epoch) => epoch + 1);
  }, []);

  // Durasi dibaca sekali ketika berkas dipilih. Disimpan di ref supaya nilainya
  // tidak ikut berubah setiap render dan tidak membuat callback di bawahnya
  // kehilangan memoization.
  const durationRef = useRef<number | undefined>(undefined);

  const isFileType = mediaType !== "text";
  const isBusy = isScanning || isUploading;

  /**
   * Token yang benar-benar dikirim.
   *
   * Tanpa site key, `TurnstileWidget` tidak memuat widget sungguhan, jadi yang
   * dipakai adalah token placeholder yang diterima server dalam mode
   * placeholder (`isPlaceholder: true`).
   */
  const effectiveTurnstileToken = useMemo(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    return siteKey && turnstileToken ? turnstileToken : PLACEHOLDER_TOKEN;
  }, [turnstileToken]);

  /** Kembalikan wizard ke awal tanpa menyentuh state milik pemanggil. */
  const clearInput = useCallback(() => {
    setFile(null);
    setTextContent("");
    setError(null);
    setNsfwScanResult(null);
    setIsScanning(false);
    setIsUploading(false);
    durationRef.current = undefined;
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0] ?? null;
      setError(null);
      setNsfwScanResult(null);
      durationRef.current = undefined;
      setFile(nextFile);

      if (!nextFile) return;

      // Durasi harus diketahui sebelum validasi dan sebelum iklan.
      if (mediaType === "video") {
        try {
          durationRef.current = await readVideoDuration(nextFile);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Video tidak dapat dibaca.");
          setFile(null);
          return;
        }
      }

      const validation = validateMediaFile(nextFile, mediaType, durationRef.current);
      if (!validation.ok) {
        setError(validation.error ?? "Berkas tidak valid.");
        setFile(null);
      }
    },
    [mediaType],
  );

  const handleTextChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setTextContent(event.target.value);
      setError(null);
    },
    [],
  );

  /**
   * Kirim ke `POST /api/upload`.
   *
   * Sengaja TIDAK mengirim apa pun kalau moderasi browser menolak. Server juga
   * akan memeriksa ulang, jadi ini penghematan kuota, bukan penjaga.
   */
  const performUpload = useCallback(async () => {
    setIsUploading(true);
    setError(null);

    try {
      const form = new FormData();
      form.append("qrCodeId", qrCodeId);
      form.append("mediaType", mediaType);
      form.append("turnstileToken", effectiveTurnstileToken);

      if (mediaType === "text") {
        form.append("textContent", textContent.trim());
      } else if (file) {
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
        mediaType: MediaType;
        mediaUrl: string | null;
        textContent: string | null;
      }>;

      if (!payload.ok) {
        setError(payload.error);
        setStep("pick");
        // Permintaan sudah sampai server, jadi token yang dikirim sudah
        // terpakai — Cloudflare menandainya terpakai walau server menolak. Minta
        // token baru, atau percobaan berikutnya gagal dengan
        // `timeout-or-duplicate`.
        renewTurnstileToken();
        return;
      }

      setStep("done");
      renewTurnstileToken();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unggahan gagal.");
      setStep("pick");
      renewTurnstileToken();
    } finally {
      setIsUploading(false);
    }
  }, [
    effectiveTurnstileToken,
    file,
    mediaType,
    qrCodeId,
    renewTurnstileToken,
    textContent,
  ]);

  /**
   * Pindai NSFW di browser, lalu unggah kalau lolos.
   *
   * Pemeriksaan di sini BUKAN penjaga. Secara teknis bisa dilewati dengan
   * memodifikasi Client Component, dan itu memang diterima: gunanya UX dan
   * menghematkan waktu server. Penentu sebenarnya ada di `lib/moderation.ts`,
   * yang memanggil layanan NSFWJS di VPS dan bersifat fail-closed.
   */
  const handleScanAndUpload = useCallback(async () => {
    setStep("scan");
    setError(null);

    if (mediaType === "text") {
      await performUpload();
      return;
    }

    if (!file) {
      setError("Tidak ada berkas yang dipilih.");
      setStep("pick");
      return;
    }

    setIsScanning(true);
    try {
      // Muat model dulu supaya UI bisa membedakan "sedang mengunduh model"
      // dari "sedang memindai berkas".
      await getNsfwModel();

      const result = await scanMediaFile(file, mediaType as FileMediaType);
      setNsfwScanResult(result);

      if (result.isBlocked) {
        setError(
          `Berkas ditolak: konten terdeteksi "${result.worstCategory}" ` +
            `(skor ${result.worstScore.toFixed(2)}).`,
        );
        return;
      }

      await performUpload();
    } catch (err) {
      setError(
        err instanceof Error ? `Pemindaian gagal: ${err.message}` : "Pemindaian gagal.",
      );
    } finally {
      setIsScanning(false);
    }
  }, [file, mediaType, performUpload]);

  const handleAdComplete = useCallback(() => {
    void handleScanAndUpload();
  }, [handleScanAndUpload]);

  const canSubmit = isFileType ? Boolean(file) : textContent.trim().length > 0;

  /**
   * Widget anti-bot belum memberi token.
   *
   * Hanya relevan kalau site key terisi. Tanpa site key, `turnstileToken` selalu
   * `null` dan placeholder yang dikirim — itu memang mode yang diharapkan, bukan
   * cacat.
   *
   * Dengan site key terisi, mengunggah sebelum token ada berarti mengirim
   * `PLACEHOLDER_TOKEN` ke server yang punya secret sungguhan, dan server
   * menolaknya dengan 403. Jadi tombol sebaiknya tidak bisa ditekan sampai
   * widget selesai — lebih baik terlihat jelas daripada gagal dengan 403 yang
   * membingungkan.
   */
  const isAwaitingTurnstile = Boolean(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  ) && !turnstileToken;

  return (
    <div className="flex flex-col gap-4">
      {hasExistingMedia && step === "pick" ? (
        <p className="text-sm text-muted-foreground">
          Media yang sedang tampil akan diganti dan dihapus setelah media baru
          berhasil tersimpan.
        </p>
      ) : null}

      {step === "pick" ? (
        <Tabs
          value={mediaType}
          onValueChange={(value) => {
            setMediaType(value as MediaType);
            clearInput();
          }}
        >
          <TabsList className="w-full">
            {MEDIA_TABS.map((tab) => (
              <TabsTab key={tab.value} value={tab.value} className="flex-1">
                <tab.icon />
                {tab.label}
              </TabsTab>
            ))}
          </TabsList>

          {MEDIA_TABS.map((tab) => (
            <TabsPanel key={tab.value} value={tab.value} className="pt-2">
              {tab.value === "text" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="media-text">Teks yang ditampilkan</Label>
                  <Textarea
                    id="media-text"
                    name="textContent"
                    maxLength={MAX_TEXT_LENGTH}
                    rows={5}
                    placeholder="Tulis apa saja. Siapa pun bisa menggantinya nanti."
                    value={textContent}
                    onChange={handleTextChange}
                  />
                  <p className="text-xs text-muted-foreground">
                    {textContent.length}/{MAX_TEXT_LENGTH} karakter
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="media-file">Berkas {tab.label}</Label>
                  <input
                    id="media-file"
                    type="file"
                    accept={acceptFor(tab.value)}
                    onChange={handleFileChange}
                    className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maksimal {MAX_UPLOAD_BYTES / (1024 * 1024)} MB
                    {tab.value === "video"
                      ? `, durasi ${MAX_VIDEO_DURATION_SECONDS} detik`
                      : ""}
                    .
                  </p>
                </div>
              )}
            </TabsPanel>
          ))}
        </Tabs>
      ) : null}

      {step === "scan" ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Loader2Icon className="size-6 animate-spin" />
          <p className="text-sm font-medium">
            {isNsfwModelLoading()
              ? "Mengunduh model moderasi..."
              : "Memindai media..."}
          </p>
          {nsfwResult?.frames[0] ? (
            <div className="flex flex-wrap justify-center gap-2">
              {nsfwResult.frames[0]
                .slice()
                .sort((a, b) => b.probability - a.probability)
                .map((prediction) => (
                  <span
                    key={prediction.className}
                    className="rounded bg-muted px-2 py-1 text-xs"
                  >
                    {prediction.className}: {(prediction.probability * 100).toFixed(0)}%
                  </span>
                ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Pemeriksaan ini berjalan di browser. Server memverifikasi ulang
              sebelum menyimpan.
            </p>
          )}
        </div>
      ) : null}

      {step === "done" ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircleIcon className="size-6" />
          <p className="text-sm font-medium">Media tersimpan.</p>
          <Button onClick={onUploaded}>Selesai</Button>
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

      {/* `key` sengaja ikut naik bersama `turnstileEpoch`: itulah yang memasang
          ulang widget dan meminta Cloudflare menerbitkan token baru. Tanpa itu,
          widget lama tetap menampilkan token yang sudah terpakai. */}
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
          onClick={() => setStep("ad")}
          disabled={!canSubmit || isBusy || isAwaitingTurnstile}
        >
          <UploadIcon />
          {hasExistingMedia ? "Ganti media" : "Pasang media"}
        </Button>
      ) : null}

      <AdModal open={step === "ad"} onComplete={handleAdComplete} />
    </div>
  );
}