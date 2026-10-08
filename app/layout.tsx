import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "QrHunt",
  description:
    "Bagikan satu media lewat satu QR code. Tanpa login, dan bisa diganti siapa pun.",
  /**
   * Halaman QR menampilkan media milik pengguna. Mesin pencari tidak boleh
   * mengindeksnya sebagai hasil pencarian: ini membocorkan konten pengguna ke
   * indeks publik dan membuat URL `/q/<id>` bisa ditemukan tanpa QR.
   * `follow: true` tetap dibiarkan supaya tautan dari halaman QR (tautan
   * home) tetap bisa dirayapi.
   */
  robots: {
    index: false,
    follow: true,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8488653214573915"
          crossOrigin="anonymous"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}