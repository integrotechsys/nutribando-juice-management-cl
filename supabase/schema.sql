-- =====================================================================
-- NutriBando Juice — database schema
-- Run ONCE in Supabase: SQL Editor -> New query -> paste all -> Run
-- (Safe to re-run: policies and functions are recreated.)
-- =====================================================================

-- Today's date in East Africa Time (GMT+3)
create or replace function public.eat_today() returns date
language sql stable as $$
  select (now() at time zone 'Africa/Dar_es_Salaam')::date
$$;

-- ---------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  role        text not null default 'staff' check (role in ('admin','staff')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  price       numeric(12,0) not null default 0 check (price >= 0),  -- TSh per 1L bottle
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.sellers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.dispatches (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid not null references public.sellers(id),
  dispatch_date    date not null default public.eat_today(),
  status           text not null default 'open' check (status in ('open','closed')),
  expected_amount  numeric(14,0) not null default 0,   -- value of bottles sold (set at close)
  cash_collected   numeric(14,0) not null default 0,   -- money actually received
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  closed_at        timestamptz,
  closed_by        uuid
);

-- one row per load handed to the seller (first load + every "add more")
create table if not exists public.dispatch_items (
  id           uuid primary key default gen_random_uuid(),
  dispatch_id  uuid not null references public.dispatches(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  qty          int not null check (qty > 0),
  unit_price   numeric(12,0) not null default 0,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

-- one row per juice when the dispatch is reconciled
create table if not exists public.dispatch_returns (
  id            uuid primary key default gen_random_uuid(),
  dispatch_id   uuid not null references public.dispatches(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  qty_out       int not null,
  qty_returned  int not null check (qty_returned >= 0),
  qty_sold      int not null,
  unit_price    numeric(12,2) not null default 0,
  amount        numeric(14,0) not null default 0,
  unique (dispatch_id, product_id)
);

-- sales made at the shop (glass or takeaway)
create table if not exists public.shop_sales (
  id          uuid primary key default gen_random_uuid(),
  sale_date   date not null default public.eat_today(),
  product_id  uuid references public.products(id),
  kind        text not null default 'glass' check (kind in ('glass','takeaway')),
  qty         int not null default 1 check (qty > 0),
  amount      numeric(14,0) not null check (amount >= 0),
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  expense_date  date not null default public.eat_today(),
  category      text not null,
  description   text,
  amount        numeric(14,0) not null check (amount >= 0),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_dispatches_date   on public.dispatches(dispatch_date);
create index if not exists idx_dispatches_status on public.dispatches(status);
create index if not exists idx_items_dispatch    on public.dispatch_items(dispatch_id);
create index if not exists idx_returns_dispatch  on public.dispatch_returns(dispatch_id);
create index if not exists idx_shop_date         on public.shop_sales(sale_date);
create index if not exists idx_expenses_date     on public.expenses(expense_date);

-- ---------------------------------------------------------------------
-- ROLE HELPERS
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin' and active)
$$;

create or replace function public.is_staff() returns boolean   -- staff OR admin
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('admin','staff') and active)
$$;

-- New login => profile row. The very FIRST user becomes admin, everyone after is staff.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when not exists (select 1 from public.profiles) then 'admin' else 'staff' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
--   admin : everything (add / edit / delete)
--   staff : read dispatch data, add shop sales, and use the dispatch
--           functions below (create, add more juice, reconcile)
-- ---------------------------------------------------------------------
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.profiles         enable row level security;
alter table public.products         enable row level security;
alter table public.sellers          enable row level security;
alter table public.dispatches       enable row level security;
alter table public.dispatch_items   enable row level security;
alter table public.dispatch_returns enable row level security;
alter table public.shop_sales       enable row level security;
alter table public.expenses         enable row level security;

-- admin: full access to every table
do $$
declare t text;
begin
  foreach t in array array['profiles','products','sellers','dispatches','dispatch_items',
                           'dispatch_returns','shop_sales','expenses'] loop
    execute format('create policy "admin all" on public.%I for all to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  -- staff: read-only on these (expenses and profiles of others stay hidden)
  foreach t in array array['products','sellers','dispatches','dispatch_items',
                           'dispatch_returns','shop_sales'] loop
    execute format('create policy "staff read" on public.%I for select to authenticated
                    using (public.is_staff())', t);
  end loop;
end $$;

create policy "own profile" on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "staff add shop sales" on public.shop_sales for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());

-- ---------------------------------------------------------------------
-- DISPATCH FUNCTIONS (used by staff and admin)
-- ---------------------------------------------------------------------

-- internal helper: insert items, price is always taken from the products table
create or replace function public._insert_items(p_dispatch uuid, p_items jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.dispatch_items (dispatch_id, product_id, qty, unit_price)
  select p_dispatch, (x->>'product_id')::uuid, (x->>'qty')::int, pr.price
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  join public.products pr on pr.id = (x->>'product_id')::uuid
  where (x->>'qty')::int > 0
$$;

-- 1) New dispatch: seller + juices + quantities
create or replace function public.create_dispatch(
  p_seller uuid, p_date date, p_items jsonb, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
                 where (x->>'qty')::int > 0) then
    raise exception 'Add at least one juice with a quantity';
  end if;
  insert into public.dispatches (seller_id, dispatch_date, notes)
  values (p_seller, coalesce(p_date, public.eat_today()), p_notes)
  returning id into v_id;
  perform public._insert_items(v_id, p_items);
  return v_id;
end $$;

-- 2) Add more juice to a seller who is still out
create or replace function public.add_dispatch_items(p_dispatch uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.dispatches where id = p_dispatch and status = 'open') then
    raise exception 'This dispatch is already closed';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
                 where (x->>'qty')::int > 0) then
    raise exception 'Enter at least one quantity';
  end if;
  perform public._insert_items(p_dispatch, p_items);
end $$;

-- 3) Reconcile: record returned bottles and the money collected, then close
--    p_returns = [{"product_id": "...", "qty_returned": 3}, ...]
create or replace function public.close_dispatch(
  p_dispatch uuid, p_returns jsonb, p_cash numeric, p_notes text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record; v_ret int; v_sold int; v_avg numeric; v_amt numeric; v_total numeric := 0;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.dispatches where id = p_dispatch and status = 'open') then
    raise exception 'This dispatch is already closed';
  end if;
  if coalesce(p_cash, 0) < 0 then raise exception 'Money collected cannot be negative'; end if;

  delete from public.dispatch_returns where dispatch_id = p_dispatch;

  for r in
    select product_id, sum(qty)::int as qty_out, sum(qty * unit_price) as value
    from public.dispatch_items where dispatch_id = p_dispatch group by product_id
  loop
    v_ret := null;
    select coalesce((x->>'qty_returned')::int, 0) into v_ret
      from jsonb_array_elements(coalesce(p_returns,'[]'::jsonb)) x
      where (x->>'product_id')::uuid = r.product_id limit 1;
    v_ret := coalesce(v_ret, 0);
    if v_ret < 0 or v_ret > r.qty_out then
      raise exception 'Returned bottles cannot be more than bottles taken';
    end if;
    v_sold := r.qty_out - v_ret;
    v_avg  := r.value / r.qty_out;
    v_amt  := round(v_sold * v_avg);
    insert into public.dispatch_returns
      (dispatch_id, product_id, qty_out, qty_returned, qty_sold, unit_price, amount)
    values (p_dispatch, r.product_id, r.qty_out, v_ret, v_sold, round(v_avg, 2), v_amt);
    v_total := v_total + v_amt;
  end loop;

  update public.dispatches
     set status = 'closed', expected_amount = v_total, cash_collected = coalesce(p_cash, 0),
         notes = coalesce(nullif(p_notes, ''), notes), closed_at = now(), closed_by = auth.uid()
   where id = p_dispatch;
end $$;

-- 4) Admin only: re-open a closed dispatch to correct it
create or replace function public.reopen_dispatch(p_dispatch uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  delete from public.dispatch_returns where dispatch_id = p_dispatch;
  update public.dispatches
     set status = 'open', expected_amount = 0, cash_collected = 0, closed_at = null, closed_by = null
   where id = p_dispatch;
end $$;

revoke all on function public._insert_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_dispatch(uuid, date, jsonb, text) from public, anon;
revoke all on function public.add_dispatch_items(uuid, jsonb) from public, anon;
revoke all on function public.close_dispatch(uuid, jsonb, numeric, text) from public, anon;
revoke all on function public.reopen_dispatch(uuid) from public, anon;
grant execute on function public.create_dispatch(uuid, date, jsonb, text) to authenticated;
grant execute on function public.add_dispatch_items(uuid, jsonb) to authenticated;
grant execute on function public.close_dispatch(uuid, jsonb, numeric, text) to authenticated;
grant execute on function public.reopen_dispatch(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- STARTER JUICES (prices are 0 — set your real prices in the app: Juices page)
-- ---------------------------------------------------------------------
insert into public.products (name, price, sort_order) values
  ('Mango-Passion', 0, 1),
  ('Avocado-Mango-Passion', 0, 2),
  ('Rozella', 0, 3),
  ('Tamarind', 0, 4),
  ('Baobab Mixed Passion', 0, 5),
  ('Dates Milk Shake', 0, 6),
  ('Orange', 0, 7)
on conflict (name) do nothing;

-- Create profiles for any logins that existed before this script ran (oldest = admin)
insert into public.profiles (id, email, full_name, role)
select u.id, u.email, split_part(u.email, '@', 1),
       case when not exists (select 1 from public.profiles where role = 'admin')
             and u.id = (select id from auth.users order by created_at limit 1)
            then 'admin' else 'staff' end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

