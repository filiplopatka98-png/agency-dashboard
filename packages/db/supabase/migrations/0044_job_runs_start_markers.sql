-- Štartovacie záznamy schedulera (`scheduler:start`, `scheduler-upkeep:start`,
-- status 'started') — Worker ich píše hneď na začiatku ticku, aby sa pri
-- „scheduler mešká" dalo rozlíšiť „neodštartoval" od „spadol v polovici"
-- (alert z 2026-09-05 nemal stopu). 2 crony × 288 ticku/deň = 576 riadkov/deň,
-- preto rovnaká 6 h retencia ako ok heartbeaty (0041). Rovnaké meno cron jobu →
-- prepíše 0041, idempotentné.
select cron.schedule('job_runs_retention_scheduler', '*/15 * * * *', $job$
  delete from job_runs
  where finished_at < now() - interval '6 hours'
    and (
      (job in ('scheduler', 'scheduler-upkeep', 'scheduler-watchdog') and status = 'ok')
      or job in ('scheduler:start', 'scheduler-upkeep:start')
    );
$job$);
