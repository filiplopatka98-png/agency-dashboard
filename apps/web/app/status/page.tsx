'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { loadDashboard, type SiteVM } from '../lib/data';
import { segColor } from '../lib/design';

const card = {
  background: 'var(--surface-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-sm)',
} as const;
const mono = { fontFamily: "'Geist Mono', monospace", fontVariantNumeric: 'tabular-nums' } as const;

export default function StatusPage() {
  const [sites, setSites] = useState<SiteVM[] | null>(null);

  useEffect(() => {
    let a = true;
    loadDashboard().then(({ sites }) => a && setSites(sites));
    return () => {
      a = false;
    };
  }, []);

  if (!sites)
    return (
      <Shell>
        <div style={{ padding: 32, color: 'var(--text-secondary)' }}>Načítavam…</div>
      </Shell>
    );

  const monitored = sites.filter((s) => s.statusKey !== 'unknown');
  const down = sites.filter((s) => s.statusKey === 'down').length;
  const degraded = sites.filter((s) => s.statusKey === 'degraded').length;
  // „nezistené ≠ ok" (brief §3.3): keď ešte nič nebolo skontrolované, NEUKAZUJ
  // zelené „Všetky systémy fungujú" — je to neznámy stav, nie zdravý.
  const noneMeasured = monitored.length === 0;
  const overallOk = down === 0 && degraded === 0 && !noneMeasured;
  // Slovenský plurál 1 / 2–4 / 5+.
  const sk = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n < 5 ? few : many);
  const bannerBg = down > 0 ? 'var(--critical-bg)' : degraded > 0 ? 'var(--warning-bg)' : noneMeasured ? 'var(--unknown-bg)' : 'var(--ok-bg)';
  const bannerColor = down > 0 ? 'var(--critical-color)' : degraded > 0 ? 'var(--warning-color)' : noneMeasured ? 'var(--unknown-color)' : 'var(--ok-color)';
  const bannerText =
    down > 0
      ? `${down} ${sk(down, 'web nedostupný', 'weby nedostupné', 'webov nedostupných')}`
      : degraded > 0
        ? `${degraded} ${sk(degraded, 'web degradovaný', 'weby degradované', 'webov degradovaných')}`
        : noneMeasured
          ? 'Stav sa zatiaľ zisťuje'
          : 'Všetky systémy fungujú';

  const upVals = monitored.map((s) => s.uptime30d).filter((v): v is number => v !== null);
  const avgUptime = upVals.length ? Math.round((upVals.reduce((a, b) => a + b, 0) / upVals.length) * 10) / 10 : null;
  const incidents30 = sites.reduce((n, s) => n + s.incidentCount30, 0);
  const p95s = monitored.map((s) => s.p95Series.at(-1)).filter((v): v is number => v != null);
  const avgResp = p95s.length ? Math.round(p95s.reduce((a, b) => a + b, 0) / p95s.length) : null;

  const bars = Array.from({ length: 90 }, (_, j) => {
    const vals = monitored
      .map((s) => s.uptimeCalendar[j]?.value)
      .filter((v): v is number => v != null && v !== undefined);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { color: segColor(avg), day: 90 - j };
  });

  const incidentFeed = sites.flatMap((s) => s.incidents.map((i) => ({ ...i, site: s.name }))).slice(0, 6);

  return (
    <Shell>
      <div style={{ minHeight: '100vh', padding: '48px 24px 64px', background: 'var(--bg-base)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, justifyContent: 'center', marginBottom: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 'var(--radius)', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 15 }}>◈</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: 0 }}>Lopatka — status</h1>
          </div>
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 32 }}>Verejná status stránka · {sites.length} webov</div>

          <div style={{ background: bannerBg, border: '1px solid var(--border-primary)', borderRadius: 'var(--radius)', padding: 26, marginBottom: 20, textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: bannerColor }} />
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{bannerText}</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{noneMeasured ? 'Zatiaľ bez meraní' : overallOk ? 'Priebežne sledované' : 'Sledujeme situáciu'}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
            <div style={{ ...card, padding: 18, textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, ...mono, color: 'var(--ok-color)' }}>{avgUptime === null ? '—' : `${avgUptime}%`}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Uptime 30d</div>
            </div>
            <div style={{ ...card, padding: 18, textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, ...mono, color: 'var(--text-primary)' }}>{incidents30}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Incidenty (30d)</div>
            </div>
            <div style={{ ...card, padding: 18, textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, ...mono, color: 'var(--text-primary)' }}>{avgResp === null ? '—' : avgResp}<span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>ms</span></div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Odozva</div>
            </div>
          </div>

          <div style={{ ...card, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Uptime za 90 dní</div>
              <div style={{ fontSize: 12.5, color: 'var(--ok-color)', fontWeight: 600 }}>{avgUptime === null ? '—' : `${avgUptime}% dostupnosť`}</div>
            </div>
            <div style={{ display: 'flex', gap: 2, height: 34 }}>
              {bars.map((b, i) => (
                <div key={i} style={{ flex: 1, background: b.color, borderRadius: 2 }} title={`pred ${b.day} dňami`} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              <span>pred 90 dňami</span>
              <span>dnes</span>
            </div>
          </div>

          <div style={{ ...card, padding: 20 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>História incidentov</div>
            {incidentFeed.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Za posledné obdobie žiadne incidenty.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {incidentFeed.map((inc, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingBottom: 10, borderBottom: i < incidentFeed.length - 1 ? '1px solid var(--border-primary)' : 'none' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: inc.color, marginTop: 5, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{inc.site} · {inc.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{inc.startTime} · trvanie {inc.duration}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ textAlign: 'center', marginTop: 28, fontSize: 12, color: 'var(--text-tertiary)' }}>Monitoring zabezpečuje <strong style={{ color: 'var(--text-secondary)' }}>Monitorix</strong></div>
        </div>
      </div>
    </Shell>
  );
}
