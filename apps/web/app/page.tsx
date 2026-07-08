'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from './components/Shell';
import { supabase, type Site } from './lib/supabase';
import { relativeTime, uptimePct } from './lib/format';

interface Card {
  site: Site;
  uptime30: number | null;
}

function dotColor(site: Site): string {
  if (!site.last_checked_at) return 'var(--dot-unknown)';
  if (site.consecutive_failures >= 2) return 'var(--dot-down)';
  if (site.consecutive_failures >= 1) return 'var(--dot-warn)';
  return 'var(--dot-ok)';
}

export default function OverviewPage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [sitesRes, dailyRes] = await Promise.all([
        supabase.from('sites').select('*').eq('is_active', true).order('name'),
        supabase.from('uptime_daily').select('site_id, checks, up').gte('day', since),
      ]);
      if (sitesRes.error) return setError(sitesRes.error.message);
      if (dailyRes.error) return setError(dailyRes.error.message);

      const agg = new Map<string, { checks: number; up: number }>();
      for (const d of dailyRes.data ?? []) {
        const a = agg.get(d.site_id) ?? { checks: 0, up: 0 };
        a.checks += d.checks;
        a.up += d.up;
        agg.set(d.site_id, a);
      }
      setCards(
        (sitesRes.data ?? []).map((site) => {
          const a = agg.get(site.id);
          return {
            site,
            uptime30: a && a.checks > 0 ? Math.round((10000 * a.up) / a.checks) / 100 : null,
          };
        }),
      );
    })();
  }, []);

  return (
    <Shell>
      <h1 className="mb-4 text-lg font-semibold">Prehľad</h1>
      {error && (
        <p className="text-sm" style={{ color: 'var(--dot-down)' }} role="alert">
          {error}
        </p>
      )}
      {!cards && !error && <p className="text-muted">Načítavam…</p>}
      {cards && cards.length === 0 && <p className="text-muted">Zatiaľ žiadne weby.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards?.map(({ site, uptime30 }) => (
          <Link
            key={site.id}
            href={`/sites?id=${site.id}`}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
          >
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: dotColor(site) }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{site.name}</span>
              <span className="block truncate text-xs text-muted">{site.domain}</span>
            </span>
            <span className="text-right text-sm">
              <span className="block tabular-nums">{uptimePct(uptime30)}</span>
              <span className="block text-xs text-muted">{relativeTime(site.last_checked_at)}</span>
            </span>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
