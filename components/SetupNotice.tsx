import { DatabaseIcon, KeyRoundIcon, TerminalIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Petunjuk setup untuk ditampilkan ketika env Supabase belum terisi.
 *
 * Sengaja tidak throw dan tidak membaca env secara langsung: komponen ini
 * hanya presentasional, sehingga aman dipakai dari Server maupun Client
 * Component tanpa perlu batas Client/Server tambahan.
 */
export function SetupNotice() {
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TerminalIcon className="size-5" />
          QrHunt belum dikonfigurasi
        </CardTitle>
        <CardDescription>
          Aplikasi berjalan dengan mode fail-safe, jadi halaman ini tampil
          alih-alih error. Tiga langkah berikut membuatnya berfungsi.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <ol className="flex list-decimal flex-col gap-4 pl-5 text-sm">
          <li>
            <p className="flex items-center gap-2 font-medium">
              <KeyRoundIcon className="size-4" />
              Buat berkas environment
            </p>
            <p className="text-muted-foreground">
              Salin <code className="rounded bg-muted px-1 py-0.5">.env.example</code>{" "}
              menjadi{" "}
              <code className="rounded bg-muted px-1 py-0.5">.env.local</code>, lalu
              isi <code className="rounded bg-muted px-1 py-0.5">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
              dan{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                SUPABASE_SERVICE_ROLE_KEY
              </code>
              .
            </p>
          </li>

          <li>
            <p className="flex items-center gap-2 font-medium">
              <DatabaseIcon className="size-4" />
              Jalankan skema database
            </p>
            <p className="text-muted-foreground">
              Buka SQL Editor di dashboard Supabase, tempel seluruh isi{" "}
              <code className="rounded bg-muted px-1 py-0.5">schema.sql</code>,
              lalu jalankan. Skema ini membuat tabel{" "}
              <code className="rounded bg-muted px-1 py-0.5">qr_medias</code>,
              policy RLS, dan RPC untuk moderasi berbasis laporan.
            </p>
          </li>

          <li>
            <p className="flex items-center gap-2 font-medium">
              <TerminalIcon className="size-4" />
              Muat ulang halaman
            </p>
            <p className="text-muted-foreground">
              Setelah env tersimpan, muat ulang halaman ini. Server perlu
              direstart agar membaca nilai environment yang baru.
            </p>
          </li>
        </ol>

        <p className="text-xs text-muted-foreground">
          Bergantian file (gambar, GIF, video) juga membutuhkan kredensial
          Cloudinary, dan moderasi server perlu layanan NSFWJS di VPS yang
          menyala. Tanpa itu, unggahan akan ditolak dengan pesan yang jelas
          alih-alih diam-diam lolos.
        </p>
      </CardContent>
    </Card>
  );
}