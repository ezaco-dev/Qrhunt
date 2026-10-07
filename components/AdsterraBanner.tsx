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
 * Komponen pembungkus Iklan Adsterra.
 *
 * Menginjeksikan script `atOptions` dan `invoke.js` secara aman ke dalam
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

    const container = containerRef.current;
    container.innerHTML = "";
    const adContainer = document.createElement("div");
    adContainer.id = `container-${zoneId}`;

    const invokeScript = document.createElement("script");
    invokeScript.type = "text/javascript";
    invokeScript.src = activeScriptUrl;
    invokeScript.async = true;

    container.appendChild(adContainer);
    container.appendChild(invokeScript);
  }, [zoneId, activeScriptUrl]);

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
