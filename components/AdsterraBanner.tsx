"use client";

import { useEffect, useRef } from "react";

export interface AdsterraBannerProps {
  /** Key ID Adsterra (misal '0123456789abcdef'). */
  atKey?: string;
  format?: string;
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
  format = "300x250",
  width = 300,
  height = 250,
  className = "",
}: AdsterraBannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Fallback key dari env jika tidak diberikan di prop
  const activeKey =
    atKey ||
    process.env.NEXT_PUBLIC_ADSTERRA_KEY ||
    process.env.NEXT_PUBLIC_ADSTERRA_MODAL_KEY;

  useEffect(() => {
    if (!activeKey || !containerRef.current) return;

    const container = containerRef.current;
    container.innerHTML = "";

    const confScript = document.createElement("script");
    confScript.type = "text/javascript";
    confScript.text = `
      atOptions = {
        'key': '${activeKey}',
        'format': 'iframe',
        'height': ${height},
        'width': ${width},
        'params': {}
      };
    `;

    const invokeScript = document.createElement("script");
    invokeScript.type = "text/javascript";
    invokeScript.src = `//www.highperformanceformat.com/${activeKey}/invoke.js`;
    invokeScript.async = true;

    container.appendChild(confScript);
    container.appendChild(invokeScript);
  }, [activeKey, format, width, height]);

  if (!activeKey) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-4 text-center text-xs text-amber-600 dark:text-amber-400 ${className}`}
        style={{ minWidth: Math.min(width, 300), minHeight: Math.min(height, 150) }}
      >
        <span className="font-semibold">Area Iklan Adsterra</span>
        <span className="text-[11px] text-muted-foreground mt-1">
          Isi <code className="rounded bg-muted px-1">NEXT_PUBLIC_ADSTERRA_KEY</code> di env
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
