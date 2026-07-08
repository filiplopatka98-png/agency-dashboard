-- Fáza 1 — iba tabuľky potrebné pre uptime, incidenty, alerty, doménu a TLS.
-- Ostatné (perf_snapshots, seo_*, aeo_*, infra_*, job_queue) pridá fáza 2+.

create extension if not exists pg_cron;

-- Enumy (idempotentné — create type nepodporuje IF NOT EXISTS).
do $$ begin
  create type member_role as enum ('owner','staff','client');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_severity as enum ('critical','warning','info');
exception when duplicate_object then null; end $$;

do $$ begin
  create type site_cms as enum ('wordpress','other','static');
exception when duplicate_object then null; end $$;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  org_id  uuid not null references organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role    member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  name text not null,
  company text, ico text, dic text, email text, phone text,
  hourly_rate_eur numeric(10,2),
  monthly_fee_eur numeric(10,2),
  contract_type text,
  notion_page_id text,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  client_id uuid references clients on delete set null,
  name text not null,
  url text not null,
  domain text not null,                       -- 'lopatka.sk' (bez schémy, bez www)
  cms site_cms not null default 'wordpress',
  is_free boolean not null default false,
  is_active boolean not null default true,
  expected_string text,                       -- musí byť v HTML, inak = down
  hosting_provider text, registrar text,
  bitwarden_item_url text,                    -- ODKAZ, nie heslo
  tags text[] not null default '{}',
  notes text,
  consecutive_failures int not null default 0,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sites_org_active_idx on sites (org_id) where is_active;

create table if not exists uptime_checks (
  id bigserial primary key,
  org_id uuid not null references organizations on delete cascade,
  site_id uuid not null references sites on delete cascade,
  checked_at timestamptz not null default now(),
  ok boolean not null,
  status_code int,
  response_ms int,
  error text
);

create index if not exists uptime_checks_site_time_idx on uptime_checks (site_id, checked_at desc);

create table if not exists uptime_daily (
  org_id uuid not null references organizations on delete cascade,
  site_id uuid not null references sites on delete cascade,
  day date not null,
  checks int not null, up int not null,
  uptime_pct numeric(5,2) not null,
  avg_ms int, p95_ms int, downtime_seconds int not null default 0,
  primary key (site_id, day)
);

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  site_id uuid not null references sites on delete cascade,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  duration_seconds int,
  last_status_code int,
  cause text
);

-- DB stráži invariant: max jeden otvorený incident na web (race medzi behmi workera).
create unique index if not exists one_open_incident_per_site
  on incidents (site_id) where resolved_at is null;

create table if not exists domains (
  site_id uuid primary key references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  domain text not null,
  registrar text, nameservers text[],
  expires_at date,
  source text,                                -- 'rdap' | 'whois43' | 'unsupported'
  checked_at timestamptz, error text
);

create table if not exists tls_certs (
  site_id uuid primary key references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  issuer text, valid_from timestamptz, valid_to timestamptz,
  source text,                                -- fáza 1: len 'probe' (crt.sh odložený)
  checked_at timestamptz, error text
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  site_id uuid references sites on delete cascade,
  type text not null,
  severity alert_severity not null,
  title text not null,
  body text,
  dedupe_key text not null unique,            -- dedupe je na úrovni DB, nie appky
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  resolved_at timestamptz
);
