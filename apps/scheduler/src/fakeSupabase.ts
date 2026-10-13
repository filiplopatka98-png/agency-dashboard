import type { Db } from './supabase';

/**
 * Minimalistický in-memory fake Supabase klienta pre JEDNOTKOVÉ testy
 * (`runAlerts`, `runJobHealth`) — integračné testy proti reálnemu lokálnemu
 * Supabase sú `*.integration.test.ts` a `pnpm test` ich vynecháva. Tento fake
 * implementuje presne tie query-reťazce, ktoré tie dva moduly používajú, so
 * skutočnou sémantikou (filtre, order, update, upsert s dedupe), aby testy ako
 * „poison-pill neblokuje zvyšok" alebo „dedupe cez dedupe_key" reálne niečo
 * overili, nie len mock volaní.
 */
export interface FakeStore {
  alerts: FakeAlertRow[];
  job_runs: FakeJobRunRow[];
  organizations: { id: string }[];
  change_log?: Record<string, unknown>[];
  // On-demand PSI sken (SP2) — generické riadky, testy si tvar overia samy.
  monitored_pages?: Record<string, unknown>[];
  scan_jobs?: Record<string, unknown>[];
  perf_runs?: Record<string, unknown>[];
  wp_email_health?: Record<string, unknown>[];
  sites?: Record<string, unknown>[];
  // Uptime (runUptime): incidenty + raw checky, sémantika persist_uptime (0005/0046).
  incidents?: { id: string; site_id: string; org_id: string; resolved_at: string | null }[];
  uptime_checks?: Record<string, unknown>[];
  // Záznam volaní (`from:<tabuľka>` / `rpc:<funkcia>`) — každé = 1 subrequest
  // na Workeri; testy tak strážia rozpočet 50 subrequestov na spustenie.
  calls?: string[];
}

export interface FakeAlertRow {
  id: string;
  org_id: string;
  site_id: string | null;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  dedupe_key: string;
  sent_at: string | null;
  created_at: string;
  archived_at?: string | null;
}

export interface FakeJobRunRow {
  job: string;
  status: string;
  ok?: number | null;
  failed?: number | null;
  error?: string | null;
  finished_at: string | null;
}

type Filter = ['is' | 'eq' | 'gte', string, unknown];

class FakeQuery {
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private wantSingle = false;
  private selectHead = false;
  private updatePatch: Record<string, unknown> | null = null;
  private upsertRows: Record<string, unknown>[] | null = null;
  private upsertConflict: string | null = null;
  private upsertIgnore = false;
  private insertRows: Record<string, unknown>[] | null = null;
  private selectCalled = false;

  constructor(
    private store: FakeStore,
    private table: keyof FakeStore,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    this.selectCalled = true;
    if (opts?.head) this.selectHead = true;
    return this;
  }
  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push(['is', col, val]);
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push(['eq', col, val]);
    return this;
  }
  gte(col: string, val: unknown): this {
    this.filters.push(['gte', col, val]);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  update(patch: Record<string, unknown>): this {
    this.updatePatch = patch;
    return this;
  }
  upsert(rows: Record<string, unknown>[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.upsertRows = rows;
    this.upsertConflict = opts?.onConflict ?? null;
    this.upsertIgnore = opts?.ignoreDuplicates ?? false;
    return this;
  }
  maybeSingle(): this {
    this.wantSingle = true;
    return this;
  }
  single(): this {
    this.wantSingle = true;
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown): unknown {
    try {
      return Promise.resolve(this.exec()).then(resolve, reject);
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  }

  private matches(row: Record<string, unknown>): boolean {
    return this.filters.every(([op, col, val]) => {
      if (op === 'gte') return String(row[col]) >= String(val);
      // SQL `IS NULL`: chýbajúci stĺpec v riadku fake store = NULL.
      if (op === 'is' && val === null) return row[col] == null;
      return row[col] === val;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private exec(): { data: any; error: null; count?: number } {
    const rows = this.store[this.table] as unknown as Record<string, unknown>[];

    if (this.insertRows) {
      // Vlož riadky do store (skutočný append) — vygeneruj `id`, ak chýba, nech
      // `insert().select('id').single()` vráti reálne id ako PostgREST.
      const inserted = this.insertRows.map((r) => ({ id: r.id ?? crypto.randomUUID(), ...r }));
      for (const r of inserted) rows.push(r);
      if (!this.selectCalled) return { data: null, error: null };
      return { data: this.wantSingle ? (inserted[0] ?? null) : inserted, error: null };
    }

    if (this.upsertRows) {
      for (const r of this.upsertRows) {
        const key = this.upsertConflict;
        const dup = key && rows.some((existing) => existing[key] === r[key]);
        if (dup && this.upsertIgnore) continue;
        rows.push({ ...r });
      }
      return { data: null, error: null };
    }

    if (this.updatePatch) {
      for (const r of rows) {
        if (this.matches(r)) Object.assign(r, this.updatePatch);
      }
      return { data: null, error: null };
    }

    let result = rows.filter((r) => this.matches(r));
    if (this.orderCol) {
      const col = this.orderCol;
      result = [...result].sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        return this.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this.selectHead) return { data: null, error: null, count: result.length };
    if (this.limitN != null) result = result.slice(0, this.limitN);
    if (this.wantSingle) return { data: result[0] ?? null, error: null };
    return { data: result, error: null };
  }
}

// Sémantika SQL `latest_job_runs()` (migrácia 0041): posledný beh každého jobu.
function latestJobRuns(rows: FakeJobRunRow[]): FakeJobRunRow[] {
  const latest = new Map<string, FakeJobRunRow>();
  for (const r of rows) {
    const cur = latest.get(r.job);
    if (!cur || String(r.finished_at ?? '') > String(cur.finished_at ?? '')) latest.set(r.job, r);
  }
  return [...latest.values()];
}

// Sémantika SQL `email_health_inputs(_since)` (0041): posledný reading každého
// aktívneho webu s providerom + medián sent_24h > 0 od `_since` (bez → 0).
function emailHealthInputs(store: FakeStore, since: string): Record<string, unknown>[] {
  const readings = store.wp_email_health ?? [];
  const out: Record<string, unknown>[] = [];
  for (const s of store.sites ?? []) {
    if (!s.is_active) continue;
    const mine = readings.filter((r) => r.site_id === s.id);
    const latest = [...mine].sort((a, b) => String(b.measured_at).localeCompare(String(a.measured_at)))[0];
    if (!latest || latest.provider == null) continue;
    const vals = mine
      .filter((r) => String(r.measured_at) >= since && Number(r.sent_24h ?? 0) > 0)
      .map((r) => Number(r.sent_24h))
      .sort((a, b) => a - b);
    const m = Math.floor(vals.length / 2);
    const median = !vals.length ? 0 : vals.length % 2 ? vals[m]! : (vals[m - 1]! + vals[m]!) / 2;
    out.push({ ...latest, site_id: s.id, org_id: s.org_id, domain: s.domain, typical_daily_14d: median });
  }
  return out;
}

// Sémantika SQL `get_sites_to_check()` (0014 + 0046).
function sitesToCheck(store: FakeStore): Record<string, unknown>[] {
  return (store.sites ?? [])
    .filter((s) => s.is_active !== false && !s.maintenance)
    .map((s) => ({
      id: s.id,
      org_id: s.org_id,
      url: s.url,
      expected_string: s.expected_string ?? null,
      consecutive_failures: s.consecutive_failures ?? 0,
      has_open_incident: (store.incidents ?? []).some((i) => i.site_id === s.id && i.resolved_at == null),
      last_probe_ok: s.last_probe_ok ?? null,
      last_probe_at: s.last_probe_at ?? null,
    }));
}

type CheckArg = { site_id: string; org_id: string; ok: boolean };

function noteProbes(store: FakeStore, checks: CheckArg[], at: string): void {
  for (const c of checks) {
    const site = (store.sites ?? []).find((s) => s.id === c.site_id);
    if (site) Object.assign(site, { last_probe_ok: c.ok, last_probe_at: at });
  }
}

// Sémantika SQL `persist_uptime(...)` (0005 + 0046): checky, counts, posledný ping,
// otvorenie/zatvorenie incidentov + site_down/site_up alert (dedupe).
function persistUptime(store: FakeStore, args: Record<string, unknown>, at: string): void {
  const checks = (args._checks ?? []) as CheckArg[];
  (store.uptime_checks ??= []).push(...checks);
  for (const c of (args._counts ?? []) as { site_id: string; failures: number }[]) {
    const site = (store.sites ?? []).find((s) => s.id === c.site_id);
    if (site) Object.assign(site, { consecutive_failures: c.failures, last_checked_at: at });
  }
  noteProbes(store, checks, at);
  const incidents = (store.incidents ??= []);
  for (const siteId of (args._open ?? []) as string[]) {
    if (incidents.some((i) => i.site_id === siteId && i.resolved_at == null)) continue;
    const c = checks.find((x) => x.site_id === siteId);
    if (!c) continue;
    const inc = { id: crypto.randomUUID(), site_id: siteId, org_id: c.org_id, resolved_at: null };
    incidents.push(inc);
    store.alerts.push({ id: crypto.randomUUID(), org_id: c.org_id, site_id: siteId, type: 'site_down', severity: 'critical', title: 'down', body: null, dedupe_key: `site:${siteId}:down:${inc.id}`, sent_at: null, created_at: at });
  }
  for (const siteId of (args._close ?? []) as string[]) {
    for (const inc of incidents.filter((i) => i.site_id === siteId && i.resolved_at == null)) {
      inc.resolved_at = at;
      store.alerts.push({ id: crypto.randomUUID(), org_id: inc.org_id, site_id: siteId, type: 'site_up', severity: 'info', title: 'up', body: null, dedupe_key: `site:${siteId}:up:${inc.id}`, sent_at: null, created_at: at });
    }
  }
}

export function fakeSupabase(store: FakeStore, now: () => Date = () => new Date()): Db {
  const calls = (store.calls ??= []);
  return {
    from(table: keyof FakeStore) {
      calls.push(`from:${String(table)}`);
      return new FakeQuery(store, table);
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      calls.push(`rpc:${fn}`);
      if (fn === 'latest_job_runs') return { data: latestJobRuns(store.job_runs), error: null };
      if (fn === 'email_health_inputs') return { data: emailHealthInputs(store, String(args._since)), error: null };
      if (fn === 'get_sites_to_check') return { data: sitesToCheck(store), error: null };
      if (fn === 'persist_uptime') return (persistUptime(store, args, now().toISOString()), { data: null, error: null });
      if (fn === 'note_probes') return (noteProbes(store, (args._checks ?? []) as CheckArg[], now().toISOString()), { data: null, error: null });
      return { data: null, error: { message: `fakeSupabase: neznáme rpc ${fn}` } };
    },
  } as unknown as Db;
}
