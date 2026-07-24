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
  | { kind: 'hourly' }
  | { kind: 'daily'; hh: number; mm: number }
  | { kind: 'weekly'; dow: number; hh: number; mm: number }
  | { kind: 'monthly'; dom: number; hh: number; mm: number };

// Kľúč zodpovedá `job_runs.job` (aj UI kľúču v JOBS v settings/page.tsx).
export const JOB_SCHEDULES: Record<string, JobSchedule> = {
  scheduler: { kind: 'every5' },
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
  'asset-check': { kind: 'hourly' },
};

// Očakávaný interval medzi behmi v ms — vychádza len z `kind` (presný
// hh/mm/dow slúži UI na dopočítanie ĎALŠIEHO konkrétneho behu, nie na toto).
// `monthly` berie horný odhad (31 dní), nech krátky mesiac nespôsobí falošný
// poplach hneď na hranici.
export function expectedIntervalMs(sched: JobSchedule): number {
  switch (sched.kind) {
    case 'every5':
      return 5 * 60_000;
    case 'hourly':
      return 3_600_000;
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
// best-effort: hodinový `0 * * * *` slot je najvyťaženejší a behy bežne mešká
// 10–30 min alebo NIEKTORÉ VYNECHÁ (reálne pozorované medzery ~2,5 h medzi
// hodinovými behmi). S 2× by jeden vynechaný GitHub beh spustil falošný
// overdue → hodinové joby dostávajú 6× (~6 h bez behu = naozaj mŕtvy). Denné/
// týždenné/mesačné majú aj pri 2× obrovskú rezervu (48 h / 2 týž. / 62 dní) a
// Cloudflare `every5` je spoľahlivý, tým 2× stačí.
export function overdueFactor(sched: JobSchedule): number {
  return sched.kind === 'hourly' ? 6 : 2;
}
