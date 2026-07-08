import type { CheckResult } from '@agency/shared';

/**
 * Minimálny počet výsledkov, od ktorého sa region-outage heuristika aktivuje.
 * Pod týmto počtom je >50 % ľahko dosiahnuteľné legitímne (napr. 2 z 3 reálnych
 * výpadkov) → radšej otvor incidenty ako ich potlačiť. Odchýlka od zadania,
 * ktoré prah nemá; chráni malé N (seed = 3 weby).
 */
export const REGION_MIN_SITES = 8;

export interface SiteIncidentState {
  consecutiveFailures: number;
  hasOpenIncident: boolean;
}

export interface DecideIncidentsInput {
  results: CheckResult[];
  sites: Map<string, SiteIncidentState>;
}

export interface DecideIncidentsOutput {
  /** > 50 % webov down (a N ≥ REGION_MIN_SITES) → problém je u nás, nie u klientov. */
  regionOutage: boolean;
  /** siteIds, kde treba OTVORIŤ incident. */
  openIncident: string[];
  /** siteIds, kde treba ZATVORIŤ incident. */
  closeIncident: string[];
  /** Finálny consecutive_failures pre každý web z results (scheduler ho zapíše). */
  newFailureCounts: Map<string, number>;
}

/**
 * Čistá funkcia — žiadne I/O. Rozhoduje o incidentoch z jednej dávky checkov.
 *
 * Pravidlá (presne v tomto poradí):
 *  1. Ak > polovica webov zlyhá (a N ≥ REGION_MIN_SITES) → regionOutage.
 *     Nič neotváraj ani nezatváraj, counts nechaj nezmenené. Problém je u nás.
 *  2. Fail → consecutiveFailures + 1. Ak ≥ 2 a web nemá otvorený incident → otvor.
 *  3. Úspech → consecutiveFailures = 0. Ak má otvorený incident → zatvor.
 *
 * Detekcia výpadku teda trvá 5–10 min (dva behy). To je zámer, nie chyba.
 */
export function decideIncidents(input: DecideIncidentsInput): DecideIncidentsOutput {
  const { results, sites } = input;

  const stateOf = (siteId: string): SiteIncidentState =>
    sites.get(siteId) ?? { consecutiveFailures: 0, hasOpenIncident: false };

  const failures = results.filter((r) => !r.ok);
  const regionOutage =
    results.length >= REGION_MIN_SITES && failures.length > results.length / 2;

  if (regionOutage) {
    // Counts ponechaj nezmenené — výpadok je na našej strane.
    const unchanged = new Map<string, number>();
    for (const r of results) unchanged.set(r.siteId, stateOf(r.siteId).consecutiveFailures);
    return { regionOutage: true, openIncident: [], closeIncident: [], newFailureCounts: unchanged };
  }

  const openIncident: string[] = [];
  const closeIncident: string[] = [];
  const newFailureCounts = new Map<string, number>();

  for (const r of results) {
    const state = stateOf(r.siteId);
    if (!r.ok) {
      const next = state.consecutiveFailures + 1;
      newFailureCounts.set(r.siteId, next);
      if (next >= 2 && !state.hasOpenIncident) openIncident.push(r.siteId);
    } else {
      newFailureCounts.set(r.siteId, 0);
      if (state.hasOpenIncident) closeIncident.push(r.siteId);
    }
  }

  return { regionOutage: false, openIncident, closeIncident, newFailureCounts };
}
