-- SEO snapshoty — výsledok technického crawlu (broken links, title/meta/H1,
-- canonical, alt, mixed content, sitemap/robots). Fáza 3, tabuľka teraz.
create table if not exists seo_snapshots (
  site_id uuid primary key references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  pages_crawled int,
  sitemap_ok boolean,
  robots_ok boolean,
  canonical_ok boolean,
  issues jsonb,                    -- [{type,severity,sample,count,urls}]
  measured_at timestamptz,
  error text
);

alter table seo_snapshots enable row level security;
drop policy if exists "org members read" on seo_snapshots;
drop policy if exists "staff write" on seo_snapshots;
create policy "org members read" on seo_snapshots for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on seo_snapshots for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on seo_snapshots to authenticated;
grant all on seo_snapshots to service_role;
