/**
 * Dávkovanie uptime kontrol (Workers Free: 10 ms CPU a 50 subrequestov na JEDNO
 * spustenie). Ping je najdrahší krok monitora a rastie s počtom webov — preto
 * ho delíme na viac spustení, nie na menej behov: uptime beží v UPTIME_LANES
 * cronoch (každý *∕5, posunuté o minútu) a každé spustenie pingne len svoju dávku.
 *
 *  - webov ≤ UPTIME_LANES × MAX_SITES_PER_INVOCATION → dávok = lanes, každý web
 *    každých 5 min (rovnako ako pred dávkovaním),
 *  - inak dávok = 2 × lanes a lane strieda dve dávky podľa 5-min okna → každý web
 *    raz za 10 min, na spustenie ≤ MAX_SITES_PER_INVOCATION webov (do 30 webov).
 *
 * Priradenie je deterministické (poradie podľa hostu, potom id; i % dávok): weby
 * jedného klienta (welltis.sk, welltisgroup.*) idú do rôznych dávok. Pridanie
 * webu posunie priradenie — na jeden cyklus môže web vynechať jednu kontrolu.
 */
export const UPTIME_LANES = 3;
export const MAX_SITES_PER_INVOCATION = 5;

export interface BatchPlan {
  /** Počet dávok, na ktoré sa flotila delí. */
  batches: number;
  /** Ktorú dávku kontroluje toto spustenie (môže byť prázdna). */
  slot: number;
  /** Ako často sa každý web kontroluje. */
  periodMin: 5 | 10;
  /** Webov je viac, než dávky unesú pri MAX_SITES_PER_INVOCATION — treba ďalší cron. */
  overCapacity: boolean;
}

const FIVE_MIN = 5 * 60_000;

export function planBatch(siteCount: number, lane: number, scheduledTime: number): BatchPlan {
  if (siteCount <= UPTIME_LANES * MAX_SITES_PER_INVOCATION) {
    return { batches: UPTIME_LANES, slot: lane, periodMin: 5, overCapacity: false };
  }
  // Striedanie podľa 5-min okna plánovaného času (nie skutočného — jitter cronu
  // ho neposunie): okno k → dávka lane, okno k+1 → dávka lane + lanes.
  const round = Math.floor(scheduledTime / FIVE_MIN) % 2;
  const batches = 2 * UPTIME_LANES;
  return {
    batches,
    slot: lane + UPTIME_LANES * round,
    periodMin: 10,
    overCapacity: siteCount > batches * MAX_SITES_PER_INVOCATION,
  };
}

const hostKey = (url: string): string => url.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase();

/** Weby tejto dávky (zvyšok flotily sa v tomto spustení nepinguje). */
export function selectBatch<T extends { id: string; url: string }>(sites: T[], plan: Pick<BatchPlan, 'batches' | 'slot'>): T[] {
  const ordered = [...sites].sort((a, b) => hostKey(a.url).localeCompare(hostKey(b.url)) || a.id.localeCompare(b.id));
  return ordered.filter((_, i) => i % plan.batches === plan.slot);
}
