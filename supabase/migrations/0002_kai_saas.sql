-- KreasiAI Studio isolated schema inside the existing BANI MAD KAMARI project.
-- All KreasiAI tables are prefixed with kai_ so existing application tables remain untouched.

create extension if not exists pgcrypto;

create table if not exists public.kai_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  plan text not null default 'free' check (plan in ('free','creator','pro','business','admin')),
  credits integer not null default 30 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kai_plans (
  id text primary key,
  name text not null,
  monthly_credits integer not null default 0 check (monthly_credits >= 0),
  price_idr integer not null default 0 check (price_idr >= 0),
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.kai_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kai_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.kai_projects(id) on delete cascade,
  kind text not null check (kind in ('video','audio','image','subtitle','other')),
  storage_path text not null,
  mime_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.kai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.kai_projects(id) on delete set null,
  type text not null check (type in ('video','tts','image','render')),
  provider text,
  prompt text not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','cancelled')),
  provider_operation jsonb,
  output_url text,
  output_asset_id uuid references public.kai_assets(id) on delete set null,
  error_message text,
  credits_reserved integer not null default 0 check (credits_reserved >= 0),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.kai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.kai_generation_jobs(id) on delete set null,
  amount integer not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.kai_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.kai_plans(id),
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  status text not null default 'active',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kai_generation_jobs_user_created_idx on public.kai_generation_jobs(user_id, created_at desc);
create index if not exists kai_generation_jobs_status_idx on public.kai_generation_jobs(status, created_at);
create index if not exists kai_assets_user_created_idx on public.kai_assets(user_id, created_at desc);

alter table public.kai_profiles enable row level security;
alter table public.kai_projects enable row level security;
alter table public.kai_assets enable row level security;
alter table public.kai_generation_jobs enable row level security;
alter table public.kai_credit_ledger enable row level security;
alter table public.kai_subscriptions enable row level security;
alter table public.kai_plans enable row level security;

drop policy if exists kai_profiles_select_own on public.kai_profiles;
create policy kai_profiles_select_own on public.kai_profiles for select using (auth.uid() = id);
drop policy if exists kai_projects_all_own on public.kai_projects;
create policy kai_projects_all_own on public.kai_projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists kai_assets_select_own on public.kai_assets;
create policy kai_assets_select_own on public.kai_assets for select using (auth.uid() = user_id);
drop policy if exists kai_jobs_select_own on public.kai_generation_jobs;
create policy kai_jobs_select_own on public.kai_generation_jobs for select using (auth.uid() = user_id);
drop policy if exists kai_ledger_select_own on public.kai_credit_ledger;
create policy kai_ledger_select_own on public.kai_credit_ledger for select using (auth.uid() = user_id);
drop policy if exists kai_subscriptions_select_own on public.kai_subscriptions;
create policy kai_subscriptions_select_own on public.kai_subscriptions for select using (auth.uid() = user_id);
drop policy if exists kai_plans_select_active on public.kai_plans;
create policy kai_plans_select_active on public.kai_plans for select using (active = true);

create or replace function public.kai_handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.kai_profiles(id, display_name)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists kai_on_auth_user_created on auth.users;
create trigger kai_on_auth_user_created after insert on auth.users
for each row execute procedure public.kai_handle_new_user();

create or replace function public.kai_reserve_credits(p_user_id uuid, p_cost integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_remaining integer;
begin
  if p_cost <= 0 then raise exception 'Invalid credit cost'; end if;
  update public.kai_profiles
  set credits = credits - p_cost, updated_at = now()
  where id = p_user_id and credits >= p_cost
  returning credits into v_remaining;
  if v_remaining is null then raise exception 'INSUFFICIENT_CREDITS'; end if;
  insert into public.kai_credit_ledger(user_id, amount, reason)
  values(p_user_id, -p_cost, p_reason);
  return v_remaining;
end;
$$;

create or replace function public.kai_refund_credits(p_user_id uuid, p_amount integer, p_reason text, p_job_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_remaining integer;
begin
  if p_amount <= 0 then raise exception 'Invalid refund amount'; end if;
  update public.kai_profiles
  set credits = credits + p_amount, updated_at = now()
  where id = p_user_id
  returning credits into v_remaining;
  if v_remaining is null then raise exception 'PROFILE_NOT_FOUND'; end if;
  insert into public.kai_credit_ledger(user_id, job_id, amount, reason)
  values(p_user_id, p_job_id, p_amount, p_reason);
  return v_remaining;
end;
$$;


insert into public.kai_profiles(id, display_name)
select id, coalesce(raw_user_meta_data->>'full_name', split_part(coalesce(email,''), '@', 1))
from auth.users
on conflict (id) do nothing;

insert into public.kai_plans(id,name,monthly_credits,price_idr,features) values
('free','Free',30,0,'{"max_resolution":"1080p","watermark":true,"max_video_seconds":8}'::jsonb),
('creator','Creator',300,99000,'{"max_resolution":"4K","watermark":false,"max_video_seconds":8}'::jsonb),
('pro','Pro',1200,249000,'{"max_resolution":"4K","watermark":false,"max_video_seconds":8,"priority":true}'::jsonb),
('business','Business',5000,799000,'{"max_resolution":"4K","watermark":false,"priority":true,"team":true}'::jsonb)
on conflict(id) do update set name=excluded.name, monthly_credits=excluded.monthly_credits, price_idr=excluded.price_idr, features=excluded.features;

insert into storage.buckets(id,name,public) values('kai-media','kai-media',false) on conflict(id) do nothing;

-- Storage policies: authenticated users can read/write only their own folder: <auth.uid()>/...
drop policy if exists kai_storage_select on storage.objects;
create policy kai_storage_select on storage.objects for select to authenticated using (bucket_id='kai-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists kai_storage_insert on storage.objects;
create policy kai_storage_insert on storage.objects for insert to authenticated with check (bucket_id='kai-media' and (storage.foldername(name))[1] = auth.uid()::text);
