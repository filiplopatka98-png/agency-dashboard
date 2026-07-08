export type { UptimeProvider, Notifier } from './types';

export {
  decideIncidents,
  REGION_MIN_SITES,
  type SiteIncidentState,
  type DecideIncidentsInput,
  type DecideIncidentsOutput,
} from './decideIncidents';

export { LocalPinger, type LocalPingerDeps } from './localPinger';

export { ResendNotifier, renderAlertHtml, type ResendConfig } from './resendNotifier';
export { isNightInBratislava, NIGHT_DEFERRED_TYPES } from './schedule';

// pickDomainStrategy + parseWhoisSk (krok 7) sa doplnia neskôr.
