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
export { isNightInBratislava, NIGHT_DEFERRED_TYPES, hourBucketUtc } from './schedule';

export {
  pickDomainStrategy,
  parseRdapExpiry,
  parseWhoisSk,
  fetchRdapDomain,
  type DomainInfo,
} from './domain';

export {
  scoreAeo,
  AI_BOTS,
  type AeoResult,
  type AeoCheck,
  type BotDecision as AeoBotDecision,
} from './aeo';

export { analyzePage, buildSeoIssues, type PageAnalysis, type SeoIssue } from './seo';

export { parsePsi, fetchPsi, type PerfSnap } from './psi';

export { scoreSecurityHeaders, fetchSafeBrowsing, type SecurityHeaders } from './security';

export { gscPropertyCandidates, parseGscResponse, type GscRow, type GscQuery, type GscSummary } from './gsc';

export { severityFromScore, severityRank, maxSeverity, type CveSeverity } from './cve';

export { computeFreshness, freshnessFor, MAX_AGE_HOURS, type MetricKey, type Freshness } from './freshness';

export { renderDigest, type DigestData, type DigestSite } from './digest';

export { renderMonthlyReport, type ReportData, type ReportSite } from './report';

export {
  diffCore,
  diffPlugins,
  diffVulns,
  diffSeoIssues,
  type EventKind,
  type Severity,
  type ChangeEvent,
  type EventPayload,
  type UpdatePayload,
  type CvePayload,
  type SeoPayload,
  type ScorePayload,
  type PluginInfo,
  type VulnInfo,
  type SeoIssueInfo,
} from './events';

export {
  isClientVisible,
  renderClient,
  renderIncident,
  renderVigilance,
  buildClientLines,
  fmtNum,
  fmtPct,
  SEO_CLIENT_LABELS,
  type Vigilance,
  type TimedLine,
} from './reportText';

export { renderClientReport, type ClientReportData, type ClientReportSite } from './clientReport';
