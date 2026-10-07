-- =============================================================================
-- QrHunt — skema database
--
-- Jalankan seluruh berkas ini di SQL Editor Supabase.
-- Skrip ini aman dijalankan berulang kali (idempoten).
--
-- Ringkasan desain yang perlu dipahami sebelum mengubah apa pun:
--   * Tulis SELALU lewat service role. Tidak ada policy tulis untuk anon.
--   * Auto-hide karena laporan terjadi DI DALAM RPC, bukan di kode aplikasi.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tabel
-- -----------------------------------------------------------------------------

create table if not exists public.qr_medias (
  id           uuid primary key default gen_random_uuid(),

  -- Panjang dibatasi di sini juga, bukan hanya di aplikasi. Nilai ini masuk ke
  -- path folder Cloudinary, jadi batas ini ikut melindungi quota.
  qr_code_id   text not null unique
               check (char_length(qr_code_id) between 1 and 64),

  media_type   text not null
               check (media_type in ('image', 'video', 'gif', 'text')),

  media_url    text,
  text_content text,

  report_count integer not null default 0 check (report_count >= 0),
  is_hidden    boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Rate limit: Token perangkat pengunggah terakhir dan hitungan pengganti unik.
  -- Menggunakan device token + cookie browser agar perangkat berbeda dalam 1 WiFi
  -- (mis. Cafe) tidak saling terblokir.
  last_uploader_device_id text,
  last_uploader_ip        text,
  unique_uploaders_since integer not null default 0,

  -- Invariant bentuk payload.
  --
  -- Media teks harus punya text_content dan TIDAK punya media_url; media file
  -- sebaliknya. Alasan Constraint ini ada di database: kolom `media_url` dan
  -- `text_content` dikirim terpisah, dan satu baris dengan kedua kolom terisi
  -- (atau keduanya kosong) akan membuat renderer tidak tahu mana yang dipakai.
  -- Memeriksa bentuknya di TypeScript saja tidak cukup, karena service role dan
  -- SQL Editor sama-sama bisa menulis tanpa melewati kode aplikasi.
  constraint qr_medias_payload_shape check (
    (media_type = 'text'  and text_content is not null and char_length(text_content) > 0 and media_url is null)
    or
    (media_type <> 'text' and text_content is null and media_url is not null)
  )
);

comment on table public.qr_medias is
  'Satu media aktif per qr_code_id. Semua tulis lewat service role.';

-- -----------------------------------------------------------------------------
-- Index
-- -----------------------------------------------------------------------------

-- `qr_code_id` sudah punya index sendiri dari constraint UNIQUE.

-- Halaman publik selalu memfilter is_hidden = false.
create index if not exists qr_medias_is_hidden_idx
  on public.qr_medias (is_hidden);

-- Halaman publik selalu mengurutkan yang terbaru dulu.
create index if not exists qr_medias_created_at_idx
  on public.qr_medias (created_at desc);

-- -----------------------------------------------------------------------------
-- Trigger: updated_at
-- -----------------------------------------------------------------------------

-- Fungsi generik, bisa dipakai ulang untuk tabel lain nanti.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.qr_medias;

create trigger set_updated_at
  before update on public.qr_medias
  for each row
  execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.qr_medias enable row level security;

-- Satu-satunya policy di tabel ini, dan satu-satunya policy yang DIBUTUHKAN:
-- policy baca untuk anon, hanya baris yang tidak disembunyikan.
--
-- Sengaja TIDAK ada policy INSERT/UPDATE/DELETE untuk anon atau authenticated.
-- Dua alasan:
--   1. Anonimitas. Semua operasi harus lewat service role, jadi tidak ada
--      jalur yang bisa menulis tanpa melewati validasi Zod dan moderasi.
--   2. Kalau anon key bocor, tidak ada yang bisa ditulis. Row Level Security
--      yang hanya punya policy baca gagal total menghadapi kebocoran kredensial.
create policy qr_medias_select_public
  on public.qr_medias
  for select
  to anon, authenticated
  using (is_hidden = false);

-- CATATAN KEAMANAN: policy ini juga membuat kolom `report_count` dan
-- `is_hidden` terlihat oleh anon untuk baris yang lolos filter (jadi
-- `is_hidden` selalu false di hasil). Aplikasi TIDAK pernah dikirim kolom itu
-- ke browser — `lib/media.ts` membangun payload publik kolom-per-kolom. Kalau
-- `report_count` tidak boleh terlihat oleh anon sama sekali, tambahkan view
-- yang hanya mengekspos kolom yang benar-benar dibutuhkan dan beri SELECT pada
-- view itu, bukan pada tabel.

-- -----------------------------------------------------------------------------
-- RPC: increment_report_count
-- -----------------------------------------------------------------------------

-- Auto-hide karena laporan harus ATOMIK. Kalau ini dilakukan di kode aplikasi
-- (SELECT → tambah → UPDATE → cek ambang), dua laporan yang datang bersamaan
-- akan membaca nilai yang sama, menulis nilai yang sama, dan salah satunya
-- hilang. Di sini baris terkunci dan seluruh operasi selesai dalam satu
-- transaksi, sehingga ambang batas tidak bisa dilewati.
create or replace function public.increment_report_count(
  p_qr_code_id text,
  p_threshold integer default 3
)
returns table (new_report_count integer, now_hidden boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count  integer;
  v_hidden boolean;
  v_found  boolean := false;
begin
  -- `UPDATE` biasa sudah mengunci baris yang disentuh sampai transaksi selesai.
  -- Postgres mengevaluasi ulang `report_count = report_count + 1` SETELAH lock
  -- diperoleh, jadi dua pemanggil yang datang bersamaan tidak saling menimpa
  -- counter: yang kedua menunggu, lalu membaca nilai yang sudah diperbarui.
  --
  -- Catatan: tidak ada klausa `FOR UPDATE` eksplisit di sini, dan tidak perlu.
  -- Kalau tetap ditambahkan, klausa itu hanya mengunci baris yang SEDANG
  -- di-update — jumlah barisnya sama, jadi tidak menambah keamanan apa pun.
  update public.qr_medias
     set report_count = report_count + 1
   where qr_code_id = p_qr_code_id
  returning report_count, is_hidden
    into v_count, v_hidden;

  -- `update ... returning` tidak menghasilkan baris kalau tidak ada yang cocok.
  -- `FOUND` harus disalin ke variabel SEGERA: setiap statement SQL berikutnya
  -- akan menimpanya.
  v_found := found;

  if v_found and v_count >= p_threshold then
    v_hidden := true;
    update public.qr_medias
       set is_hidden = true
     where qr_code_id = p_qr_code_id;
  end if;

  -- Mengembalikan NOL baris kalau QR tidak ada, bukan satu baris berisi NULL.
  --
  -- Ini penting: pemanggil memakai "baris tidak ada" sebagai tanda QR tidak ada
  -- (lalu membalas 404). `RETURN;` polos di dalam fungsi `RETURNS TABLE`
  -- akan menghasilkan satu baris NULL, yang membuat pemanggil mengira
  -- laporan berhasil dicatat. Karena itu baris disaring di dalam query
  -- `return query`, dan tidak ada `RETURN;` polos sama sekali.
  return query
    select v_count, coalesce(v_hidden, false)
     where v_found;
end;
$$;

-- `security definer` di atas berarti fungsi ini berjalan dengan hak pemilik,
-- sehingga bisa menulis meski policy RLS melarang anon. Itu sebabnya hak
-- `execute` HARUS dicabut dari publik — tanpa itu, siapa pun yang punya anon key
-- bisa menyembunyikan media QR mana pun tanpa batas laporan.
revoke execute on function public.increment_report_count(text, integer) from public;
revoke execute on function public.increment_report_count(text, integer) from anon;
revoke execute on function public.increment_report_count(text, integer) from authenticated;

-- Hanya service role (dipakai route handler) yang boleh memanggilnya.
grant execute on function public.increment_report_count(text, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Seed opsional
-- -----------------------------------------------------------------------------

-- Baris contoh supaya `/q/UMKM_001` langsung menampilkan sesuatu setelah setup.
insert into public.qr_medias (qr_code_id, media_type, text_content)
values (
  'UMKM_001',
  'text',
  'Selamat datang di kedai kami. Scan lagi kapan saja untuk melihat menu dan promo terbaru.'
)
on conflict (qr_code_id) do nothing;