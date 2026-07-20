import { JOB_SCHEDULES, isOverdue } from '@agency/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { serviceClient } from './supabase';

/**
 * Dead-man's switch (audit 3.3): kontroluje, či niektorý scheduled job
 * (GitHub Actions collector, alebo tento Worker samotný) nezaspal — teda či
 * od jeho posledného ZAZNAMENANÉHO behu (`job_runs.finished_at`) neubehlo
 * viac než ~2× jeho očakávaný interval (`JOB_SCHEDULES` z `@agency/core` —
 * jediný zdroj pravdy, zdieľaný s apps/web/app/settings/page.tsx, ktorý ním
 * farbí odznak v Nastaveniach).
 *
 * Beží pri KAŽDOM ticku (5 min), nezávisle od GitHub Actions — presne preto,
 * že GitHub automaticky vypína scheduled workflows po 60 dňoch bez pushu, a
 * dovtedy by si to nikto nevšimol.
 *
 * Alert ide cez existujúcu `alerts` tabuľku + `runAlerts` (rovnaký mechanizmus
 * ako region_outage v runUptime.ts) — dedupe_key obsahuje deň, takže sa
 * pošle najviac raz za job za deň, nie pri každom 5-minútovom ticku.
 *
 * POZOR — hranica tohto riešenia: tento kód beží LEN vtedy, keď Worker tikne.
 * Ak zomrie samotný Worker (Cloudflare cron trigger prestane volať
 * `scheduled()`), NIČ si to nevšimne — dead-man's switch nemôže odhaliť
 * vlastnú smrť. Skutočné pokrytie tohto prípadu by vyžadovalo externý
 * heartbeat (napr. healthchecks.io, pingovaný z Workera) — owner ho pre fázu
 * 1 explicitne odmietol (žiadna závislosť na ďalšom externom serveri), takže
 * tu ostáva len ako známa medzera, nie predstieraná istota.
 */
export async function runJobHealth(env: Env, deps: { supabase?: SupabaseClient; now?: Date } = {}): Promise<void> {
  const supabase = deps.supabase ?? serviceClient(env);
  const now = deps.now ?? new Date();

  const jobs = Object.keys(JOB_SCHEDULES);

  // Najnovší finished_at per job — samostatný dotaz na job (nie jeden veľký
  // `order + limit`), lebo `job_runs` je z >97 % scheduler (audit 3.4): jeden
  // spoločný limit by mohol vypadnúť skôr, než sa dostane k riedkemu
  // týždennému/mesačnému jobu, a ten by sa nesprávne javil ako „nikdy
  // nevidený" → falošné negatívum (žiadny alert namiesto potrebného).
  interface LatestRun {
    finished_at: string | null;
    status: string | null;
    error: string | null;
    failed: number | null;
  }
  const latest = new Map<string, LatestRun>();
  await Promise.all(
    jobs.map(async (job) => {
      const { data, error } = await supabase
        .from('job_runs')
        .select('finished_at, status, error, failed')
        .eq('job', job)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        // Best-effort per job — nedostupnosť pre jeden job nesmie zablokovať
        // kontrolu ostatných. Bez záznamu radšej mlčíme (fail-safe), než aby
        // sme falošne alertovali.
        console.log(JSON.stringify({ ev: 'job_health.check_fail', job, error: error.message }));
        return;
      }
      if (data) {
        latest.set(job, {
          finished_at: data.finished_at ?? null,
          status: data.status ?? null,
          error: data.error ?? null,
          failed: data.failed ?? null,
        });
      }
    }),
  );

  // Dead-man's switch: job „mešká" (žiadny čerstvý zaznamenaný beh).
  const overdueJobs = jobs.filter((job) => isOverdue(latest.get(job)?.finished_at ?? null, JOB_SCHEDULES[job]!, now.getTime()));

  // FIX 2: collector, čo BEŽÍ, ale posledný beh skončil status='error'/'partial'
  // (napr. expirovaný GSC/WPScan token → hodí alebo vynuluje všetko). finished_at
  // je čerstvý → NIKDY nie je overdue → bez tejto vetvy by NIKDY nealertoval
  // (zelený dashboard, nič namerané). job_overdue a job_failed sú DVA nezávislé
  // signály; oba naraz je OK (rôzne dedupe_key).
  //
  // FIX A: `scheduler` (meta-runner) je z job_failed VYLÚČENÝ. Jeho status='error'
  // vzniká pri KAŽDOM jednom transientnom zlyhaní kroku ticku (napr. runWpCronKick
  // raz hodí na krátko nedostupnom WP webe — viď runTick v index.ts), takže by
  // generoval falošné „scheduler: zber zlyhal" e-maily; navyše text o „finished_at
  // je čerstvý / dead-man's switch" pre meta-runner nedáva zmysel. Audit rozhodnutie
  // (zlyhanie zberača → e-mail) cieli len na COLLECTORY. Vlastné zdravie schedulera
  // rieši zápis statusu + (akceptovaná) medzera vlastnej smrti, nie job_failed.
  const failedJobs = jobs.filter((job) => {
    if (job === 'scheduler') return false;
    const st = latest.get(job)?.status;
    return st === 'error' || st === 'partial';
  });

  if (overdueJobs.length === 0 && failedJobs.length === 0) {
    console.log(JSON.stringify({ ev: 'job_health.ok', checked: jobs.length }));
    return;
  }

  const { data: orgs, error: orgErr } = await supabase.from('organizations').select('id');
  if (orgErr) throw new Error(`organizations select: ${orgErr.message}`);
  if (!orgs?.length) return;

  const day = now.toISOString().slice(0, 10); // dedupe: max 1× per job per deň
  const overdueRows = orgs.flatMap((org: { id: string }) =>
    overdueJobs.map((job) => ({
      org_id: org.id,
      site_id: null,
      type: 'job_overdue',
      severity: 'warning' as const,
      title: `Job „${job}" mešká`,
      body: `Posledný zaznamenaný beh jobu „${job}" je starší než 2× jeho očakávaný interval — buď zlyhal potichu skôr, než stihol zapísať job_runs, alebo GitHub Actions cron/tento Worker prestali bežať.`,
      dedupe_key: `job_overdue:${job}:${day}`,
    })),
  );

  const failedRows = orgs.flatMap((org: { id: string }) =>
    failedJobs.map((job) => {
      const run = latest.get(job)!;
      const detail =
        run.status === 'partial'
          ? `${run.failed ?? 'niekoľko'} webov zlyhalo pri poslednom behu.`
          : (run.error?.trim() || 'Bez detailu chyby.');
      return {
        org_id: org.id,
        site_id: null,
        type: 'job_failed',
        severity: 'warning' as const,
        title: `${job}: zber zlyhal`,
        body: `Posledný beh jobu „${job}" skončil status='${run.status}', hoci prebehol (finished_at je čerstvý, takže dead-man's switch to nezachytí). Detail: ${detail}`,
        dedupe_key: `job_failed:${job}:${day}`,
      };
    }),
  );

  const alertRows = [...overdueRows, ...failedRows];
  const { error: aErr } = await supabase
    .from('alerts')
    .upsert(alertRows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (aErr) throw new Error(`job_health alert: ${aErr.message}`);

  console.log(JSON.stringify({ ev: 'job_health.alert', overdue: overdueJobs, failed: failedJobs }));
}
