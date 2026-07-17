-- Audit 2026-07-17, item 2: `job_runs` je z 97,6 % scheduler šum (2 297
-- riadkov, 2 242 scheduler — píše riadok každých 5 minút, 0013_job_runs.sql).
-- To reálne sťažilo audit: dotaz na "posledný beh per job" vrátil takmer
-- výhradne scheduler riadky (aj `apps/web/app/settings/page.tsx` číta len
-- `order(finished_at desc).limit(300)`), takže 8 zdravých collectorov
-- vyzeralo mŕtvo, kým sa nedotazovalo per-job (presne to, prečo
-- `runJobHealth.ts` už robí samostatný dotaz per job — pozri jeho komentár).
--
-- Voľba: KRATŠIA retencia pre 'scheduler' 'ok' tiky, NIE zriedenie frekvencie
-- zápisu. Dôvod: dead-man's switch (`isOverdue` v @agency/core/jobSchedule,
-- volaný z `runJobHealth.ts` aj zo Settings UI) kontroluje freshness `job_runs`
-- pre KAŽDÝ job vrátane 'scheduler' s `expectedIntervalMs('every5') = 5 min`
-- (factor 2 → 10 min okno). Keby scheduler prestal zapisovať úspešné tiky
-- (napr. len pri zlyhaní/zmene stavu), po pár desiatkach minút ticha by
-- switch nesprávne nahlásil "scheduler zaspal" — presne opačný efekt, než aký
-- audit vyžaduje ("nezlom schopnosť zistiť, že scheduler žije"). Preto
-- `recordSchedulerRun()` v `apps/scheduler/src/index.ts` ostáva bez zmeny
-- (zapisuje ok/error pri KAŽDOM ticku) a namiesto toho sa skracuje len
-- retencia úspešných riadkov.
--
-- Výsledok: max. cca 6h × 12 tikov/h = ~72 'scheduler'/'ok' riadkov naraz
-- (namiesto 30 dní × 288 = 8640), pričom chyby ('status' != 'ok') zostávajú
-- v bežnej 30-dňovej retencii (0013_job_runs.sql — potrebné na debugging) a
-- ostatné joby sa vôbec nedotýkajú. Bežné meno cron jobu → re-run migrácie
-- aktualizuje, nezduplikuje (rovnaký vzor ako 0013).
select cron.schedule('job_runs_retention_scheduler', '*/15 * * * *', $job$
  delete from job_runs where job = 'scheduler' and status = 'ok' and finished_at < now() - interval '6 hours';
$job$);
