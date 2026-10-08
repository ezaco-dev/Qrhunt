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
import { AdsterraPopunder } from "@/components/AdsterraPopunder";
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

/**
 * Langkah wizard.
 *
 * `processing` = iklan + scan NSFW berjalan BERSAMAAN. Setelah keduanya
 * selesai dan scan lolos, upload otomatis dimulai. Kalau scan gagal/ditolak,
 * wizard kembali ke `pick` tanpa menunggu iklan selesai.
 */
type Step = "pick" | "processing" | "done";

/** Tipe media yang butuh berkas (teks tidak perlu). */
type FileMediaType = Exclude<MediaType, "text">;

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

function acceptFor(mediaType: MediaType): string | undefined {
  const types = ACCEPTED_MIME_TYPES[mediaType];
  if (!types || types.length === 0) return undefined;
  return types.join(",");
}

export interface MediaUploaderProps {
  qrCodeId: string;
  hasExistingMedia: boolean;
  onUploaded: (mediaId?: string) => void;
}

/**
 * Wizard pasang/ganti media: `pick -> processing (ad + scan paralel) -> done`.
 *
 * Iklan dan pemindaian NSFW berjalan BERSAMAAN: user menonton iklan SEMENTARA
 * model NSFWJS dimuat dan media dipindai. Setelah keduanya selesai dan media
 * lolos, upload otomatis dimulai.
 *
 * Durasi video dibaca dan diperiksa SEBELUM processing. Menahan orang 8 detik
 * iklan hanya untuk memberitahu "video Anda terlalu panjang" tidak masuk akal.
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
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [file, setFile] = useState<File | null>(null);
  const [textContent, setTextContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, setNsfwScanResult] = useState<NsfwScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedMediaId, setUploadedMediaId] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const [adPending, setAdPending] = useState(false);
  const [popunderFire, setPopunderFire] = useState(false);

  const [turnstileEpoch, setTurnstileEpoch] = useState(0);

  const renewTurnstileToken = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileFailed(false);
    setTurnstileEpoch((epoch) => epoch + 1);
  }, []);

  const durationRef = useRef<number | undefined>(undefined);

  // Ref untuk koordinasi 3-arah paralel: ad + scan + upload server.
  const scanDoneRef = useRef(false);
  const adDoneRef = useRef(false);
  const uploadDoneRef = useRef(false);
  const scanPassedRef = useRef(false);
  const uploadResultRef = useRef<{ mediaId: string } | null>(null);

  const isFileType = mediaType !== "text";
  const isBusy = isScanning || isUploading || adPending;

  const effectiveTurnstileToken = useMemo(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    return siteKey && turnstileToken ? turnstileToken : PLACEHOLDER_TOKEN;
  }, [turnstileToken]);

  const clearInput = useCallback(() => {
    setFile(null);
    setTextContent("");
    setError(null);
    setNsfwScanResult(null);
    setIsScanning(false);
    setIsUploading(false);
    setAdPending(false);
    durationRef.current = undefined;
    scanDoneRef.current = false;
    adDoneRef.current = false;
    uploadDoneRef.current = false;
    scanPassedRef.current = false;
    uploadResultRef.current = null;
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0] ?? null;
      setError(null);
      setNsfwScanResult(null);
      durationRef.current = undefined;
      setFile(nextFile);

      if (!nextFile) return;

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

  const checkCompletion = useCallback(() => {
    if (!adDoneRef.current || !scanDoneRef.current || !uploadDoneRef.current) {
      return;
    }
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
        mediaId: string;
        mediaType: MediaType;
        mediaUrl: string | null;
        textContent: string | null;
      }>;

      if (!payload.ok) {
        setError(payload.error);
        setStep("pick");
        setAdPending(false);
        renewTurnstileToken();
        return null;
      }

      return { mediaId: payload.data.mediaId };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unggahan gagal.");
      setStep("pick");
      setAdPending(false);
      renewTurnstileToken();
      return null;
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
   * Mulai processing 3-arah secara PARALEL: iklan + scan NSFW + unggah ke server.
   *
   * Ketiganya berjalan bersamaan: saat user menonton iklan, media juga dipindai
   * dan diunggah ke server/Cloudinary secara latar belakang. Saat iklan selesai,
   * unggahan sudah siap.
   */
  const handleSubmit = useCallback(() => {
    if (mediaType !== "text" && !file) {
      setError("Tidak ada berkas yang dipilih.");
      setStep("pick");
      return;
    }

    setStep("processing");
    setError(null);
    scanDoneRef.current = false;
    adDoneRef.current = false;
    uploadDoneRef.current = false;
    scanPassedRef.current = false;
    uploadResultRef.current = null;
    setAdPending(true);
    // Popunder butuh user gesture: klik "Unggah" ini adalah gesture-nya.
    setPopunderFire(true);

    // (Tugas 1) Unggah ke server berjalan secara PARALEL dengan iklan & scan
    void (async () => {
      const res = await performUpload();
      if (res) {
        uploadResultRef.current = res;
        uploadDoneRef.current = true;
        checkCompletion();
      }
    })();

    // (Tugas 2) Scan Client NSFW (jika gambar/video/gif)
    if (mediaType === "text") {
      scanDoneRef.current = true;
      scanPassedRef.current = true;
      setIsScanning(false);
      checkCompletion();
    } else if (file) {
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
            setAdPending(false);
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
          setAdPending(false);
          renewTurnstileToken();
        } finally {
          setIsScanning(false);
        }
      })();
    }
  }, [checkCompletion, file, mediaType, performUpload, renewTurnstileToken]);

  const handleAdComplete = useCallback(() => {
    adDoneRef.current = true;
    setAdPending(false);
    checkCompletion();
  }, [checkCompletion]);

  const canSubmit = isFileType ? Boolean(file) : textContent.trim().length > 0;

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

      {/* Setelah iklan selesai tapi scan/upload masih jalan, tampilkan indikator */}
      {step === "processing" && !adPending ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Loader2Icon className="size-6 animate-spin" />
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
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircleIcon className="size-6" />
          <p className="text-sm font-medium">Media tersimpan.</p>
          <Button onClick={() => onUploaded(uploadedMediaId ?? undefined)}>
            Selesai
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
        >
          <UploadIcon />
          {hasExistingMedia ? "Ganti media" : "Pasang media"}
        </Button>
      ) : null}

      {/* Iklan ditampilkan selama `adPending`. Scan berjalan di balik layar. */}
      <AdModal open={step === "processing" && adPending} onComplete={handleAdComplete} />
      {/* Popunder dibuka sekali per halaman, tepat saat klik unggah (gesture). */}
      <AdsterraPopunder fire={popunderFire} />
    </div>
  );
}
