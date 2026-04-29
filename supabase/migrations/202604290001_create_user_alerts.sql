create table if not exists public.user_alerts (
  telegram_id bigint primary key,
  last_runway_months double precision,
  created_at timestamptz not null default timezone('utc', now()),
  last_pinged_at timestamptz
);

alter table public.user_alerts enable row level security;
alter table public.user_alerts force row level security;

create index if not exists user_alerts_due_drift_idx
  on public.user_alerts (created_at)
  where last_pinged_at is null;
