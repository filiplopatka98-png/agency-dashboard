import type { SupabaseClient } from '@supabase/supabase-js';

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
  // On-demand PSI sken (SP2) — generické riadky, testy si tvar overia samy.
  monitored_pages?: Record<string, unknown>[];
  scan_jobs?: Record<string, unknown>[];
  perf_runs?: Record<string, unknown>[];
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
}

export interface FakeJobRunRow {
  job: string;
  status: string;
  ok?: number | null;
  failed?: number | null;
  error?: string | null;
  finished_at: string | null;
}

type Filter = ['is' | 'eq', string, unknown];

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
    return this.filters.every(([, col, val]) => row[col] === val);
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

export function fakeSupabase(store: FakeStore): SupabaseClient {
  return {
    from(table: keyof FakeStore) {
      return new FakeQuery(store, table);
    },
  } as unknown as SupabaseClient;
}
