-- Spoiled Lungz — database schema
-- Public site reads published rows; only emails listed in public.admins can write.

create extension if not exists pgcrypto;

-- Admins (who can sign in to /admin and edit content)
create table if not exists public.admins (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Boutique locations
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  street text not null,
  city_state_zip text not null,
  area text,
  phone text,
  hours text,
  published boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Products (THC menu — display only, no online checkout)
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('flower','edibles','concentrates','vapes')),
  name text not null,
  subtitle text,            -- e.g. "Hybrid · Gelato x Runtz"
  description text,
  image_url text,
  available_at uuid[] not null default '{}',   -- location ids
  is_new boolean not null default false,
  featured boolean not null default false,
  published boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Merch (sold online via Stripe Payment Links)
create table if not exists public.merch (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_cents int check (price_cents is null or price_cents >= 0),
  buy_url text,             -- Stripe Payment Link
  image_url text,
  sold_out boolean not null default false,
  published boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contact form messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200),
  topic text check (char_length(topic) <= 80),
  body text not null check (char_length(body) between 1 and 5000),
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists t_locations_touch on public.locations;
create trigger t_locations_touch before update on public.locations for each row execute function public.touch_updated_at();
drop trigger if exists t_products_touch on public.products;
create trigger t_products_touch before update on public.products for each row execute function public.touch_updated_at();
drop trigger if exists t_merch_touch on public.merch;
create trigger t_merch_touch before update on public.merch for each row execute function public.touch_updated_at();

-- Row level security
alter table public.admins    enable row level security;
alter table public.locations enable row level security;
alter table public.products  enable row level security;
alter table public.merch     enable row level security;
alter table public.messages  enable row level security;

-- admins: admins can see the list (no public access; managed via SQL)
create policy admins_read on public.admins for select to authenticated using (public.is_admin());

-- content tables: public reads published rows, admins read/write everything
create policy locations_public_read on public.locations for select to anon, authenticated using (published or public.is_admin());
create policy locations_admin_insert on public.locations for insert to authenticated with check (public.is_admin());
create policy locations_admin_update on public.locations for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy locations_admin_delete on public.locations for delete to authenticated using (public.is_admin());

create policy products_public_read on public.products for select to anon, authenticated using (published or public.is_admin());
create policy products_admin_insert on public.products for insert to authenticated with check (public.is_admin());
create policy products_admin_update on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy products_admin_delete on public.products for delete to authenticated using (public.is_admin());

create policy merch_public_read on public.merch for select to anon, authenticated using (published or public.is_admin());
create policy merch_admin_insert on public.merch for insert to authenticated with check (public.is_admin());
create policy merch_admin_update on public.merch for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy merch_admin_delete on public.merch for delete to authenticated using (public.is_admin());

-- messages: anyone can submit, only admins can read/update/delete
create policy messages_insert on public.messages for insert to anon, authenticated with check (handled = false);
create policy messages_admin_read on public.messages for select to authenticated using (public.is_admin());
create policy messages_admin_update on public.messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy messages_admin_delete on public.messages for delete to authenticated using (public.is_admin());

-- Storage bucket for product/merch photos (public read, admin write)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;

create policy media_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'media' and public.is_admin());
create policy media_admin_update on storage.objects for update to authenticated using (bucket_id = 'media' and public.is_admin());
create policy media_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'media' and public.is_admin());

-- Seed the two boutiques
insert into public.locations (name, street, city_state_zip, area, sort) values
  ('Plant''d Farma Wellness Boutique', '1207 Harney St', 'Omaha, NE 68102', 'Downtown Omaha', 1),
  ('Tree Haus Cannabis Boutique', '3863 Farnam St Ste 3', 'Omaha, NE 68131', 'Midtown Omaha', 2);

-- First admin (add more the same way)
insert into public.admins (email) values ('omahahomesales@gmail.com');
