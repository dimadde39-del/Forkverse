create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  telegram_user_id bigint unique,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.simulations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  request_id text not null unique,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  input_payload jsonb not null,
  result_payload jsonb,
  error_payload jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint simulations_terminal_state_check check (
    (status = 'pending' and result_payload is null and error_payload is null and completed_at is null)
    or (status = 'completed' and result_payload is not null and error_payload is null and completed_at is not null)
    or (status = 'failed' and result_payload is null and error_payload is not null and completed_at is not null)
  )
);

create index if not exists simulations_profile_id_created_at_idx
  on public.simulations (profile_id, created_at desc);

create table if not exists public.telegram_context (
  telegram_user_id bigint primary key,
  profile_id uuid references public.profiles (id) on delete set null,
  context_text text,
  base_params jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint telegram_context_payload_check check (
    context_text is not null or base_params is not null
  )
);

create index if not exists telegram_context_profile_id_idx
  on public.telegram_context (profile_id);

create table if not exists public.scenario_state (
  telegram_user_id bigint primary key,
  profile_id uuid references public.profiles (id) on delete set null,
  latest_request_id text,
  source_text text,
  params jsonb not null default '{}'::jsonb,
  simulation_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists scenario_state_profile_id_idx
  on public.scenario_state (profile_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists simulations_set_updated_at on public.simulations;
create trigger simulations_set_updated_at
before update on public.simulations
for each row
execute function public.set_updated_at();

drop trigger if exists telegram_context_set_updated_at on public.telegram_context;
create trigger telegram_context_set_updated_at
before update on public.telegram_context
for each row
execute function public.set_updated_at();

drop trigger if exists scenario_state_set_updated_at on public.scenario_state;
create trigger scenario_state_set_updated_at
before update on public.scenario_state
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

alter table public.simulations enable row level security;
alter table public.simulations force row level security;

alter table public.telegram_context enable row level security;
alter table public.telegram_context force row level security;

alter table public.scenario_state enable row level security;
alter table public.scenario_state force row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "simulations_select_own" on public.simulations;
create policy "simulations_select_own"
on public.simulations
for select
to authenticated
using (profile_id = auth.uid());

drop policy if exists "telegram_context_select_own" on public.telegram_context;
create policy "telegram_context_select_own"
on public.telegram_context
for select
to authenticated
using (profile_id = auth.uid());

drop policy if exists "telegram_context_insert_own" on public.telegram_context;
create policy "telegram_context_insert_own"
on public.telegram_context
for insert
to authenticated
with check (profile_id = auth.uid());

drop policy if exists "telegram_context_update_own" on public.telegram_context;
create policy "telegram_context_update_own"
on public.telegram_context
for update
to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

drop policy if exists "scenario_state_select_own" on public.scenario_state;
create policy "scenario_state_select_own"
on public.scenario_state
for select
to authenticated
using (profile_id = auth.uid());

drop policy if exists "scenario_state_insert_own" on public.scenario_state;
create policy "scenario_state_insert_own"
on public.scenario_state
for insert
to authenticated
with check (profile_id = auth.uid());

drop policy if exists "scenario_state_update_own" on public.scenario_state;
create policy "scenario_state_update_own"
on public.scenario_state
for update
to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());
