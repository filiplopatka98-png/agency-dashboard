-- Generický infra snapshot — zvonku zistiteľné údaje o hostingu/serveri pre KAŽDÝ web
-- (nie len WordPress). Zdroj: DNS + TLS handshake + HTTP hlavičky + ip-api (bez kľúča).
create table if not exists infra_snapshots (
  site_id uuid primary key references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  ip text,
  hosting text,            -- org/ISP z ip-api (napr. "GitHub, Inc.", "WebSupport s.r.o.")
  cdn text,                -- detegované z hlavičiek (Cloudflare/Fastly/GitHub Pages/…) alebo null
  server text,             -- Server hlavička (nginx/apache/openresty/GitHub.com)
  powered_by text,         -- X-Powered-By (napr. PHP/8.2) alebo null
  tls_version text,        -- TLSv1.2 / TLSv1.3
  https_redirect boolean,  -- http:// → https:// presmerovanie
  security_txt boolean,    -- prítomnosť /.well-known/security.txt
  measured_at timestamptz,
  error text
);

alter table infra_snapshots enable row level security;
drop policy if exists "org members read" on infra_snapshots;
drop policy if exists "staff write" on infra_snapshots;
create policy "org members read" on infra_snapshots for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on infra_snapshots for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on infra_snapshots to authenticated;
grant all on infra_snapshots to service_role;
