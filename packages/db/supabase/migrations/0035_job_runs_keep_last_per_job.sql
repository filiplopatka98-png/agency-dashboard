-- Audit Wave 1, FIX 4: dead-man's switch pre mesačný `report` nikdy nevystrelí.
--
-- PREČO: `isOverdue` (@agency/core/jobSchedule, volaný z runJobHealth.ts aj zo
-- Settings UI) potrebuje POSLEDNÝ `job_runs.finished_at` daného jobu, aby vedel
-- povedať „mešká". Prah pre `report` (kind='monthly') je 31 d × factor 2 = ~62
-- dní. Lenže pôvodná 30-dňová retencia (0013_job_runs.sql) zmaže posledný
-- `report` riadok skôr (po 30 dňoch) — a `isOverdue(null, …)` vracia false
-- (žiadny beh = „nikdy", neutrálny stav). Výsledok: mŕtvy mesačný report je
-- NEZISTITEĽNÝ. Týždenné joby majú miernejšiu verziu tej istej diery (okno
-- 14–30 d, potom sa riadok zmaže a job sa tvári ako „nikdy nebežal").
--
-- OPRAVA: retencia už NEZMAŽE najnovší riadok per `job`. Tým `finished_at`
-- ostáva vždy dopočítateľný a overdue stále vystrelí, bez ohľadu na to, ako
-- dlho je job mŕtvy. Staršie duplicitné riadky (história) sa naďalej čistia po
-- 30 dňoch.
--
-- Scheduler má vlastnú kratšiu retenciu (0031_job_runs_scheduler_retention.sql,
-- `job_runs_retention_scheduler`, každých 15 min zmaže 'scheduler'/'ok' > 6 h) —
-- tú sa NEDOTÝKAME: scheduler zapisuje každých 5 min, takže najnovší riadok tam
-- vždy existuje a switch má čo čítať. Táto migrácia mení iba všeobecnú 30-dňovú
-- retenciu (`job_runs_retention` z 0013).
--
-- Rovnaké meno cron jobu ('job_runs_retention') → cron.schedule ho AKTUALIZUJE,
-- nezduplikuje (idempotentné, rovnaký vzor ako 0013/0031). Migráciu možno spustiť
-- opakovane bez vedľajších efektov.
select cron.schedule('job_runs_retention', '20 2 * * *', $job$
  delete from job_runs
  where finished_at < now() - interval '30 days'
    and id not in (
      -- najnovší riadok per job si vždy ponecháme (overdue musí ostať dopočítateľný)
      select distinct on (job) id
      from job_runs
      order by job, finished_at desc, id desc
    );
$job$);
