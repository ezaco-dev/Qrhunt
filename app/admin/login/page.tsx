import { redirect } from "next/navigation";

import { AdminLoginForm } from "@/components/AdminLoginForm";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const metadata = { title: "Login admin · QrHunt" };

/**
 * Halaman login admin.
 *
 * Kalau ternyata sudah login, langsung lempar ke `/admin` — tidak ada alasan
 * menampilkan form lagi.
 */
export default async function AdminLoginPage() {
  if (await isAdminAuthenticated()) {
    redirect("/admin");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-semibold">Admin QrHunt</h1>
        <p className="text-sm text-muted-foreground">
          Masukkan password admin untuk membuat QR code baru.
        </p>
      </header>

      <AdminLoginForm />
    </main>
  );
}
