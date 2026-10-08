"use client";

import { useEffect, useRef } from "react";

interface AdsenseAdUnitProps {
  /** Ad slot ID dari dashboard AdSense (misal "1234567890"). */
  slot: string;
  /** Publisher ID ("ca-pub-..."). Env `NEXT_PUBLIC_ADSENSE_CLIENT`, fallback bawaan. */
  client?: string;
  format?: "auto" | "rectangle" | "horizontal" | "vertical";
  width?: number;
  height?: number;
  className?: string;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** Loader adsbygoogle.js hanya dimuat sekali per client. */
const loadedClients = new Set<string>();
/** `<ins>` yang sudah diberi iklan — jangan push dua kali (error AdSense). */
const pushedInsElements = new WeakSet<HTMLElement>();

/**
 * Unit iklan Google AdSense (Display).
 *
 * Memuat `adsbygoogle.js` sekali (data-cfasync tidak relevan, ini bukan
 * skrip Cloudflare) lalu mem-`push` instance untuk satu `<ins>`. Guard
 * `WeakSet` membuat StrictMode/remount tidak melempar error "all ins
 * elements ... already have ads".
 *
 * Tanpa `slot` (belum dibuat di dashboard) komponen tidak merender apa pun.
 */
export function AdsenseAdUnit({
  slot,
  client =
    process.env.NEXT_PUBLIC_ADSENSE_CLIENT || "ca-pub-8488653214573915",
  format = "auto",
  width,
  height,
  className = "",
}: AdsenseAdUnitProps) {
  const insRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    if (!client || !slot || !insRef.current) return;
    const ins = insRef.current;
    if (pushedInsElements.has(ins)) return;

    if (!loadedClients.has(client)) {
      loadedClients.add(client);
      const s = document.createElement("script");
      s.async = true;
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
      s.setAttribute("crossorigin", "anonymous");
      document.head.appendChild(s);
    }

    // Satu frame supaya <ins> sudah terpasang di DOM sebelum push.
    // Push sebelum loader selesai dimuat tetap aman: loader memproses
    // antrean `window.adsbygoogle` saat tiba.
    requestAnimationFrame(() => {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        pushedInsElements.add(ins);
      } catch {
        // Unit belum siap — biarkan kosong, tidak boleh gagal upload.
      }
    });
  }, [client, slot]);

  if (!slot) return null;

  const style: React.CSSProperties = { display: "block" };
  if (width) style.width = width;
  if (height) style.height = height;

  return (
    <ins
      ref={insRef}
      className={`adsbygoogle ${className}`}
      style={style}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive="true"
    />
  );
}