'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Shell } from '../components/Shell';
import { supabase, type Site, type Domain, type TlsCert, type UptimeDaily, type Incident } from '../lib/supabase';
import { DASH, expiryLabel, relativeTime, uptimePct } from '../lib/format';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function SiteDetail() {
  const id = useSearchParams().get('id');
  const [site, setSite] = useState<Site | null>(null);
  const [domain, setDomain] = useState<Domain | null>(null);
  const [tls, setTls] = useState<TlsCert | null>(null);
  const [daily, setDaily] = useState<UptimeDaily[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [tab, setTab] = useState<'overview' | 'uptime'>('overview');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [s, d, t, u, inc] = await Promise.all([
        supabase.from('sites').select('*').eq('id', id).maybeSingle(),
        supabase.from('domains').select('*').eq('site_id', id).maybeSingle(),
        supabase.from('tls_certs').select('*').eq('site_id', id).maybeSingle(),
        supabase.from('uptime_daily').select('*').eq('site_id', id).gte('day', since).order('day'),
        supabase.from('incidents').select('*').eq('site_id', id).order('started_at', { ascending: false }).limit(10),
      ]);
      if (!s.data) return setNotFound(true);
      setSite(s.data);
      setDomain(d.data);
      setTls(t.data);
      setDaily(u.data ?? []);
      setIncidents(inc.data ?? []);
    })();
  }, [id]);

  if (notFound) return <p className="text-muted">Web sa nenašiel.</p>;
  if (!site) return <p className="text-muted">Načítavam…</p>;

  const totalChecks = daily.reduce((n, d) => n + d.checks, 0);
  const totalUp = daily.reduce((n, d) => n + d.up, 0);
  const uptime30 = totalChecks > 0 ? Math.round((10000 * totalUp) / totalChecks) / 100 : null;

  return (
    <>
      <Link href="/" className="text-sm text-muted">
        ← Prehľad
      </Link>
      <h1 className="mt-2 text-lg font-semibold">{site.name}</h1>
      <p className="mb-4 text-sm text-muted">{site.domain}</p>

      <div className="mb-4 flex gap-1 text-sm" role="tablist">
        {(['overview', 'uptime'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="rounded-md px-3 py-1.5"
            style={tab === t ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--muted)' }}
          >
            {t === 'overview' ? 'Prehľad' : 'Uptime'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="rounded-xl border border-border bg-card p-4">
          <Row label="URL" value={site.url} />
          <Row label="Uptime (30 d)" value={uptimePct(uptime30)} />
          <Row label="Posledná kontrola" value={relativeTime(site.last_checked_at)} />
          <Row label="Doména expiruje" value={expiryLabel(domain?.expires_at ?? null)} />
          <Row label="Registrátor" value={domain?.registrar ?? 'nezistené'} />
          <Row label="TLS certifikát expiruje" value={expiryLabel(tls?.valid_to ?? null)} />
          <Row label="TLS vydavateľ" value={tls?.issuer ?? 'nezistené'} />
          <Row label="Hosting" value={site.hosting_provider ?? DASH} />
        </div>
      )}

      {tab === 'uptime' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-medium">Posledných 30 dní</h2>
            {daily.length === 0 ? (
              <p className="text-sm text-muted">Zatiaľ žiadne denné dáta (rollup beží nočne).</p>
            ) : (
              <div className="flex items-end gap-0.5" aria-hidden>
                {daily.map((d) => (
                  <span
                    key={d.day}
                    title={`${d.day}: ${d.uptime_pct}%`}
                    className="w-full rounded-sm"
                    style={{
                      height: `${Math.max(4, (Number(d.uptime_pct) / 100) * 40)}px`,
                      background:
                        Number(d.uptime_pct) >= 99.5
                          ? 'var(--dot-ok)'
                          : Number(d.uptime_pct) >= 95
                            ? 'var(--dot-warn)'
                            : 'var(--dot-down)',
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-medium">Incidenty</h2>
            {incidents.length === 0 ? (
              <p className="text-sm text-muted">Žiadne incidenty.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {incidents.map((i) => (
                  <li key={i.id} className="flex justify-between gap-4">
                    <span>{new Date(i.started_at).toLocaleString('sk-SK')}</span>
                    <span className="text-muted">
                      {i.resolved_at
                        ? `vyriešené (${i.duration_seconds ?? DASH} s)`
                        : 'prebieha'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function SitePage() {
  return (
    <Shell>
      <Suspense fallback={<p className="text-muted">Načítavam…</p>}>
        <SiteDetail />
      </Suspense>
    </Shell>
  );
}
