// Udalosti „čo sa zmenilo" — štruktúrované fakty. Diff funkcie sú čisté (bez I/O),
// aby sa dali testovať a volať z ktoréhokoľvek collectora. Jazyk sa skladá až
// v reportText.ts — tu je len `message` pre admina.

export type EventKind = 'update' | 'cve' | 'seo' | 'score';
export type Severity = 'info' | 'warning' | 'critical';

export interface UpdatePayload { target: 'plugin' | 'core'; name: string; slug: string; from: string; to: string }
export interface CvePayload { direction: 'fixed' | 'new'; cve: string | null; target: string; severity: string }
export interface SeoPayload { direction: 'fixed' | 'new'; type: string; was_count: number }
export interface ScorePayload { metric: string; from: number; to: number; direction: 'up' | 'down' }
export type EventPayload = UpdatePayload | CvePayload | SeoPayload | ScorePayload;

export interface ChangeEvent {
  kind: EventKind;
  severity: Severity;
  message: string; // admin riadok (ukladá sa do change_log.message)
  payload: EventPayload;
}

export interface PluginInfo { name: string; slug: string; version: string }
export interface VulnInfo { cve: string | null; target: string; slug: string; title: string; severity: string }
export interface SeoIssueInfo { type: string; count: number }

// prev == null → prvý ingest: zámerne nič, inak by sme nahlásili celý stav ako zmenu.
export function diffCore(prev: string | null | undefined, next: string | null | undefined): ChangeEvent[] {
  if (!prev || !next || prev === next) return [];
  return [{
    kind: 'update',
    severity: 'info',
    message: `WordPress ${prev} → ${next}`,
    payload: { target: 'core', name: 'WordPress', slug: 'wordpress', from: prev, to: next },
  }];
}

export function diffPlugins(prev: PluginInfo[] | null | undefined, next: PluginInfo[]): ChangeEvent[] {
  if (!prev) return [];
  const before = new Map(prev.map((p) => [p.slug, p]));
  const out: ChangeEvent[] = [];
  for (const p of next) {
    const old = before.get(p.slug);
    if (!old || !old.version || !p.version) continue; // nový plugin → v1 ignoruje (YAGNI)
    if (old.version === p.version) continue;
    out.push({
      kind: 'update',
      severity: 'info',
      message: `${p.name} ${old.version} → ${p.version}`,
      payload: { target: 'plugin', name: p.name, slug: p.slug, from: old.version, to: p.version },
    });
  }
  return out;
}

const vulnKey = (v: VulnInfo) => `${v.cve ?? v.title}|${v.slug}`;

export function diffVulns(prev: VulnInfo[] | null | undefined, next: VulnInfo[]): ChangeEvent[] {
  if (!prev) return [];
  const before = new Map(prev.map((v) => [vulnKey(v), v]));
  const after = new Map(next.map((v) => [vulnKey(v), v]));
  const out: ChangeEvent[] = [];
  for (const [k, v] of before) {
    if (after.has(k)) continue;
    out.push({
      kind: 'cve',
      severity: 'info',
      message: `${v.cve ?? v.title} fixed (${v.target})`,
      payload: { direction: 'fixed', cve: v.cve, target: v.target, severity: v.severity },
    });
  }
  for (const [k, v] of after) {
    if (before.has(k)) continue;
    out.push({
      kind: 'cve',
      severity: 'critical',
      message: `${v.cve ?? v.title} new (${v.target})`,
      payload: { direction: 'new', cve: v.cve, target: v.target, severity: v.severity },
    });
  }
  return out;
}

export function diffSeoIssues(prev: SeoIssueInfo[] | null | undefined, next: SeoIssueInfo[]): ChangeEvent[] {
  if (!prev) return [];
  const before = new Map(prev.map((i) => [i.type, i.count]));
  const after = new Map(next.map((i) => [i.type, i.count]));
  const out: ChangeEvent[] = [];
  for (const [type, count] of before) {
    if (after.has(type)) continue;
    out.push({
      kind: 'seo',
      severity: 'info',
      message: `${type} — fixed (${count})`,
      payload: { direction: 'fixed', type, was_count: count },
    });
  }
  for (const [type, count] of after) {
    if (before.has(type)) continue;
    out.push({
      kind: 'seo',
      severity: 'warning',
      message: `${type} — new (${count})`,
      payload: { direction: 'new', type, was_count: count },
    });
  }
  return out;
}
