// Obalí collector main-loop tak, aby KAŽDÉ spustenie zapísalo presne jeden
// riadok do job_runs — úspech aj zlyhanie (audit 3.2: predtým sa
// `recordJobRun()` volalo až na konci main(), za všetkými `throw new
// Error(...)` secret-guardmi aj prvým Supabase fetchom, takže collector, čo
// zomrel skoro (chýbajúci secret, nedostupná DB), nezapísal NIČ — panel v
// Nastaveniach potom nevie rozlíšiť „nikdy nenakonfigurované" od „bolo to OK,
// teraz je to rozbité").
//
// `url`/`key` (Supabase) si runJob číta SÁM z env, nezávisle od toho, čo stihla
// (alebo nestihla) prečítať `fn` — takže sa zapíše aj beh, čo zlyhal na
// job-špecifickom secrete (napr. PSI_API_KEY) skôr, než sa vôbec dostal k
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.
//
// `fn` vráti `{ ok, failed }` (alebo nič → 0/0) pri úspechu. Chyba sa zapíše
// s textom do `error` a znova sa VYHODÍ (re-throw) — proces musí skončiť
// nenulovým exit kódom, inak GitHub Actions run zostane zelený aj pri zlyhaní.
import { recordJobRun } from './jobRun.mjs';

export async function runJob(job, fn) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const result = (await fn()) ?? {};
    const ok = result.ok ?? 0;
    const failed = result.failed ?? 0;
    await recordJobRun(url, key, job, ok, failed);
    return result;
  } catch (e) {
    await recordJobRun(url, key, job, 0, 0, String(e?.message ?? e));
    throw e;
  }
}
