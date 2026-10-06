"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRoundIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Form login admin.
 *
 * Tidak ada proteksi khusus di sisi klien: semua yang nyata (password benar
 * atau tidak, rate limit, cookie httpOnly) terjadi di `/api/admin/login`.
 * Yang di sini hanya mengumpulkan input dan menampilkan pesan.
 */
export function AdminLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setLoading(true);

      try {
        const response = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const payload = (await response.json()) as { ok: boolean; error?: string };

        if (!response.ok || !payload.ok) {
          setError(payload.error ?? `Login gagal (HTTP ${response.status}).`);
          return;
        }

        // Segarkan Server Component supaya cookie yang baru terbaca.
        router.replace("/admin");
        router.refresh();
      } catch {
        setError("Tidak bisa menghubungi server. Coba lagi.");
      } finally {
        setLoading(false);
      }
    },
    [password, router],
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="admin-password">Password admin</Label>
        <Input
          id="admin-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {/* Base UI: `type` harus di elemen render, bukan di prop Button —
          prop kalah oleh render bawaan `<button type="button" />`. */}
      <Button render={<button type="submit" />} disabled={loading}>
        <KeyRoundIcon />
        {loading ? "Memeriksa…" : "Masuk"}
      </Button>
    </form>
  );
}
