-- Záznamy behu úloh (scheduler tick + collectory) — pre prehľad „kedy/či bežalo".
-- Operačná metadáta (nie klientske dáta) → čitateľné každému prihlásenému.
create table if not exists job_runs (
  id bigint generated always as identity primary key,
  job text not null,                 -- 'scheduler' | 'psi' | 'gsc' | 'security' | 'aeo' | 'seo' | 'tls'
  status text not null,              -- 'ok' | 'partial' | 'error'
  ok int,                            -- počet úspešných položiek
  failed int,                        -- počet zlyhaných položiek
  error text,                        -- text chyby pri status='error'
  finished_at timestamptz not null default now()
);

create index if not exists job_runs_job_finished_idx on job_runs (job, finished_at desc);

alter table job_runs enable row level security;
drop policy if exists "authenticated read" on job_runs;
create policy "authenticated read" on job_runs for select to authenticated using (true);

grant select on job_runs to authenticated;
grant all on job_runs to service_role;

-- Retencia: raz denne zmaž záznamy staršie než 30 dní (scheduler beží každých 5 min).
-- Pomenovaný job → re-run migrácie aktualizuje, nezduplikuje.
select cron.schedule('job_runs_retention', '20 2 * * *', $job$
  delete from job_runs where finished_at < now() - interval '30 days';
$job$);
