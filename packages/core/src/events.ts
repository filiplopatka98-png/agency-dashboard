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

// Diff funkcie čítajú `prev` priamo z DB (jsonb bez shape-constraintu) — nedôveryhodná
// hranica. Garbage (nie-pole, alebo pole s nepoužiteľnými prvkami) sa NESMIE prejaviť
// ako throw; správa sa ako "žiadny použiteľný baseline" → []. Prázdne pole `[]` je ale
// legitímny baseline ("minule sme skenovali a nič sme nenašli") a musí sa diffovať
// normálne — nezamieňať "nie je pole" s "je prázdne pole".
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isPluginInfo(v: unknown): v is PluginInfo {
  return isRecord(v) && typeof v.slug === 'string';
}

function isVulnInfo(v: unknown): v is VulnInfo {
  return isRecord(v) && typeof v.slug === 'string';
}

function isSeoIssueInfo(v: unknown): v is SeoIssueInfo {
  return isRecord(v) && typeof v.type === 'string';
}

// prev == null → prvý ingest: zámerne nič, inak by sme nahlásili celý stav ako zmenu.
export function diffCore(prev: unknown, next: unknown): ChangeEvent[] {
  if (typeof prev !== 'string' || typeof next !== 'string' || !prev || !next || prev === next) return [];
  return [{
    kind: 'update',
    severity: 'info',
    message: `WordPress ${prev} → ${next}`,
    payload: { target: 'core', name: 'WordPress', slug: 'wordpress', from: prev, to: next },
  }];
}

export function diffPlugins(prev: unknown, next: unknown): ChangeEvent[] {
  if (!Array.isArray(prev) || !Array.isArray(next)) return [];
  const before = new Map<string, PluginInfo>();
  for (const raw of prev) {
    if (isPluginInfo(raw)) before.set(raw.slug, raw);
  }
  const out: ChangeEvent[] = [];
  for (const raw of next) {
    if (!isPluginInfo(raw)) continue;
    const old = before.get(raw.slug);
    if (!old || !old.version || !raw.version) continue; // nový plugin → v1 ignoruje (YAGNI)
    if (old.version === raw.version) continue;
    out.push({
      kind: 'update',
      severity: 'info',
      message: `${raw.name} ${old.version} → ${raw.version}`,
      payload: { target: 'plugin', name: raw.name, slug: raw.slug, from: old.version, to: raw.version },
    });
  }
  return out;
}

const vulnKey = (v: VulnInfo) => `${v.cve ?? v.title}|${v.slug}`;

export function diffVulns(prev: unknown, next: unknown): ChangeEvent[] {
  if (!Array.isArray(prev) || !Array.isArray(next)) return [];
  const before = new Map<string, VulnInfo>();
  for (const raw of prev) {
    if (isVulnInfo(raw)) before.set(vulnKey(raw), raw);
  }
  const after = new Map<string, VulnInfo>();
  for (const raw of next) {
    if (isVulnInfo(raw)) after.set(vulnKey(raw), raw);
  }
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

export function diffSeoIssues(prev: unknown, next: unknown): ChangeEvent[] {
  if (!Array.isArray(prev) || !Array.isArray(next)) return [];
  const before = new Map<string, number>();
  for (const raw of prev) {
    if (isSeoIssueInfo(raw)) before.set(raw.type, raw.count);
  }
  const after = new Map<string, number>();
  for (const raw of next) {
    if (isSeoIssueInfo(raw)) after.set(raw.type, raw.count);
  }
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
