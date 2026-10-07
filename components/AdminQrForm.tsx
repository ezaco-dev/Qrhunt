"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  PrinterIcon,
  QrCodeIcon,
  RefreshCwIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; qrCodeId: string; publicUrl: string; dataUrl: string };

interface AdminQrRow {
  id: string;
  qr_code_id: string;
  media_type: string;
  created_at: string;
  updated_at: string;
  is_hidden: boolean;
  is_disabled?: boolean;
  admin_label?: string | null;
  admin_group_name?: string | null;
}

interface BarcodeDetectorLike {
  detect(video: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

export function AdminQrForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState<AdminQrRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [count, setCount] = useState(1);
  const [manualScan, setManualScan] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const response = await fetch("/api/admin/qr", { cache: "no-store" });
      const payload = (await response.json()) as { ok: boolean; data?: AdminQrRow[] };
      if (payload.ok) setRows(payload.data ?? []);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void loadRows(), 0);
    return () => window.clearTimeout(id);
  }, [loadRows]);

  const handleCreate = useCallback(async () => {
    setCopied(false);
    setStatus({ kind: "loading" });

    try {
      const response = await fetch("/api/admin/qr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count, group_name: groupName.trim() || undefined }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        qr_code_id?: string;
        items?: Array<{ qr_code_id: string }>;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.qr_code_id) {
        setStatus({ kind: "error", message: payload.error ?? `Gagal membuat QR (HTTP ${response.status}).` });
        return;
      }

      const qrCodeId = payload.qr_code_id;
      const publicUrl = `${window.location.origin}/q/${encodeURIComponent(qrCodeId)}`;
      const dataUrl = await QRCode.toDataURL(publicUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 512,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setStatus({ kind: "done", qrCodeId, publicUrl, dataUrl });
      await loadRows();
    } catch {
      setStatus({ kind: "error", message: "Tidak bisa menghubungi server. Coba lagi." });
    }
  }, [count, groupName, loadRows]);

  const patchQr = useCallback(async (qrCodeId: string, body: Partial<AdminQrRow>) => {
    const response = await fetch(`/api/admin/qr/${encodeURIComponent(qrCodeId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) await loadRows();
  }, [loadRows]);

  const deleteQr = useCallback(async (qrCodeId: string) => {
    const ok = window.confirm(`Hapus QR ${qrCodeId} dari database? Tindakan ini tidak bisa dibatalkan.`);
    if (!ok) return;

    const response = await fetch(`/api/admin/qr/${encodeURIComponent(qrCodeId)}`, {
      method: "DELETE",
    });
    if (response.ok) {
      await loadRows();
      return;
    }
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    window.alert(payload?.error ?? "Gagal menghapus QR.");
  }, [loadRows]);

  const markScannedQr = useCallback(async (raw: string) => {
    const qrCodeId = raw.trim().split("/q/").pop()?.split(/[?#]/)[0] ?? raw.trim();
    const label = window.prompt("Tandai QR ini ada di mana?", "Meja / Lokasi");
    if (!label) return;
    await patchQr(decodeURIComponent(qrCodeId), { admin_label: label });
    setScanMessage(`Lokasi tersimpan untuk ${qrCodeId}`);
  }, [patchQr]);

  const startScanner = useCallback(async () => {
    setScannerOpen(true);
    setScanMessage(null);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    await video.play();

    const Detector = (window as unknown as { BarcodeDetector?: new (init: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    if (!Detector) {
      setScanMessage("Browser belum mendukung scanner native. Pakai input manual di bawah.");
      return;
    }
    const detector = new Detector({ formats: ["qr_code"] });
    let active = true;
    const loop = async () => {
      if (!active) return;
      const found = await detector.detect(video);
      if (found[0]) {
        active = false;
        stream.getTracks().forEach((track) => track.stop());
        setScannerOpen(false);
        await markScannedQr(found[0].rawValue);
        return;
      }
      window.setTimeout(loop, 500);
    };
    void loop();
  }, [markScannedQr]);

  const handleCopy = useCallback(async () => {
    if (status.kind !== "done") return;
    await navigator.clipboard.writeText(status.publicUrl);
    setCopied(true);
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

  const groups = rows.reduce<Record<string, AdminQrRow[]>>((acc, row) => {
    const key = row.admin_group_name || "Tanpa Grup";
    acc[key] = [...(acc[key] ?? []), row];
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm flex flex-col items-center text-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <SparklesIcon className="size-6" />
        </div>
        <h2 className="text-lg font-semibold">Generate QR Super Unik</h2>
        <div className="grid w-full max-w-md gap-3 sm:grid-cols-2">
          <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Nama grup (opsional)" />
          <Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
        </div>
        <Button onClick={handleCreate} disabled={status.kind === "loading"} size="lg">
          <QrCodeIcon className="size-5" />
          {status.kind === "loading" ? "Membuat..." : `Generate ${count} QR`}
        </Button>
      </div>

      {status.kind === "error" && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">{status.message}</p>}

      {status.kind === "done" && (
        <section aria-label="QR code siap" className="flex flex-col gap-4 rounded-xl border p-4 bg-background">
          <div ref={printRef} className="print:qr-card flex flex-col items-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={status.dataUrl} alt={`QR code ${status.qrCodeId}`} className="size-48 rounded-lg border bg-white p-2" />
            <p className="font-mono text-sm font-medium">{status.publicUrl}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={handleCopy}>{copied ? <CheckIcon /> : <CopyIcon />}{copied ? "Tersalin" : "Salin URL"}</Button>
            <Button variant="outline" onClick={handleDownload}><DownloadIcon />Unduh PNG</Button>
            <Button variant="outline" onClick={handlePrint}><PrinterIcon />Cetak</Button>
            <Button render={<Link href={`/q/${status.qrCodeId}`} />}>Buka Halaman Publik</Button>
          </div>
        </section>
      )}

      <section className="rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Kontrol QR</h2>
          <Button variant="outline" size="sm" onClick={loadRows} disabled={loadingRows}>
            {loadingRows ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Refresh
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={startScanner}><VideoIcon /> Scan QR untuk tandai lokasi</Button>
          <Input value={manualScan} onChange={(e) => setManualScan(e.target.value)} placeholder="Atau paste URL /q/..." className="max-w-xs" />
          <Button variant="outline" onClick={() => markScannedQr(manualScan)}>Tandai</Button>
        </div>
        {scannerOpen && <video ref={videoRef} className="mt-3 aspect-video w-full max-w-sm rounded-lg border bg-black" muted playsInline />}
        {scanMessage && <p className="mt-2 text-sm text-muted-foreground">{scanMessage}</p>}

        <div className="mt-4 flex flex-col gap-4">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="rounded-lg border p-3">
              <h3 className="text-sm font-semibold">{group} <span className="text-muted-foreground">({items.length})</span></h3>
              <div className="mt-2 divide-y">
                {items.map((row) => (
                  <div key={row.qr_code_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{row.qr_code_id}</p>
                      <p className="text-xs text-muted-foreground">{row.admin_label || "Belum ditandai lokasi"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant={row.is_disabled ? "default" : "outline"} size="sm" onClick={() => patchQr(row.qr_code_id, { is_disabled: !row.is_disabled })}>
                        {row.is_disabled ? "Aktifkan" : "Nonaktifkan"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => patchQr(row.qr_code_id, { admin_label: window.prompt("Lokasi QR", row.admin_label ?? "") || row.admin_label })}>Edit Lokasi</Button>
                      <Button variant="outline" size="sm" render={<Link href={`/q/${row.qr_code_id}`} />}>Buka</Button>
                      <Button variant="outline" size="sm" onClick={() => deleteQr(row.qr_code_id)}>Hapus</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
