export type { UptimeProvider, Notifier } from './types';

export {
  decideIncidents,
  REGION_MIN_SITES,
  type SiteIncidentState,
  type DecideIncidentsInput,
  type DecideIncidentsOutput,
} from './decideIncidents';

export { LocalPinger, type LocalPingerDeps } from './localPinger';

// ResendNotifier (krok 5), pickDomainStrategy + parseWhoisSk (krok 7) sa doplnia neskôr.
