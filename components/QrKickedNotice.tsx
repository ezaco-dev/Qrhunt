import Link from "next/link";
import { ClockIcon, HomeIcon, LockIcon, UsersIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export interface QrKickedNoticeProps {
  qrCodeId: string;
  hoursLeft: number;
  minutesLeft: number;
  uniqueUploadersLeft: number;
}

/**
 * Tampilan untuk pengguna yang baru saja mengganti media QR.
 *
 * Pengguna ditendang dan tidak bisa mengakses/melihat halaman QR ini
 * sampai 3 pengguna lain mengganti medianya ATAU 5 jam berlalu.
 */
export function QrKickedNotice({
  qrCodeId,
  hoursLeft,
  minutesLeft,
  uniqueUploadersLeft,
}: QrKickedNoticeProps) {
  const timeText =
    hoursLeft > 0
      ? `${hoursLeft} jam ${minutesLeft > 0 ? `${minutesLeft} menit` : ""}`
      : `${minutesLeft} menit`;

  return (
    <Card className="w-full border-amber-500/30 bg-amber-500/5 shadow-md">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <LockIcon className="size-6" />
        </div>
        <CardTitle className="text-xl font-semibold">
          Akses Dibatasi Sementara
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Anda baru saja memperbarui media untuk QR <span className="font-mono font-medium text-foreground">{qrCodeId}</span>.
        </p>
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        <div className="rounded-lg border bg-background/80 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <UsersIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium">Batas Pengganti Unik</p>
              <p className="text-xs text-muted-foreground">
                Butuh <span className="font-semibold text-foreground">{uniqueUploadersLeft} pengguna lain</span> untuk mengganti media ini sebelum Anda bisa mengaksesnya kembali.
              </p>
            </div>
          </div>

          <div className="border-t pt-3 flex items-start gap-3">
            <ClockIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium">Batas Waktu</p>
              <p className="text-xs text-muted-foreground">
                Atau tunggu <span className="font-semibold text-foreground">{timeText}</span> lagi.
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          Aturan ini mencegah satu pengguna menguasai QR code secara terus-menerus.
        </p>
      </CardContent>

      <CardFooter className="flex justify-center pt-2">
        <Button render={<Link href="/" />} variant="outline" className="w-full sm:w-auto">
          <HomeIcon className="size-4" />
          Kembali ke Beranda
        </Button>
      </CardFooter>
    </Card>
  );
}
