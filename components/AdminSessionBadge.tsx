"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface AdminSessionBadgeProps {
  cookieName: string;
  ttlSeconds: number;
}

/**
 * Indikator sesi admin + tombol logout.
 *
 * `cookieName` dan `ttlSeconds` dikirim sebagai props supaya komponen ini
 * tidak perlu mengimpor modul server (`lib/admin-auth.ts`) yang memegang
 * secret — import itu akan menarik `node:crypto` ke bundel browser.
 */
export function AdminSessionBadge({
  cookieName,
  ttlSeconds,
}: AdminSessionBadgeProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      router.replace("/admin/login");
    } finally {
      setLoading(false);
    }
  }, [router]);

  const hours = Math.round(ttlSeconds / 3600);

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline">
        sesi {hours} jam · cookie {cookieName}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={handleLogout}
        disabled={loading}
      >
        <LogOutIcon />
        {loading ? "Keluar…" : "Keluar"}
      </Button>
    </div>
  );
}
