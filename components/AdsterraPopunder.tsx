"use client";

import { useEffect } from "react";

interface AdsterraPopunderProps {
  /** Naik jadi true saat tombol unggah diklik (user gesture). */
  fire: boolean;
  /** Konten snippet popunder dari panel Adsterra (tanpa tag <script>). */
  snippet?: string;
  /** Alternatif: URL script popunder. */
  scriptUrl?: string;
}

/** Script popunder sempat dieksekusi sekali per halaman (hindari spam tab). */
const firedSnippets = new Set<string>();
const firedUrls = new Set<string>();

/**
 * Popunder Adsterra: membuka tab iklan penuh layar di latar belakang.
 *
 * Suntikan terjadi pada user gesture (klik unggah), bukan saat halaman
 * dimuat — gesture itu yang membuat `window.open`/popunder tidak diblokir
 * browser. Timer tonton 20 detik di AdModal tetap menjadi penjaga unggahan.
 */
export function AdsterraPopunder({ fire, snippet, scriptUrl }: AdsterraPopunderProps) {
  const snippetText = snippet || process.env.NEXT_PUBLIC_ADSTERRA_POPUNDER_SNIPPET || "";
  const url =
    scriptUrl ||
    process.env.NEXT_PUBLIC_ADSTERRA_POPUNDER_URL ||
    "https://abscloud.org/1/bb6d897863f84046ab0301e4001b1dcf";

  useEffect(() => {
    if (!fire) return;
    if (!snippetText && !url) return;
    if (snippetText && firedSnippets.has(snippetText)) return;
    if (url && firedUrls.has(url)) return;

    if (snippetText) {
      firedSnippets.add(snippetText);
      const s = document.createElement("script");
      s.type = "text/javascript";
      s.text = snippetText;
      document.body.appendChild(s);
      return;
    }

    firedUrls.add(url);
    const s = document.createElement("script");
    s.type = "text/javascript";
    // Tidak boleh di-defer oleh Cloudflare Rocket Loader: `data-cfasync=false`.
    s.setAttribute("data-cfasync", "false");
    s.src = url;
    s.async = true;
    document.body.appendChild(s);
  }, [fire, snippetText, url]);

  return null;
}