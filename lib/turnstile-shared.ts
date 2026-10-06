/**
 * Konstanta placeholder anti-bot.
 *
 * File ini SENGAJA TIDAK mengimpor apa pun. Tujuannya: Client Component boleh
 * mengimpor `PLACEHOLDER_TOKEN` tanpa menarik `lib/turnstile.ts` (yang
 * menggunakan `process.env.TURNSTILE_SECRET_KEY`) ke dalam browser bundle.
 *
 * Verifikasi: setelah build, `grep -r "TURNSTILE_SECRET_KEY\|assertServerOnly"
 * .next/static/chunks/` harus nihil.
 */

export const PLACEHOLDER_TOKEN = "TURNSTILE_PLACEHOLDER_TOKEN";

export const DUMMY_CLOUDFLARE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";