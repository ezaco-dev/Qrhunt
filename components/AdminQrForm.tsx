"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FolderPlusIcon,
  Loader2Icon,
  MapPinIcon,
  PrinterIcon,
  QrCodeIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
  VideoIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface GeneratedQrItem { qrCodeId: string; publicUrl: string; dataUrl: string }

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; items: GeneratedQrItem[]; activeIndex: number };

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

function shortText(value: string, start = 18, end = 8): string {
  return value.length <= start + end + 3 ? value : `${value.slice(0, start)}...${value.slice(-end)}`;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function pushU16(out: number[], value: number) {
  out.push(value & 255, (value >>> 8) & 255);
}

function pushU32(out: number[], value: number) {
  out.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function createZip(files: Array<{ name: string; bytes: Uint8Array }>): Blob {
  const out: number[] = [];
  const central: number[] = [];
  const encoder = new TextEncoder();

  for (const file of files) {
    const name = encoder.encode(file.name);
    const offset = out.length;
    const crc = crc32(file.bytes);

    pushU32(out, 0x04034b50); pushU16(out, 20); pushU16(out, 0); pushU16(out, 0);
    pushU16(out, 0); pushU16(out, 0); pushU32(out, crc); pushU32(out, file.bytes.length);
    pushU32(out, file.bytes.length); pushU16(out, name.length); pushU16(out, 0);
    out.push(...name, ...file.bytes);

    pushU32(central, 0x02014b50); pushU16(central, 20); pushU16(central, 20); pushU16(central, 0); pushU16(central, 0);
    pushU16(central, 0); pushU16(central, 0); pushU32(central, crc); pushU32(central, file.bytes.length);
    pushU32(central, file.bytes.length); pushU16(central, name.length); pushU16(central, 0); pushU16(central, 0);
    pushU16(central, 0); pushU16(central, 0); pushU32(central, 0); pushU32(central, offset); central.push(...name);
  }

  const centralOffset = out.length;
  out.push(...central);
  pushU32(out, 0x06054b50); pushU16(out, 0); pushU16(out, 0); pushU16(out, files.length); pushU16(out, files.length);
  pushU32(out, central.length); pushU32(out, centralOffset); pushU16(out, 0);
  return new Blob([Uint8Array.from(out)], { type: "application/zip" });
}

export function AdminQrForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState<AdminQrRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupLocation, setGroupLocation] = useState("");
  // Kosong/1 = bukan grup; >1 = generate sekaligus jadi grup.
  const [count, setCount] = useState(1);
  const [manualScan, setManualScan] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [selectedQrIds, setSelectedQrIds] = useState<Set<string>>(new Set());
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
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
    // >1 QR tanpa nama tidak bisa jadi grup (semuanya QR individual), jadi tolak.
    if (count > 1 && !groupName.trim()) {
      setStatus({ kind: "error", message: "Jumlah QR lebih dari 1 harus diisi nama grupnya." });
      return;
    }

    setCopied(false);
    setStatus({ kind: "loading" });

    try {
      const response = await fetch("/api/admin/qr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          count,
          label: groupLocation.trim() || undefined,
          group_name: groupName.trim() || undefined,
        }),
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

      const items = await Promise.all(
        (payload.items?.length ? payload.items : [{ qr_code_id: payload.qr_code_id }]).map(async (item) => {
          const qrCodeId = item.qr_code_id;
          const publicUrl = `${window.location.origin}/q/${encodeURIComponent(qrCodeId)}`;
          const dataUrl = await QRCode.toDataURL(publicUrl, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 512,
            color: { dark: "#000000", light: "#ffffff" },
          });
          return { qrCodeId, publicUrl, dataUrl };
        }),
      );
      setStatus({ kind: "done", items, activeIndex: 0 });
      await loadRows();
    } catch {
      setStatus({ kind: "error", message: "Tidak bisa menghubungi server. Coba lagi." });
    }
  }, [count, groupLocation, groupName, loadRows]);

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

  const toggleSelected = useCallback((qrCodeId: string) => {
    setSelectedQrIds((prev) => {
      const next = new Set(prev);
      if (next.has(qrCodeId)) next.delete(qrCodeId);
      else next.add(qrCodeId);
      return next;
    });
  }, []);

  const bulkDelete = useCallback(async () => {
    if (selectedQrIds.size === 0) return;
    const ok = window.confirm(`Hapus ${selectedQrIds.size} QR terpilih?`);
    if (!ok) return;
    await Promise.all([...selectedQrIds].map((id) => fetch(`/api/admin/qr/${encodeURIComponent(id)}`, { method: "DELETE" })));
    setSelectedQrIds(new Set());
    setActiveRowId(null);
    await loadRows();
  }, [loadRows, selectedQrIds]);

  const bulkSetGroup = useCallback(async () => {
    if (selectedQrIds.size === 0) return;
    const group = window.prompt("Nama grup baru untuk QR terpilih", groupName || "Grup Baru");
    if (!group) return;
    await Promise.all(
      [...selectedQrIds].map((id) =>
        fetch(`/api/admin/qr/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ admin_group_name: group }),
        }),
      ),
    );
    // Pastikan grup hasil pemindahan tampil terbuka (default semua grup terbuka).
    setClosedGroups((prev) => {
      const next = new Set(prev);
      next.delete(group);
      return next;
    });
    setSelectedQrIds(new Set());
    await loadRows();
  }, [groupName, loadRows, selectedQrIds]);

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
    await navigator.clipboard.writeText(status.items[status.activeIndex]?.publicUrl ?? "");
    setCopied(true);
  }, [status]);

  const handleDownload = useCallback(() => {
    if (status.kind !== "done") return;
    const active = status.items[status.activeIndex];
    if (!active) return;
    const link = document.createElement("a");
    link.href = active.dataUrl;
    link.download = `qr-${active.qrCodeId}.png`;
    link.click();
  }, [status]);

  const handleDownloadZip = useCallback(() => {
    if (status.kind !== "done") return;
    const files = status.items.map((item) => ({
      name: `qr-${item.qrCodeId}.png`,
      bytes: dataUrlToBytes(item.dataUrl),
    }));
    const blob = createZip(files);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `qr-${groupName.trim() || "batch"}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [groupName, status]);

  const handlePrint = useCallback(() => {
    if (status.kind !== "done") return;
    document.body.classList.add("printing-qr");
    window.print();
    window.setTimeout(() => document.body.classList.remove("printing-qr"), 500);
  }, [status]);

  // Aturan nama: nama dipakai >1 QR = grup (punya header + bisa dilipat);
  // nama dipakai ≤1 QR = QR biasa, tampil tanpa header. Tidak ada "Tanpa Grup".
  const namedByGroup = rows.reduce<Record<string, AdminQrRow[]>>((acc, row) => {
    const key = row.admin_group_name?.trim();
    if (key) (acc[key] = acc[key] ?? []).push(row);
    return acc;
  }, {});
  const groupedEntries = Object.entries(namedByGroup).filter(([, items]) => items.length > 1);
  const groupedIds = new Set(groupedEntries.flatMap(([, items]) => items.map((row) => row.qr_code_id)));
  const flatRows = rows.filter((row) => !groupedIds.has(row.qr_code_id));

  const locationSummary = (items: AdminQrRow[]): string => {
    const labels = [...new Set(items.map((row) => row.admin_label?.trim()).filter((label): label is string => Boolean(label)))];
    if (labels.length === 0) return "";
    if (labels.length === 1) return labels[0];
    return `${labels[0]} (+${labels.length - 1} lokasi lain)`;
  };

  // Sekali satu baris diaktifkan, checkbox muncul di SEMUA baris agar bisa
  // langsung centang massal; tetap tampil selama masih ada yang tercentang.
  const showCheckboxes = activeRowId !== null || selectedQrIds.size > 0;

  // Mode selection (ada yang tercentang): action pindah ke QR terpilih paling
  // bawah sesuai urutan tampil. Tanpa selection: action tetap di baris diklik.
  const actionAnchorId = (() => {
    if (selectedQrIds.size > 0) {
      const visibleOrder = [
        ...flatRows,
        ...groupedEntries.flatMap(([name, items]) => (closedGroups.has(name) ? [] : items)),
      ];
      const lastSelected = visibleOrder
        .filter((row) => selectedQrIds.has(row.qr_code_id))
        .pop()?.qr_code_id;
      if (lastSelected) return lastSelected;
    }
    return activeRowId;
  })();

  // Satu baris QR dipakai dua tempat: daftar grup dan daftar QR individual.
  const renderRow = (row: AdminQrRow) => {
    const isActive = activeRowId === row.qr_code_id;
    const showActions = row.qr_code_id === actionAnchorId;
    const detail = [row.admin_group_name?.trim(), row.admin_label?.trim()].filter(Boolean).join(" • ");
    return (
      <div key={row.qr_code_id} className="flex items-center gap-2 py-2">
        {/* Checkbox muncul di semua baris begitu satu baris diaktifkan,
            dengan animasi fade+zoom singkat. */}
        {showCheckboxes && (
          <input
            type="checkbox"
            checked={selectedQrIds.has(row.qr_code_id)}
            onChange={() => toggleSelected(row.qr_code_id)}
            aria-label={`Pilih ${row.qr_code_id}`}
            className="shrink-0 animate-in fade-in-0 zoom-in-95 duration-200"
          />
        )}

        <button
          type="button"
          onClick={() => setActiveRowId(isActive ? null : row.qr_code_id)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate font-mono text-sm" title={row.qr_code_id}>
            {shortText(row.qr_code_id, 20, 6)}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={detail}>
            {detail || "Belum ditandai lokasi"}
          </p>
        </button>

        {/* Action muncul di kanan nama. Tanpa selection: baris yang diklik.
            Mode selection: baris terpilih paling bawah. Ikon berwarna, bukan
            teks, supaya nama QR tidak tertutup/terdorong. */}
        {showActions && (
          <div className="flex shrink-0 items-center gap-1 animate-in fade-in-0 slide-in-from-right-3 duration-200">
            <Button
              variant="outline"
              size="sm"
              onClick={() => patchQr(row.qr_code_id, { is_disabled: !row.is_disabled })}
              aria-label={row.is_disabled ? "Aktifkan QR" : "Nonaktifkan QR"}
              title={row.is_disabled ? "Aktifkan QR" : "Nonaktifkan QR"}
            >
              {row.is_disabled ? (
                <EyeOffIcon className="text-amber-500" />
              ) : (
                <EyeIcon className="text-emerald-600 dark:text-emerald-400" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Edit lokasi"
              title="Edit lokasi"
              onClick={() =>
                patchQr(row.qr_code_id, {
                  admin_label: window.prompt("Lokasi QR", row.admin_label ?? "") || row.admin_label,
                })
              }
            >
              <MapPinIcon className="text-blue-600 dark:text-blue-400" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Buka halaman publik"
              title="Buka halaman publik"
              render={<Link href={`/q/${row.qr_code_id}`} />}
            >
              <ExternalLinkIcon className="text-slate-500" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Hapus QR"
              title="Hapus QR"
              onClick={async () => {
                await deleteQr(row.qr_code_id);
                setActiveRowId(null);
              }}
            >
              <Trash2Icon className="text-red-600 dark:text-red-400" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm flex flex-col items-center text-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <SparklesIcon className="size-6" />
        </div>
        <h2 className="text-lg font-semibold">Generate QR Super Unik</h2>
        <div className="grid w-full max-w-md gap-1">
          <Input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Nama QR (dipakai >1 QR = grup)"
            maxLength={120}
          />
          {/* Lokasi muncul halus: grid-rows 0fr -> 1fr memberi transisi tinggi
              tanpa perlu tahu tinggi konten. Konten selalu di-render agar
              transisi masuk tetap jalan (mount mendadak tidak bisa dianimasikan). */}
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-out ${
              groupName.trim() ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              {/* Grid 6 kolom: lokasi 5 kolom, jumlah 1 kolom = 1/5 lebar lokasi. */}
              <div className="grid grid-cols-6 gap-1 pt-1">
                <Input
                  value={groupLocation}
                  onChange={(e) => setGroupLocation(e.target.value)}
                  placeholder="Lokasi (opsional): Meja 1, Kasir, ..."
                  maxLength={120}
                  className="col-span-5"
                />
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value) || 1)}
                  placeholder="Jml"
                  aria-label="Jumlah QR"
                  title="Jumlah QR: kosong/1 = bukan grup, >1 = grup"
                  className="col-span-1"
                />
              </div>
            </div>
          </div>
        </div>
        <Button onClick={handleCreate} disabled={status.kind === "loading"} size="lg">
          <QrCodeIcon className="size-5" />
          {status.kind === "loading"
            ? "Membuat..."
            : count > 1
              ? `Generate ${count} QR`
              : "Generate QR"}
        </Button>
      </div>

      {status.kind === "error" && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">{status.message}</p>}

      {status.kind === "done" && (
        <section aria-label="QR code siap" className="flex flex-col gap-4 rounded-xl border p-4 bg-background">
          {(() => {
            const active = status.items[status.activeIndex];
            if (!active) return null;
            return (
              <>
          <div ref={printRef} className="print:qr-card flex flex-col items-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.dataUrl} alt={`QR code ${active.qrCodeId}`} className="size-48 rounded-lg border bg-white p-2" />
            <p className="max-w-full truncate font-mono text-sm font-medium" title={active.publicUrl}>{shortText(active.publicUrl)}</p>
          </div>
          {status.items.length > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setStatus({ ...status, activeIndex: Math.max(0, status.activeIndex - 1) })}>Prev</Button>
              <span className="text-xs text-muted-foreground">{status.activeIndex + 1}/{status.items.length}</span>
              <Button variant="outline" size="sm" onClick={() => setStatus({ ...status, activeIndex: Math.min(status.items.length - 1, status.activeIndex + 1) })}>Next</Button>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={handleCopy}>{copied ? <CheckIcon /> : <CopyIcon />}{copied ? "Tersalin" : "Salin URL"}</Button>
            <Button variant="outline" onClick={handleDownload}><DownloadIcon />Unduh PNG</Button>
            <Button variant="outline" onClick={handleDownloadZip}><DownloadIcon />Unduh ZIP</Button>
            <Button variant="outline" onClick={handlePrint}><PrinterIcon />Cetak</Button>
            <Button render={<Link href={`/q/${active.qrCodeId}`} />}>Buka Halaman Publik</Button>
          </div>
              </>
            );
          })()}
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

        {/* Bar aksi massal: baru muncul setelah minimal 2 QR dipilih, dan hanya
            ikon berwarna — teks berat di sini menutupi nama QR di bawahnya. */}
        {selectedQrIds.size >= 2 && (
          <div className="mt-4 flex items-center justify-end gap-2 rounded-lg border bg-muted/40 px-3 py-2 animate-in fade-in-0 slide-in-from-top-2 duration-200">
            <span className="text-xs font-medium text-muted-foreground">
              {selectedQrIds.size} QR dipilih
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={bulkSetGroup}
              aria-label="Masukkan ke grup"
              title="Masukkan ke grup"
            >
              <FolderPlusIcon className="text-blue-600 dark:text-blue-400" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={bulkDelete}
              aria-label="Hapus terpilih"
              title="Hapus terpilih"
            >
              <Trash2Icon className="text-red-600 dark:text-red-400" />
            </Button>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-4">
          {/* QR individual: namanya dipakai ≤1 QR, jadi bukan grup — tampil tanpa header. */}
          {flatRows.length > 0 && (
            <div className="divide-y rounded-lg border p-3">{flatRows.map(renderRow)}</div>
          )}

          {/* Grup: nama dipakai >1 QR. Header = nama + lokasi + jumlah QR. */}
          {groupedEntries.map(([group, items]) => {
            const isOpen = !closedGroups.has(group);
            const location = locationSummary(items);
            return (
              <div key={group} className="rounded-lg border p-3">
                <button
                  type="button"
                  onClick={() =>
                    setClosedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    })
                  }
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{shortText(group, 24, 8)}</span>
                    {location && (
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {location}
                      </span>
                    )}
                    {/* shrink-0: jumlah QR tetap terlihat walau nama panjang. */}
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium">
                      {items.length} QR
                    </span>
                  </span>
                  <span className="shrink-0">{isOpen ? "−" : "+"}</span>
                </button>
                {isOpen && <div className="mt-2 divide-y">{items.map(renderRow)}</div>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
