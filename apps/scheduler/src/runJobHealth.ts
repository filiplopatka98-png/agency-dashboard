import { JOB_SCHEDULES, WORKER_JOBS, expectedIntervalMs, isOverdue, jobOverdueDedupeKey, overdueFactor, type JobSchedule } from '@agency/core';
import type { Env } from './env';
import { serviceClient, type Db } from './supabase';

/**
 * Dead-man's switch (audit 3.3): kontroluje, či niektorý scheduled job
 * (GitHub Actions collector, alebo tento Worker samotný) nezaspal — teda či
 * od jeho posledného ZAZNAMENANÉHO behu (`job_runs.finished_at`) neubehlo
 * viac než `overdueFactor`-násobok jeho očakávaného intervalu (`JOB_SCHEDULES` z `@agency/core` —
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
 * `scheduled()` — reálne 2026-09-11, 70 min), dead-man's switch nemôže odhaliť
 * vlastnú smrť. To pokrýva scheduler-watchdog (GitHub Action každých 15 min, bez novej
 * externej služby — viď core schedulerWatchdog.ts): pozrie heartbeat
 * schedulera v job_runs a e-mail pošle priamo cez Resend. Jeho job_overdue
 * alert má rovnaký dedupe_key ako tunajší, takže po zotavení nepríde druhý.
 */
export async function runJobHealth(
  env: Env,
  deps: {
    supabase?: Db;
    now?: Date;
    /** Tick Workera, v ktorom kontrola beží (jeho vlastný štart sa do diagnózy nepočíta). */
    tick?: { job: string; startedAt: Date };
  } = {},
): Promise<void> {
  const supabase = deps.supabase ?? serviceClient(env);
  const now = deps.now ?? new Date();

  const jobs = Object.keys(JOB_SCHEDULES);

  // Najnovší beh per job JEDNÝM rpc `latest_job_runs` (DISTINCT ON v SQL,
  // migrácia 0041) — nie spoločný `order + limit` (job_runs je z >97 %
  // scheduler, audit 3.4: riedky týždenný job by vypadol z okna → falošné
  // „nikdy") a už ani 1 dotaz per job: 14 subrequestov z limitu 50 na
  // spustenie Workera (Free) bolo priveľa.
  interface LatestRun {
    finished_at: string | null;
    status: string | null;
    error: string | null;
    failed: number | null;
    ok: number | null;
  }
  const latest = new Map<string, LatestRun>();
  const { data: runs, error: runsErr } = await supabase.rpc('latest_job_runs');
  if (runsErr) {
    // Bez záznamov radšej mlčíme (fail-safe), než aby sme falošne alertovali.
    console.log(JSON.stringify({ ev: 'job_health.check_fail', error: runsErr.message }));
    return;
  }
  for (const r of (runs ?? []) as ({ job: string } & LatestRun)[]) {
    latest.set(r.job, {
      finished_at: r.finished_at ?? null,
      status: r.status ?? null,
      error: r.error ?? null,
      failed: r.failed ?? null,
      ok: r.ok ?? null,
    });
  }

  // Dead-man's switch: job „mešká" (žiadny čerstvý zaznamenaný beh).
  const overdueJobs = jobs.filter((job) =>
    isOverdue(latest.get(job)?.finished_at ?? null, JOB_SCHEDULES[job]!, now.getTime(), overdueFactor(JOB_SCHEDULES[job]!)),
  );

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
    if (WORKER_JOBS.includes(job)) return false; // crony Workera sú meta-runnery
    const run = latest.get(job);
    if (!run) return false;
    // `error` = systémové zlyhanie (celý beh hodil — chýbajúci/mŕtvy token cez
    // throw, nedostupná DB) → vždy alert.
    if (run.status === 'error') return true;
    if (run.status !== 'partial') return false;
    // `partial` = niektoré položky zlyhali. MENŠINOVÉ zlyhanie je bežná
    // prechodná flakinesss externých API — napr. Google PSI dá ~9% náhodných
    // Lighthouse 500, takže 1–3 z 16 meraní zlyhá skoro každý deň (weby sú OK,
    // len jedna stratégia hipla). Alertuj LEN keď je zlyhaní aspoň toľko čo
    // úspechov (failed >= ok) — to je „viac rozbité než funkčné": dead token
    // (ok=0), systémový výpadok, nie šum. Menšinové partial ticho ignoruj.
    const ok = run.ok ?? 0;
    const failed = run.failed ?? 0;
    return failed >= ok && failed > 0;
  });

  if (overdueJobs.length === 0 && failedJobs.length === 0) {
    console.log(JSON.stringify({ ev: 'job_health.ok', checked: jobs.length }));
    return;
  }

  const { data: orgs, error: orgErr } = await supabase.from('organizations').select('id');
  if (orgErr) throw new Error(`organizations select: ${orgErr.message}`);
  if (!orgs?.length) return;

  // Kontrola beží VNÚTRI ticku jobu `tick.job` (monitor → `scheduler`) po jeho
  // markStart, takže najnovší `<job>:start` je štart TOHTO ticku a diagnóza by
  // vždy tvrdila „ŠTARTUJE, ale nedobehne" (incident 14. 10. 2026 — v skutočnosti
  // Cloudflare ~15 min nevolal Worker). Pre vlastný job preto hľadáme štart
  // predošlého ticku: po poslednom heartbeate a pred štartom tohto ticku.
  // 1 subrequest, len keď je vlastný job overdue.
  let selfStart: string | null | undefined;
  const tick = deps.tick;
  if (tick && overdueJobs.includes(tick.job)) {
    const { data: starts, error: sErr } = await supabase
      .from('job_runs')
      .select('finished_at')
      .eq('job', `${tick.job}:start`)
      .gt('finished_at', latest.get(tick.job)?.finished_at ?? '')
      .lt('finished_at', tick.startedAt.toISOString())
      .order('finished_at', { ascending: false })
      .limit(1);
    // Pri chybe dotazu radšej žiadna diagnóza, než zavádzajúca.
    selfStart = sErr ? undefined : ((starts?.[0] as { finished_at?: string } | undefined)?.finished_at ?? null);
  }

  const overdueRows = orgs.flatMap((org: { id: string }) =>
    overdueJobs.map((job) => ({
      org_id: org.id,
      site_id: null,
      type: 'job_overdue',
      severity: 'warning' as const,
      title: `Job „${job}" mešká`,
      body: `Posledný zaznamenaný beh jobu „${job}" je starší než jeho tolerancia (${toleranceText(JOB_SCHEDULES[job]!)}) — buď zlyhal potichu skôr, než stihol zapísať job_runs, alebo GitHub Actions cron/tento Worker prestali bežať.${job === tick?.job ? selfDiagnosis(job, latest, selfStart, tick.startedAt) : startDiagnosis(job, latest)}`,
      // max 1× per job per deň; zdieľaný kľúč so scheduler-watchdog (core)
      dedupe_key: jobOverdueDedupeKey(job, now),
    })),
  );

  const failedRows = orgs.flatMap((org: { id: string }) =>
    failedJobs.map((job) => {
      const run = latest.get(job)!;
      const detail =
        run.status === 'partial'
          ? `${run.failed ?? 'niekoľko'} webov zlyhalo pri poslednom behu.`
          : (run.error?.trim() || 'Bez detailu chyby.');
      // Dedupe kľúčuje na dátum ZLYHANÉHO BEHU, nie na dnešok. TÝŽDENNÝ job
      // (aeo/seo/security/tls/infra) má ten istý partial beh najnovší celých 7
      // dní — s `day` (dnešok) by re-alertoval každý deň (nový deň = nový kľúč).
      // S dátumom behu upozorní jeden zlyhaný beh práve raz; ďalší (nový) beh
      // má nový finished_at → nový alert, keď zlyhá znova.
      const runDay = (run.finished_at ?? '').slice(0, 10) || now.toISOString().slice(0, 10);
      return {
        org_id: org.id,
        site_id: null,
        type: 'job_failed',
        severity: 'warning' as const,
        title: `${job}: zber zlyhal`,
        body: `Posledný beh jobu „${job}" skončil status='${run.status}', hoci prebehol (finished_at je čerstvý, takže dead-man's switch to nezachytí). Detail: ${detail}`,
        dedupe_key: `job_failed:${job}:${runDay}`,
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

/**
 * Pre crony Workera porovná štartovací záznam (`<job>:start`, index.ts markStart)
 * s heartbeatom na konci ticku — rozlíši „neodštartoval" od „spadol v polovici".
 * Pre collectory (bez štartovacieho záznamu) vráti ''.
 */
export function startDiagnosis(job: string, latest: Map<string, { finished_at: string | null }>): string {
  if (!WORKER_JOBS.includes(job)) return '';
  const started = latest.get(`${job}:start`)?.finished_at ?? null;
  const finished = latest.get(job)?.finished_at ?? null;
  if (!started) return ' Štartovací záznam chýba (staršia verzia Workera alebo tick vôbec neštartuje) — skontroluj Cloudflare → Workers → Observability.';
  if (finished && Date.parse(started) <= Date.parse(finished)) {
    return ` Diagnóza: tick od ${finished} ani NEODŠTARTOVAL — Cloudflare cron nevolá Worker (výpadok Cron Triggers alebo zmazaný trigger).`;
  }
  return ` Diagnóza: tick ŠTARTUJE (posledný štart ${started}), ale NEDOBEHNE do zápisu heartbeatu — zabitý v polovici (CPU/subrequest limit, Cloudflare Observability → Invocations → outcome) alebo zrušený zápis job_runs.`;
}

/**
 * Diagnóza pre job, v ktorého ticku kontrola práve beží: Worker teraz zjavne
 * beží, otázka je, čo sa dialo MEDZI posledným heartbeatom a týmto tickom.
 * `prevStart` = najnovší štart v tom okne (null = žiadny, undefined = dotaz zlyhal).
 */
export function selfDiagnosis(
  job: string,
  latest: Map<string, { finished_at: string | null }>,
  prevStart: string | null | undefined,
  tickStartedAt: Date,
): string {
  if (prevStart === undefined) return ' Diagnózu sa nepodarilo zistiť (dotaz na štartovacie záznamy zlyhal).';
  const finished = latest.get(job)?.finished_at ?? null;
  const resumed = ` Tento tick (štart ${tickStartedAt.toISOString()}) už beží.`;
  if (prevStart) {
    return ` Diagnóza: tick ŠTARTUJE (posledný štart pred týmto tickom ${prevStart}), ale NEDOBEHNE do zápisu heartbeatu — zabitý v polovici (CPU/subrequest limit, Cloudflare Observability → Invocations → outcome) alebo zrušený zápis job_runs.${resumed}`;
  }
  return ` Diagnóza: tick od ${finished} ani NEODŠTARTOVAL — Cloudflare cron nevolal Worker (výpadok Cron Triggers alebo zmazaný trigger).${resumed}`;
}

/** Tolerancia pre text alertu, napr. „20 min“ alebo „12 h“. */
function toleranceText(sched: JobSchedule): string {
  const min = (expectedIntervalMs(sched) * overdueFactor(sched)) / 60_000;
  if (min < 120) return `${min} min`;
  const h = min / 60;
  return h < 72 ? `${h} h` : `${Math.round(h / 24)} dní`;
}
