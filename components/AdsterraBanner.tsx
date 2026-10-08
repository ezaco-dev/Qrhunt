"use client";

import { useEffect, useRef } from "react";

export interface AdsterraBannerProps {
  /** Zone/container ID Adsterra Native Banner (misal '31600725'). */
  atKey?: string;
  /** Script URL Native Banner dari Adsterra panel. */
  scriptUrl?: string;
  scriptUrlEnv?: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Registry per zone key: satu key hanya boleh punya SATU container di DOM.
 *
 * Dua alasan:
 * 1. Script Adsterra mencari `#container-<key>` lewat `document.getElementById`,
 *    yang selalu mengembalikan elemen PERTAMA. Saat banner bawah halaman media
 *    dan banner di AdModal terpasang bersamaan (key sama), iklan jatuh ke banner
 *    bawah dan container modal tetap kosong.
 * 2. Script itu TIDAK merender ulang saat dieksekusi kedua kali (sudah ada
 *    guard global). Jadi container tidak boleh dibuat ulang: ia dibuat sekali,
 *    lalu DIMINDAHKAN antar instance — konten iklan ikut terbawa.
 *
 * Script-nya sendiri disuntik sekali ke `document.body` (bukan ke dalam div
 * React) supaya tetap hidup walau instance yang memuatnya unmount.
 */
const registries = new Map<string, Set<string>>();
const listeners = new Map<string, Set<() => void>>();
const zoneStates = new Map<
  string,
  { container: HTMLDivElement | null; scriptInjected: boolean }
>();
let instanceSeq = 0;

function subscribeZone(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  listeners.set(key, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

function emitZone(key: string): void {
  for (const listener of [...(listeners.get(key) ?? [])]) listener();
}

function isActiveInstance(key: string, id: string): boolean {
  const members = [...(registries.get(key) ?? [])];
  return members[members.length - 1] === id;
}

/**
 * Komponen pembungkus Iklan Adsterra.
 *
 * Menginjeksikan container `container-<key>` dan script Native Banner ke dalam
 * kontainer React tanpa merusak SSR atau memicu hydration error.
 */
export function AdsterraBanner({
  atKey,
  scriptUrl,
  scriptUrlEnv,
  width = 300,
  height = 250,
  className = "",
}: AdsterraBannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceIdRef = useRef<string>("");

  const zoneId =
    atKey ||
    process.env.NEXT_PUBLIC_ADSTERRA_KEY ||
    process.env.NEXT_PUBLIC_ADSTERRA_MODAL_KEY;
  const activeScriptUrl =
    scriptUrl ||
    scriptUrlEnv ||
    process.env.NEXT_PUBLIC_ADSTERRA_SCRIPT_URL ||
    process.env.NEXT_PUBLIC_ADSTERRA_MODAL_SCRIPT_URL;

  useEffect(() => {
    if (!zoneId || !activeScriptUrl || !containerRef.current) return;

    // Id instance dibuat di effect, bukan saat render: ref tidak boleh
    // dibaca/ditulis selama render (larangan react-hooks/refs).
    if (!instanceIdRef.current) {
      instanceSeq += 1;
      instanceIdRef.current = `adsterra-${instanceSeq}`;
    }

    const wrapper = containerRef.current;
    const instanceId = instanceIdRef.current;

    const members = registries.get(zoneId) ?? new Set<string>();
    members.add(instanceId);
    registries.set(zoneId, members);

    /** Ambil alih container (dipindah ke wrapper ini) + suntik script sekali. */
    const activate = () => {
      const state = zoneStates.get(zoneId) ?? { container: null, scriptInjected: false };
      zoneStates.set(zoneId, state);

      if (!state.container) {
        const adContainer = document.createElement("div");
        adContainer.id = `container-${zoneId}`;
        state.container = adContainer;
      }
      // appendChild = MEMINDAHKAN node beserta konten iklan yang sudah terisi.
      wrapper.appendChild(state.container);

      if (!state.scriptInjected) {
        state.scriptInjected = true;
        const invokeScript = document.createElement("script");
        invokeScript.type = "text/javascript";
        invokeScript.src = activeScriptUrl;
        invokeScript.async = true;
        document.body.appendChild(invokeScript);
      }
    };

    /** Lepas container dari wrapper ini; node-nya disimpan untuk instance berikut. */
    const deactivate = () => {
      const state = zoneStates.get(zoneId);
      if (state?.container && wrapper.contains(state.container)) {
        state.container.remove();
      }
    };

    const unsubscribe = subscribeZone(zoneId, () => {
      if (isActiveInstance(zoneId, instanceId)) activate();
      else deactivate();
    });
    emitZone(zoneId);

    return () => {
      unsubscribe();
      members.delete(instanceId);
      if (members.size === 0) registries.delete(zoneId);
      // Instance sisa (mis. banner bawah) mengambil alih container dulu,
      // baru wrapper ini dibersihkan kalau memang tidak ada yang tersisa.
      emitZone(zoneId);
      const state = zoneStates.get(zoneId);
      if (state?.container && wrapper.contains(state.container)) {
        state.container.remove();
      }
    };
  }, [activeScriptUrl, zoneId]);

  if (!zoneId || !activeScriptUrl) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-4 text-center text-xs text-amber-600 dark:text-amber-400 ${className}`}
        style={{ minWidth: Math.min(width, 300), minHeight: Math.min(height, 150) }}
      >
        <span className="font-semibold">Area Iklan Adsterra</span>
        <span className="text-[11px] text-muted-foreground mt-1">
          Isi <code className="rounded bg-muted px-1">NEXT_PUBLIC_ADSTERRA_KEY</code> dan <code className="rounded bg-muted px-1">NEXT_PUBLIC_ADSTERRA_SCRIPT_URL</code>
        </span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex items-center justify-center overflow-hidden my-2 ${className}`}
      style={{ minWidth: width, minHeight: height }}
    />
  );
}
