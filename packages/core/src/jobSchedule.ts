// Rozvrh scheduled jobov (collectory + Worker tick) — JEDINÝ zdroj pravdy pre
// to, aký interval je pre daný job „normálny". Používajú ho DVE nezávislé
// strany, ktoré by sa inak museli zhodnúť na tej istej konštante ručne:
//
//   - apps/web/app/settings/page.tsx — farbí odznak na červeno, keď posledný
//     zaznamenaný beh je starší než ~2× očakávaný interval (bez ohľadu na to,
//     aký bol jeho status — audit 3.3).
//   - apps/scheduler (Cloudflare Worker, tikne každých 5 min, nezávisle od
//     GitHub Actions) — dead-man's switch: rovnaká kontrola, len namiesto
//     farbenia UI pošle alert (viď runJobHealth.ts).
//
// Pridanie/zmena jobu → uprav LEN tu, obe strany si to zoberú odtiaľto.

export type JobSchedule =
  | { kind: 'every5' }
  | { kind: 'every15' }
  | { kind: 'hourly' }
  | { kind: 'sixhourly' }
  | { kind: 'daily'; hh: number; mm: number }
  | { kind: 'weekly'; dow: number; hh: number; mm: number }
  | { kind: 'monthly'; dom: number; hh: number; mm: number };

// Kľúč zodpovedá `job_runs.job` (aj UI kľúču v JOBS v settings/page.tsx).
export const JOB_SCHEDULES: Record<string, JobSchedule> = {
  // Worker má dva crony (Free limit 10 ms CPU / 50 subrequestov na spustenie):
  // `scheduler` = monitor (uptime, job health, alerty), `scheduler-upkeep` =
  // údržba (domény, wp-cron, e-mail health). Smrť upkeepu nahlási job health
  // v monitore, smrť monitora scheduler-watchdog.
  scheduler: { kind: 'every5' },
  'scheduler-upkeep': { kind: 'every5' },
  psi: { kind: 'daily', hh: 2, mm: 0 },
  tls: { kind: 'weekly', dow: 1, hh: 3, mm: 0 },
  security: { kind: 'weekly', dow: 1, hh: 3, mm: 0 },
  aeo: { kind: 'weekly', dow: 1, hh: 3, mm: 30 },
  gsc: { kind: 'weekly', dow: 1, hh: 3, mm: 30 },
  seo: { kind: 'weekly', dow: 1, hh: 4, mm: 0 },
  infra: { kind: 'weekly', dow: 1, hh: 4, mm: 0 },
  cve: { kind: 'daily', hh: 6, mm: 0 }, // wp-cve.yml beží DENNE (0 6 * * *) — FIX 3: bolo mylne weekly
  history: { kind: 'weekly', dow: 1, hh: 7, mm: 0 },
  digest: { kind: 'weekly', dow: 1, hh: 8, mm: 0 },
  report: { kind: 'monthly', dom: 1, hh: 7, mm: 0 },
  // asset-check.yml beží každých 6 h (0 */6 * * *). Bolo hodinovo, ale
  // hodinová CSS kontrola je pri najnižšej hodnote (CSS sa láme zriedka,
  // detekcia do 6 h stačí) najväčším zdrojom GitHub-runner šumu (24 behov/deň
  // = 24 šancí naraziť na „job not acquired by hosted runner"). 6 h kadencia
  // + 24 h tolerancia (overdueFactor 4×) planý overdue eliminuje.
  'asset-check': { kind: 'sixhourly' },
  // scheduler-watchdog.yml (*/15) — externá poistka pre `scheduler`: beží v
  // GitHub Actions, nie v Workeri, takže odhalí aj jeho smrť (viď
  // schedulerWatchdog.ts). Tu je, aby naopak scheduler strážil watchdog
  // (GitHub vypína scheduled workflows po 60 dňoch bez pushu).
  'scheduler-watchdog': { kind: 'every15' },
};

// Očakávaný interval medzi behmi v ms — vychádza len z `kind` (presný
// hh/mm/dow slúži UI na dopočítanie ĎALŠIEHO konkrétneho behu, nie na toto).
// `monthly` berie horný odhad (31 dní), nech krátky mesiac nespôsobí falošný
// poplach hneď na hranici.
export function expectedIntervalMs(sched: JobSchedule): number {
  switch (sched.kind) {
    case 'every5':
      return 5 * 60_000;
    case 'every15':
      return 15 * 60_000;
    case 'hourly':
      return 3_600_000;
    case 'sixhourly':
      return 6 * 3_600_000;
    case 'daily':
      return 24 * 3_600_000;
    case 'weekly':
      return 7 * 24 * 3_600_000;
    case 'monthly':
      return 31 * 24 * 3_600_000;
  }
}

// Job je „overdue" (dead-man's switch), keď od jeho posledného ZAZNAMENANÉHO
// behu (job_runs.finished_at) ubehlo viac než `factor`-násobok očakávaného
// intervalu — BEZ OHĽADU na to, aký bol jeho posledný `status` (audit 3.3:
// job, čo naposledy uspel pred dvoma mesiacmi, dnes svieti zeleno).
//
// (POZOR: `sixhourly` — asset-check — dostáva 4× → 24 h ticha, viď overdueFactor.)
// `finishedAt: null` (job nikdy nezaznamenal beh) sa NEPOVAŽUJE za overdue —
// to je iný, už existujúci stav („nikdy" / neutrálny odznak). Vďaka FIX 2
// (`runJob` wrapper zapisuje presne jeden riadok pri KAŽDOM behu) by sa
// `null` po prvom behu už nemal opakovať.
export function isOverdue(
  finishedAt: string | null | undefined,
  sched: JobSchedule,
  now: number = Date.now(),
  factor = 2,
): boolean {
  if (!finishedAt) return false;
  const t = Date.parse(finishedAt);
  if (Number.isNaN(t)) return false;
  return now - t > expectedIntervalMs(sched) * factor;
}

// Koľkonásobok očakávaného intervalu je „overdue". GitHub Actions cron je
// best-effort: hosted runnery sa občas NEPRIDELIA aj niekoľko hodín za sebou
// („job not acquired by hosted runner" / internal server error), takže beh
// reálne nebeží a `job_runs` sa neaktualizuje. S tesným 2× by taký GitHub
// výpadok spúšťal falošný overdue.
//   - hourly → 6× (~6 h ticha = naozaj mŕtvy)
//   - sixhourly (asset-check, 6 h kadencia) → 4× = 24 h ticha; nízka hodnota
//     jobu neospravedlňuje same-day alert pri bežnom GitHub runner výpadku.
//   - every15 (scheduler-watchdog, GitHub Actions) → 24× = 6 h ticha, rovnaká
//     tolerancia ako hourly; */15 GitHub cron vynecháva ešte častejšie.
// Denné/týždenné/mesačné majú aj pri 2× obrovskú rezervu (48 h / 2 týž. /
// 62 dní) a Cloudflare `every5` je spoľahlivý, tým 2× stačí.
export function overdueFactor(sched: JobSchedule): number {
  if (sched.kind === 'hourly') return 6;
  if (sched.kind === 'sixhourly') return 4;
  if (sched.kind === 'every15') return 24;
  return 2;
}
