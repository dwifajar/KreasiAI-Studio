-- KreasiAI Phase 10: billing orders + idempotent payment event log.
-- Safe additive migration: existing kai_* tables are not removed or changed destructively.

create table if not exists public.kai_billing_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.kai_plans(id),
  amount_idr integer not null default 0 check (amount_idr >= 0),
  credits integer not null default 0 check (credits >= 0),
  provider text not null default 'not_configured',
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled','expired','refunded')),
  provider_reference text,
  checkout_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.kai_billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  order_id uuid references public.kai_billing_orders(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create index if not exists kai_billing_orders_user_created_idx on public.kai_billing_orders(user_id, created_at desc);
create index if not exists kai_billing_orders_status_idx on public.kai_billing_orders(status, created_at desc);
create index if not exists kai_billing_orders_plan_idx on public.kai_billing_orders(plan_id, created_at desc);

alter table public.kai_billing_orders enable row level security;
alter table public.kai_billing_events enable row level security;

drop policy if exists kai_billing_orders_select_own on public.kai_billing_orders;
create policy kai_billing_orders_select_own on public.kai_billing_orders for select using (auth.uid() = user_id);

-- Billing event rows are server-only; no client policy is created intentionally.
