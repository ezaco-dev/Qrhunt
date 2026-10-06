import { redirect } from "next/navigation";

import { AdminQrForm } from "@/components/AdminQrForm";
import { AdminSessionBadge } from "@/components/AdminSessionBadge";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  isAdminAuthenticated,
} from "@/lib/admin-auth";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseAdminConfigured } from "@/lib/supabase";

/**
 * Halaman admin.
 *
 * Server Component: cek sesi di sisi server sebelum satu pun HTML dikirim.
 * Kalau cookie tidak ada atau token tidak cocok, langsung redirect ke
 * `/admin/login` — tidak ada versi halaman ini yang bocor ke browser.
 *
 * `cookies()` di Next 16 adalah async.
 */
export default async function AdminPage() {
  const authenticated = await isAdminAuthenticated();

  if (!authenticated) {
    redirect("/admin/login");
  }

  // Env Supabase kosong berarti QR tidak akan pernah bisa dibuat. Tampilkan
  // petunjuk yang sama dengan halaman publik, bukan form yang selalu gagal.
  if (!isSupabaseAdminConfigured()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Admin QrHunt</h1>
        <div className="mt-6">
          <SetupNotice />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin QrHunt</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Buat QR code baru untuk ditempel di meja. Satu QR = satu media yang
            selalu bisa diganti siapa pun yang memindainya.
          </p>
        </div>
        <AdminSessionBadge
          cookieName={ADMIN_COOKIE_NAME}
          ttlSeconds={ADMIN_SESSION_TTL_SECONDS}
        />
      </header>

      <section className="mt-8">
        <AdminQrForm />
      </section>
    </main>
  );
}
