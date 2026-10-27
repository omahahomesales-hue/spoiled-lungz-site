-- Spoiled Lungz — members area, orders/delivery, staff roles, inventory fields
-- Applied after schema.sql

------------------------------------------------------------
-- Staff roles: admin (full access) and driver (assigned deliveries only)
------------------------------------------------------------
alter table public.admins add column if not exists role text not null default 'admin';
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check (role in ('admin','driver'));
alter table public.admins add column if not exists name text;

create or replace function public.jwt_email()
returns text language sql stable set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = public.jwt_email() and role = 'admin');
$$;

create or replace function public.is_driver()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = public.jwt_email() and role = 'driver');
$$;

create or replace function public.my_staff_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.admins where lower(email) = public.jwt_email() limit 1;
$$;

-- admins can manage the staff list (add drivers, remove staff)
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select to authenticated using (public.is_admin());
create policy admins_insert on public.admins for insert to authenticated with check (public.is_admin());
create policy admins_update on public.admins for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admins_delete on public.admins for delete to authenticated using (public.is_admin() and lower(email) <> public.jwt_email());

------------------------------------------------------------
-- Members (applications reviewed by an admin)
------------------------------------------------------------
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  phone text,
  date_of_birth date not null,
  status text not null default 'pending' check (status in ('pending','approved','denied','revoked')),
  id_photo_path text,
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);
alter table public.members enable row level security;

create policy members_read on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- no insert/update/delete policies: rows are created by the signup trigger and changed only through the functions below

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and status = 'approved');
$$;

-- When someone signs up through the member application, create their pending application.
create or replace function public.handle_member_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  dob date;
begin
  if coalesce(meta ->> 'member_application', '') <> 'true' then
    return new;
  end if;
  dob := (meta ->> 'date_of_birth')::date;
  if dob is null or dob > (current_date - interval '21 years')::date then
    raise exception 'Members must be 21 or older';
  end if;
  insert into public.members (user_id, email, full_name, phone, date_of_birth)
  values (new.id, lower(new.email), left(trim(coalesce(meta ->> 'full_name', '')), 120), left(trim(coalesce(meta ->> 'phone', '')), 40), dob)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_member_application on auth.users;
create trigger on_member_application after insert on auth.users
  for each row execute function public.handle_member_application();

-- Admin: approve / deny / revoke / reset to pending
create or replace function public.admin_review_member(p_user_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  if p_status not in ('pending','approved','denied','revoked') then raise exception 'Unknown status'; end if;
  update public.members
     set status = p_status,
         admin_note = coalesce(p_note, admin_note),
         reviewed_at = now(),
         reviewed_by = public.jwt_email()
   where user_id = p_user_id;
  if not found then raise exception 'Member not found'; end if;
end; $$;

-- Member: attach an uploaded ID photo to their own application
create or replace function public.member_set_id_photo(p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'Not allowed'; end if;
  update public.members set id_photo_path = p_path where user_id = auth.uid();
end; $$;

-- Private bucket for ID photos: members upload into their own folder; only admins (and the owner of the file) can read
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-ids', 'member-ids', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

create policy member_ids_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'member-ids' and (storage.foldername(name))[1] = auth.uid()::text);
create policy member_ids_read on storage.objects for select to authenticated
  using (bucket_id = 'member-ids' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy member_ids_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'member-ids' and public.is_admin());

------------------------------------------------------------
-- Inventory fields on products
------------------------------------------------------------
alter table public.products add column if not exists price_cents int check (price_cents is null or price_cents >= 0);
alter table public.products add column if not exists stock int check (stock is null or stock >= 0);
alter table public.products add column if not exists members_only boolean not null default false;

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products for select to anon, authenticated
  using ((published and (not members_only or public.is_member())) or public.is_admin());

------------------------------------------------------------
-- Orders
------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity,
  user_id uuid references auth.users(id) on delete set null,
  customer_name text,
  customer_email text,
  customer_phone text,
  fulfillment text not null check (fulfillment in ('delivery','pickup')),
  delivery_address text,
  pickup_location_id uuid references public.locations(id) on delete set null,
  notes text,
  status text not null default 'new'
    check (status in ('new','confirmed','out_for_delivery','ready_for_pickup','completed','cancelled')),
  payment_method text not null default 'pay_at_handoff',
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','refunded')),
  subtotal_cents int not null check (subtotal_cents >= 0),
  driver_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  unit_price_cents int not null check (unit_price_cents >= 0),
  quantity int not null check (quantity between 1 and 50)
);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_product_idx on public.order_items(product_id);
create index if not exists orders_user_idx on public.orders(user_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_pickup_idx on public.orders(pickup_location_id);

drop trigger if exists t_orders_touch on public.orders;
create trigger t_orders_touch before update on public.orders for each row execute function public.touch_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy orders_read on public.orders for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or (public.is_driver() and lower(driver_email) = public.jwt_email()));
create policy orders_admin_update on public.orders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy orders_admin_delete on public.orders for delete to authenticated
  using (public.is_admin());

create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- Place an order (approved members only). Prices and stock come from the database, never from the browser.
create or replace function public.place_order(
  p_items jsonb, p_fulfillment text, p_address text default null,
  p_pickup_location uuid default null, p_phone text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.members%rowtype;
  it record;
  p public.products%rowtype;
  v_order uuid;
  v_number bigint;
  v_total int := 0;
  v_count int := 0;
begin
  select * into m from public.members where user_id = auth.uid();
  if not found or m.status <> 'approved' then raise exception 'Only approved members can place orders'; end if;
  if p_fulfillment not in ('delivery','pickup') then raise exception 'Choose delivery or pickup'; end if;
  if p_fulfillment = 'delivery' and char_length(trim(coalesce(p_address,''))) < 8 then raise exception 'Add a full delivery address'; end if;
  if p_fulfillment = 'pickup' and not exists (select 1 from public.locations where id = p_pickup_location and published) then
    raise exception 'Choose a pickup boutique';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your order is empty'; end if;

  insert into public.orders (user_id, customer_name, customer_email, customer_phone, fulfillment, delivery_address,
                             pickup_location_id, notes, subtotal_cents)
  values (auth.uid(), m.full_name, m.email, left(coalesce(nullif(trim(p_phone),''), m.phone), 40), p_fulfillment,
          case when p_fulfillment = 'delivery' then left(trim(p_address), 300) end,
          case when p_fulfillment = 'pickup' then p_pickup_location end,
          left(nullif(trim(coalesce(p_notes,'')),''), 1000), 0)
  returning id, order_number into v_order, v_number;

  for it in
    select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::int)::int as qty
      from jsonb_array_elements(p_items) e group by 1
  loop
    v_count := v_count + 1;
    if v_count > 25 then raise exception 'Too many different items in one order'; end if;
    if it.qty is null or it.qty < 1 or it.qty > 20 then raise exception 'Quantities must be between 1 and 20'; end if;
    select * into p from public.products where id = it.product_id and published for update;
    if not found or p.price_cents is null then raise exception 'One of the items is no longer available'; end if;
    if p.stock is not null then
      if p.stock < it.qty then raise exception 'Only % left of %', p.stock, p.name; end if;
      update public.products set stock = stock - it.qty where id = p.id;
    end if;
    insert into public.order_items (order_id, product_id, name, unit_price_cents, quantity)
    values (v_order, p.id, p.name, p.price_cents, it.qty);
    v_total := v_total + p.price_cents * it.qty;
  end loop;

  update public.orders set subtotal_cents = v_total where id = v_order;
  return jsonb_build_object('id', v_order, 'order_number', v_number, 'subtotal_cents', v_total);
end; $$;

-- Put stock back when an order is cancelled
create or replace function public.restock_order(p_order uuid)
returns void language sql security definer set search_path = public as $$
  update public.products p set stock = p.stock + i.quantity
    from public.order_items i
   where i.order_id = p_order and i.product_id = p.id and p.stock is not null;
$$;
revoke execute on function public.restock_order(uuid) from public, anon, authenticated;

-- Member cancels their own order while it is still new
create or replace function public.cancel_my_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'cancelled'
   where id = p_order and user_id = auth.uid() and status = 'new';
  if not found then raise exception 'This order can no longer be cancelled online. Contact us.'; end if;
  perform public.restock_order(p_order);
end; $$;

-- Staff status changes: admins can set any status; drivers only move their assigned deliveries forward
create or replace function public.set_order_status(p_order uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if p_status not in ('new','confirmed','out_for_delivery','ready_for_pickup','completed','cancelled') then
    raise exception 'Unknown status';
  end if;
  if public.is_admin() then
    null;
  elsif public.is_driver() and lower(o.driver_email) = public.jwt_email()
        and p_status in ('out_for_delivery','completed') and o.status not in ('cancelled','completed') then
    null;
  else
    raise exception 'Not allowed';
  end if;
  if o.status = p_status then return; end if;
  if o.status = 'cancelled' then raise exception 'Cancelled orders cannot be reopened. Ask the member to order again.'; end if;
  if p_status = 'cancelled' then perform public.restock_order(p_order); end if;
  update public.orders set status = p_status where id = p_order;
end; $$;

-- Drivers mark cash/card collected at the door
create or replace function public.driver_mark_paid(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders set payment_status = 'paid'
   where id = p_order and (public.is_admin() or (public.is_driver() and lower(driver_email) = public.jwt_email()));
  if not found then raise exception 'Not allowed'; end if;
end; $$;

revoke execute on function public.place_order(jsonb, text, text, uuid, text, text) from public, anon;
grant execute on function public.place_order(jsonb, text, text, uuid, text, text) to authenticated;
revoke execute on function public.cancel_my_order(uuid) from public, anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;
revoke execute on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;
revoke execute on function public.driver_mark_paid(uuid) from public, anon;
grant execute on function public.driver_mark_paid(uuid) to authenticated;
revoke execute on function public.admin_review_member(uuid, text, text) from public, anon;
grant execute on function public.admin_review_member(uuid, text, text) to authenticated;
revoke execute on function public.member_set_id_photo(text) from public, anon;
grant execute on function public.member_set_id_photo(text) to authenticated;
revoke execute on function public.handle_member_application() from public, anon, authenticated;
