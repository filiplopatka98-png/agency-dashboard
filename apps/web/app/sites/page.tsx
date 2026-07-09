'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shell } from '../components/Shell';
import { loadDashboard, type SiteVM } from '../lib/data';
import {
  buildSparkline,
  sparklineFromValues,
  cwvMeta,
  scoreColor,
  gaugeOffset,
  BOT_DEFS,
  botMeta,
  nextBot,
  type BotDecision,
} from '../lib/design';

const card = {
  background: 'var(--surface-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-sm)',
} as const;
const mono = { fontFamily: "'Geist Mono', monospace", fontVariantNumeric: 'tabular-nums' } as const;
const label = {
  fontSize: 11.5,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontWeight: 600,
} as const;

/** Viditeľné označenie ukážkových (mock) dát — pre časti, ktoré ešte nebežia naživo. */
function MockBanner({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 'var(--radius)', padding: '11px 16px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
      <span style={{ fontSize: 15 }}>🧪</span>
      <span><strong style={{ color: 'var(--text-primary)' }}>Ukážkové dáta.</strong> {text}</span>
    </div>
  );
}

/* ─────────────────────────── Sites list ─────────────────────────── */
function SitesList() {
  const router = useRouter();
  const [sites, setSites] = useState<SiteVM[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let a = true;
    loadDashboard().then(({ sites }) => a && setSites(sites));
    return () => {
      a = false;
    };
  }, []);

  const filtered = (sites ?? []).filter((s) =>
    (s.name + ' ' + s.domain).toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px 64px', background: 'var(--bg-base)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.025em', marginBottom: 6 }}>Weby</h1>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{sites ? `${sites.length} webov celkom` : '…'}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', fontSize: 14 }}>⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Hľadať web alebo doménu…"
                style={{ padding: '9px 14px 9px 32px', background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 13.5, width: 240, boxShadow: 'var(--shadow-sm)', outline: 'none' }}
              />
            </div>
          </div>
        </div>

        <div style={{ ...card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface-secondary)' }}>
                {['Web', 'Klient', 'Stav', 'Uptime 30d'].map((h, i) => (
                  <th key={h} style={{ padding: '13px 18px', textAlign: i === 2 ? 'center' : i === 3 ? 'right' : 'left', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((site) => (
                <tr key={site.id} className="mx-row" onClick={() => router.push(`/sites?id=${site.id}`)} style={{ borderTop: '1px solid var(--border-primary)', cursor: 'pointer', transition: 'background 0.15s' }}>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div className={site.pulseClass} style={{ width: 9, height: 9, borderRadius: '50%', background: site.dotColor, flexShrink: 0 }} />
                      <div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{site.name}</div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{site.domain}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '14px 18px', color: 'var(--text-secondary)' }}>{site.clientName}</td>
                  <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                    <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 600, color: site.dotColor, background: site.tintBg, padding: '3px 10px', borderRadius: 7 }}>{site.statusShort}</span>
                  </td>
                  <td style={{ padding: '14px 18px', textAlign: 'right', ...mono, fontWeight: 700, color: 'var(--text-primary)' }}>{site.uptimeDisplay}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sites && filtered.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14 }}>
              {search ? `Žiadny web nezodpovedá „${search}"` : 'Zatiaľ žiadne weby'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Site detail ─────────────────────────── */
const TABS = [
  { id: 'overview', label: 'Prehľad' },
  { id: 'uptime', label: 'Uptime' },
  { id: 'performance', label: 'Výkon' },
  { id: 'seo', label: 'SEO' },
  { id: 'aeo', label: 'AEO' },
  { id: 'infra', label: 'Infra' },
  { id: 'client', label: 'Klient' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function SiteDetail({ id }: { id: string }) {
  const [sites, setSites] = useState<SiteVM[] | null>(null);
  const [tab, setTab] = useState<TabId>('overview');

  useEffect(() => {
    let a = true;
    loadDashboard().then(({ sites }) => a && setSites(sites));
    return () => {
      a = false;
    };
  }, []);

  const site = useMemo(() => sites?.find((s) => s.id === id), [sites, id]);
  if (!sites) return <div style={{ padding: 32, color: 'var(--text-secondary)' }}>Načítavam…</div>;
  if (!site) return <div style={{ padding: 32, color: 'var(--text-secondary)' }}>Web sa nenašiel.</div>;

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px 64px', background: 'var(--bg-base)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <Link href="/" style={{ display: 'inline-block', padding: '8px 14px', background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', borderRadius: 9, fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 24, fontWeight: 500, boxShadow: 'var(--shadow-sm)', textDecoration: 'none' }}>← Späť na prehľad</Link>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 10 }}>
            <div className={site.pulseClass} style={{ width: 15, height: 15, borderRadius: '50%', background: site.dotColor, boxShadow: `0 0 0 5px ${site.tintBg}` }} />
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.025em' }}>{site.name}</h1>
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: 13.5, color: 'var(--text-secondary)' }}>
            <a href={`https://${site.domain}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>{site.domain} ↗</a>
            <div>Klient: <strong style={{ color: 'var(--text-primary)' }}>{site.clientName}</strong></div>
            <div>{site.statusLabel} · {site.lastCheckTime}</div>
          </div>
        </div>

        {/* Quick stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 28 }}>
          <QuickStat title="Uptime 30d" value={site.uptimeDisplay} color="var(--accent-primary)" />
          <QuickStat title="Perf skóre" value={site.perf?.desktop?.performanceScore ?? '—'} />
          <QuickStat title="TLS expiry" value={site.tlsDaysLeft === null ? 'nezistené' : `${site.tlsDaysLeft}d`} color={site.tlsExpiryColor} />
          <QuickStat title="Otvorené issues" value={site.openIssues} />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, overflowX: 'auto', background: 'var(--surface-secondary)', padding: 5, borderRadius: 12, width: 'fit-content', maxWidth: '100%' }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 16px', fontSize: 13.5, fontWeight: 600, color: tab === t.id ? 'var(--accent-primary)' : 'var(--text-secondary)', background: tab === t.id ? 'var(--surface-primary)' : 'transparent', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.18s' }}>{t.label}</button>
          ))}
        </div>

        {tab === 'overview' && <TabOverview site={site} />}
        {tab === 'uptime' && <TabUptime site={site} />}
        {tab === 'performance' && <TabPerformance site={site} />}
        {tab === 'seo' && <TabSeo site={site} />}
        {tab === 'aeo' && <TabAeo site={site} />}
        {tab === 'infra' && <TabInfra site={site} />}
        {tab === 'client' && <TabClient site={site} />}
      </div>
    </div>
  );
}

function QuickStat({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <div style={{ ...card, padding: 18 }}>
      <div style={{ ...label, marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 30, fontWeight: 800, ...mono, letterSpacing: '-0.03em', color: color ?? 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function ExpiryRow({ name, days, color }: { name: string; days: number | null; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', background: 'var(--surface-secondary)', borderRadius: 10 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{name}</span>
      <span style={{ fontWeight: 700, ...mono, color }}>{days === null ? 'nezistené' : `${days}d`}</span>
    </div>
  );
}

function TabOverview({ site }: { site: SiteVM }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
      <div style={{ ...card, padding: 18 }}>
        <div style={{ ...label, marginBottom: 14, fontSize: 13 }}>Aktuálny stav</div>
        <div style={{ padding: '14px 16px', background: site.tintBg, borderRadius: 10, borderLeft: `4px solid ${site.dotColor}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{site.statusLabel}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Posledná zmena: {site.lastStatusChange}</div>
        </div>
      </div>
      <div style={{ ...card, padding: 18 }}>
        <div style={{ ...label, marginBottom: 14, fontSize: 13 }}>Uptime</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {([['24h', site.uptime24h], ['7d', site.uptime7d]] as const).map(([k, v]) => (
            <div key={k} style={{ textAlign: 'center', padding: '14px 8px', background: 'var(--surface-secondary)', borderRadius: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 800, ...mono, letterSpacing: '-0.03em', color: 'var(--accent-primary)' }}>{v === null ? '—' : `${v}%`}</div>
              <div style={{ color: 'var(--text-tertiary)', marginTop: 5, fontSize: 11.5, fontWeight: 600 }}>{k}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ ...card, padding: 18 }}>
        <div style={{ ...label, marginBottom: 14, fontSize: 13 }}>Expirácie</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
          <ExpiryRow name="Doména" days={site.domainDaysLeft} color={site.domainExpiryColor} />
          <ExpiryRow name="TLS certifikát" days={site.tlsDaysLeft} color={site.tlsExpiryColor} />
        </div>
      </div>
    </div>
  );
}

function TabUptime({ site }: { site: SiteVM }) {
  const spark = sparklineFromValues(site.p95Series) ?? buildSparkline(site.seed);
  const figures: [string, string][] = [
    ['24 hodín', site.uptime24h === null ? '—' : `${site.uptime24h}%`],
    ['7 dní', site.uptime7d === null ? '—' : `${site.uptime7d}%`],
    ['30 dní', site.uptimeDisplay],
    ['90 dní', site.uptime90d],
  ];
  const strip: [string, string, string, string][] = [
    ['🟢', 'var(--ok-bg)', site.daysSinceIncident === null ? '—' : `${site.daysSinceIncident} dní`, 'bez výpadku'],
    ['⏱', 'var(--surface-secondary)', site.mttrMin === null ? '—' : `${site.mttrMin} min`, 'priem. MTTR'],
    ['📉', 'var(--surface-secondary)', String(site.incidentCount30), 'incident (30d)'],
    [site.slaOk ? '🎯' : '⚠️', site.slaOk ? 'var(--ok-bg)' : 'var(--warning-bg)', site.slaOk ? 'SLA ✓' : 'SLA ✗', 'cieľ 99,5 %'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary strip (reálne) */}
      <div style={{ ...card, padding: 4, display: 'flex', flexWrap: 'wrap' }}>
        {strip.map(([icon, iconBg, val, sub], i) => (
          <div key={i} style={{ display: 'contents' }}>
            {i > 0 && <div style={{ width: 1, background: 'var(--border-primary)', margin: '10px 0' }} />}
            <div style={{ flex: 1, minWidth: 130, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{icon}</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, ...mono, color: i === 3 && site.slaOk ? 'var(--ok-color)' : 'var(--text-primary)', lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3 }}>{sub}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
        {figures.map(([k, v], i) => (
          <div key={k} style={{ ...card, padding: 16 }}>
            <div style={{ ...label, fontSize: 11, marginBottom: 8 }}>{k}</div>
            <div style={{ fontSize: 24, fontWeight: 800, ...mono, letterSpacing: '-0.03em', color: i === 0 ? 'var(--ok-color)' : 'var(--text-primary)' }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ ...card, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Odozva (p95, 30 dní)</h3>
          <div><span style={{ fontSize: 20, fontWeight: 800, ...mono, color: 'var(--accent-primary)' }}>{spark.p95}</span><span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 4 }}>ms</span></div>
        </div>
        <svg viewBox="0 0 560 70" preserveAspectRatio="none" style={{ width: '100%', height: 70, display: 'block' }}>
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={spark.area} fill="url(#sparkGrad)" />
          <polyline points={spark.points} fill="none" stroke="var(--accent-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>

      <div style={{ ...card, padding: 18 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: 'var(--text-primary)' }}>Uptime história (90 dní)</h3>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {site.uptimeCalendar.map((d, i) => (
            <div key={i} style={{ width: 15, height: 15, background: d.color, borderRadius: 3 }} title={`${d.date}: ${d.value === null ? 'nezistené' : d.value + '%'}`} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 14, fontSize: 12, color: 'var(--text-secondary)' }}>
          {[['OK', 'var(--ok-color)'], ['Pozor', 'var(--warning-color)'], ['Výpadok', 'var(--critical-color)'], ['Nezistené', 'var(--unknown-bg)']].map(([t, c]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 11, height: 11, background: c, borderRadius: 3 }} />{t}</div>
          ))}
        </div>
      </div>

      <div style={{ ...card, padding: 18 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text-primary)' }}>Incidenty</h3>
        {site.incidents.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {site.incidents.map((inc, i) => (
              <div key={i} style={{ background: 'var(--surface-secondary)', borderLeft: `4px solid ${inc.color}`, borderRadius: 'var(--radius)', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{inc.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{inc.startTime} · {inc.duration}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-tertiary)', ...mono }}>{inc.statusCode}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 14 }}>Žiadne incidenty — web je stabilný</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Gauge({ score, off, color, size = 76, sw = 7, r = 33, circ = 207.3 }: { score: number; off: number; color: string; size?: number; sw?: number; r?: number; circ?: number }) {
  const c = size / 2;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, transform: 'rotate(-90deg)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-secondary)" strokeWidth={sw} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size > 100 ? 34 : size > 70 ? 22 : 18, fontWeight: 800, ...mono, color }}>{score}</div>
    </div>
  );
}

function CwvCard({ name, thr, kind, value }: { name: string; thr: string; kind: 'lcp' | 'inp' | 'cls'; value: number | null }) {
  const m = cwvMeta(kind, value);
  return (
    <div style={{ background: m.bg, borderRadius: 12, padding: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{name}</span>
        <span style={{ fontSize: 11, color: m.color, fontWeight: 600 }}>{m.state}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, ...mono, color: m.color, marginBottom: 6 }}>{m.val}</div>
      <div style={{ height: 5, background: 'rgba(128,128,128,0.15)', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: m.w, background: m.color, borderRadius: 3 }} /></div>
      <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 6 }}>{thr}</div>
    </div>
  );
}

function TabPerformance({ site }: { site: SiteVM }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const snap = site.perf ? site.perf[device] : null;
  const hasField = snap && (snap.fieldLcpMs !== null || snap.fieldInpMs !== null || snap.fieldCls !== null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-secondary)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {(['desktop', 'mobile'] as const).map((d) => (
          <button key={d} onClick={() => setDevice(d)} style={{ padding: '7px 15px', background: device === d ? 'var(--surface-primary)' : 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, color: device === d ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 600, boxShadow: device === d ? 'var(--shadow-sm)' : 'none' }}>{d === 'desktop' ? 'Desktop' : 'Mobil'}</button>
        ))}
      </div>

      {!snap ? (
        <div style={{ ...card, padding: 24 }}>
          <div style={{ background: 'var(--surface-secondary)', borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>⚡</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              {site.perf ? `Meranie pre ${device === 'desktop' ? 'desktop' : 'mobil'} sa nepodarilo` : 'Performance sa pre tento web ešte nemeralo'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 420, margin: '0 auto', lineHeight: 1.5 }}>Meria PageSpeed Insights (Lighthouse), týždenne. Skóre sa neodhaduje — zobrazí sa po reálnom meraní.</div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ ...card, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Lab · Lighthouse / PSI</h3>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{device === 'desktop' ? 'Desktop' : 'Mobil'}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 }}>
              {([['Performance', snap.performanceScore], ['Accessibility', snap.accessibility], ['Best Practices', snap.bestPractices], ['SEO', snap.seo]] as const).map(([name, score]) => (
                <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 8 }}>
                  <Gauge score={score} off={gaugeOffset(score, 207.3)} color={scoreColor(score)} />
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{name}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, padding: 20 }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: 'var(--text-primary)' }}>Core Web Vitals <span style={{ fontWeight: 500, color: 'var(--text-tertiary)', fontSize: 12 }}>· Lab</span></h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
              <CwvCard name="LCP" thr="práh ≤ 2,5s" kind="lcp" value={snap.lcpMs} />
              <CwvCard name="INP" thr="práh ≤ 200ms" kind="inp" value={snap.inpMs} />
              <CwvCard name="CLS" thr="práh ≤ 0,1" kind="cls" value={snap.cls} />
            </div>
          </div>

          <div style={{ ...card, padding: 20 }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: 'var(--text-primary)' }}>Field dáta <span style={{ fontWeight: 500, color: 'var(--text-tertiary)', fontSize: 12 }}>· CrUX (reálni návštevníci)</span></h3>
            {hasField ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginTop: 12 }}>
                <CwvCard name="LCP" thr="reálni návštevníci" kind="lcp" value={snap.fieldLcpMs} />
                <CwvCard name="INP" thr="reálni návštevníci" kind="inp" value={snap.fieldInpMs} />
                <CwvCard name="CLS" thr="reálni návštevníci" kind="cls" value={snap.fieldCls} />
              </div>
            ) : (
              <div style={{ background: 'var(--surface-secondary)', borderRadius: 12, padding: 22, textAlign: 'center', marginTop: 12 }}>
                <div style={{ fontSize: 20, marginBottom: 8 }}>📉</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Nedostatok field dát</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', maxWidth: 380, margin: '0 auto', lineHeight: 1.5 }}>Web nemá dosť návštevnosti pre CrUX dataset. Nie je to chyba — Google zverejní field metriky až pri dostatočnom počte reálnych návštev.</div>
              </div>
            )}
          </div>

          <div style={{ ...card, padding: 20 }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: 'var(--text-primary)' }}>Popis stránky</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, fontSize: 13 }}>
              {([['Veľkosť', snap.pageWeightKb === null ? '—' : `${snap.pageWeightKb} KB`], ['Requesty', snap.requests === null ? '—' : String(snap.requests)], ['TTFB', snap.ttfbMs === null ? '—' : `${snap.ttfbMs} ms`], ['TBT', '—']] as const).map(([k, v]) => (
                <div key={k} style={{ background: 'var(--surface-secondary)', borderRadius: 10, padding: 14 }}>
                  <div style={{ ...label, fontSize: 11.5, marginBottom: 6 }}>{k}</div>
                  <div style={{ fontWeight: 700, ...mono, fontSize: 16 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function seoSev(sev: string) {
  if (sev === 'critical') return { color: 'var(--critical-color)', bg: 'var(--critical-bg)', label: 'Critical' };
  if (sev === 'warning') return { color: 'var(--warning-color)', bg: 'var(--warning-bg)', label: 'Warning' };
  if (sev === 'ok') return { color: 'var(--ok-color)', bg: 'var(--ok-bg)', label: 'OK' };
  return { color: 'var(--text-tertiary)', bg: 'var(--surface-secondary)', label: 'Info' };
}

function TabSeo({ site }: { site: SiteVM }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const seo = site.seo;
  const okPill = (ok: boolean, text: string) => (
    <span key={text} style={{ fontSize: 12, color: ok ? 'var(--ok-color)' : 'var(--text-tertiary)', background: ok ? 'var(--ok-bg)' : 'var(--surface-secondary)', padding: '4px 10px', borderRadius: 7, fontWeight: 600 }}>{ok ? '✓' : '—'} {text}</span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {seo ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
            {([['Prehľadané stránky', String(seo.pagesCrawled), 'var(--text-primary)', false], ['Otvorené issues', String(seo.issues.length), seo.issues.length ? 'var(--warning-color)' : 'var(--ok-color)', seo.issues.length > 0]] as const).map(([t, v, c, bar]) => (
              <div key={t} style={{ ...card, padding: 18, position: 'relative', overflow: 'hidden' }}>
                {bar && <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: 'var(--warning-color)' }} />}
                <div style={{ ...label, marginBottom: 10 }}>{t}</div>
                <div style={{ fontSize: 26, fontWeight: 800, ...mono, letterSpacing: '-0.02em', color: c }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--border-primary)' }}>
              <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Technické issues</h3>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>z crawlu {seo.pagesCrawled} stránok · podklad pre klienta</span>
            </div>
            {seo.issues.length === 0 ? (
              <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13.5 }}>Žiadne technické SEO issues 🎉</div>
            ) : (
              <div>
                {seo.issues.map((iss, i) => {
                  const m = seoSev(iss.severity);
                  return (
                    <div key={i} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                      <div onClick={() => setExpanded(expanded === i ? null : i)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: 'pointer' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-primary)' }}>{iss.type}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', ...mono, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{iss.sample}</div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, padding: '3px 9px', borderRadius: 7, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>{m.label}</span>
                        <span style={{ fontSize: 15, fontWeight: 800, ...mono, color: 'var(--text-primary)', minWidth: 34, textAlign: 'right' }}>{iss.count}</span>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 12, width: 12 }}>{iss.urls.length ? (expanded === i ? '▾' : '▸') : ''}</span>
                      </div>
                      {expanded === i && iss.urls.length > 0 && (
                        <div style={{ padding: '0 18px 14px 40px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {iss.urls.map((u, j) => (
                            <div key={j} style={{ fontSize: 12, ...mono, color: 'var(--text-secondary)', padding: '7px 12px', background: 'var(--surface-secondary)', borderRadius: 7 }}>{u}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '14px 18px', background: 'var(--surface-secondary)' }}>
              {okPill(seo.sitemapOk, 'Sitemap')}
              {okPill(seo.robotsOk, 'robots.txt')}
              {okPill(seo.canonicalOk, 'Canonical')}
            </div>
          </div>
        </>
      ) : (
        <div style={{ ...card, padding: 24 }}>
          <div style={{ background: 'var(--surface-secondary)', borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>🔎</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>SEO crawl sa pre tento web ešte nevykonal</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 420, margin: '0 auto', lineHeight: 1.5 }}>Crawler zbehne týždenne a rešpektuje robots.txt. Výsledky sa neodhadujú — zobrazia sa až po reálnom prehľadaní.</div>
          </div>
        </div>
      )}

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Search Console</h3>
          {site.gsc && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>posledných {site.gsc.rangeDays} dní · reálne dáta z GSC</span>}
        </div>
        {site.gsc ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 1, background: 'var(--border-primary)' }}>
              {([
                ['Kliknutia', site.gsc.clicks.toLocaleString('sk-SK'), 'var(--accent-primary)'],
                ['Impresie', site.gsc.impressions.toLocaleString('sk-SK'), 'var(--text-primary)'],
                ['CTR', `${(site.gsc.ctr * 100).toFixed(1)} %`, 'var(--text-primary)'],
                ['Priem. pozícia', site.gsc.position.toFixed(1), 'var(--text-primary)'],
              ] as const).map(([t, v, c]) => (
                <div key={t} style={{ padding: '16px 18px', background: 'var(--surface-primary)' }}>
                  <div style={{ ...label, marginBottom: 8 }}>{t}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, ...mono, letterSpacing: '-0.02em', color: c }}>{v}</div>
                </div>
              ))}
            </div>
            {site.gsc.topQueries.length > 0 && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 74px 58px 58px', gap: 8, padding: '11px 18px', borderTop: '1px solid var(--border-primary)', ...label }}>
                  <span>Dopyt</span><span style={{ textAlign: 'right' }}>Kliky</span><span style={{ textAlign: 'right' }}>Impresie</span><span style={{ textAlign: 'right' }}>CTR</span><span style={{ textAlign: 'right' }}>Poz.</span>
                </div>
                {site.gsc.topQueries.map((q, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 74px 58px 58px', gap: 8, padding: '11px 18px', borderTop: '1px solid var(--border-primary)', fontSize: 13, alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.query}</span>
                    <span style={{ textAlign: 'right', ...mono, fontWeight: 700, color: 'var(--accent-primary)' }}>{q.clicks}</span>
                    <span style={{ textAlign: 'right', ...mono, color: 'var(--text-secondary)' }}>{q.impressions.toLocaleString('sk-SK')}</span>
                    <span style={{ textAlign: 'right', ...mono, color: 'var(--text-secondary)' }}>{(q.ctr * 100).toFixed(1)}%</span>
                    <span style={{ textAlign: 'right', ...mono, color: 'var(--text-secondary)' }}>{q.position.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: 24 }}>
            <div style={{ background: 'var(--surface-secondary)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>🔌</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Search Console nie je pripojená</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 440, margin: '0 auto', lineHeight: 1.5 }}>Po pridaní service accountu do GSC property collector zbehne týždenne a zobrazí kliknutia, impresie, CTR a pozície. Bez pripojenia tieto čísla nefabrikujeme.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabAeo({ site }: { site: SiteVM }) {
  const aeo = site.aeo;
  const initBots: Record<string, BotDecision> = {};
  BOT_DEFS.forEach((b) => {
    const raw = aeo?.aiBots[b.name];
    initBots[b.key] = raw === 'block' ? 'block' : raw === 'allow' ? 'allow' : 'decide';
  });
  const [dec, setDec] = useState<Record<string, BotDecision>>(initBots);

  if (!aeo) {
    return (
      <div style={{ ...card, padding: 24 }}>
        <div style={{ background: 'var(--surface-secondary)', borderRadius: 12, padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>AEO sa pre tento web ešte nemeralo</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 420, margin: '0 auto', lineHeight: 1.5 }}>Collector zbehne týždenne (alebo po pridaní webu). Skóre sa počíta deterministicky z HTML a robots.txt — nič sa nefabrikuje.</div>
        </div>
      </div>
    );
  }

  const off = +(326.7 * (1 - aeo.score / 100)).toFixed(1);
  const passed = aeo.checks.filter((c) => c.pass).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, padding: 24, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <Gauge score={aeo.score} off={off} color="var(--accent-primary)" size={120} sw={10} r={52} circ={326.7} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--text-primary)', marginBottom: 4 }}>AEO skóre — AI-ready</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
            {aeo.score >= 80 ? 'Nadpriemerná' : aeo.score >= 50 ? 'Priemerná' : 'Slabá'} pripravenosť pre AI vyhľadávače. Doplň nesplnené položky nižšie.
          </div>
          {aeo.schemaTypes.length > 0 && (
            <span style={{ display: 'inline-block', fontSize: 12, color: 'var(--text-secondary)', background: 'var(--surface-secondary)', padding: '4px 11px', borderRadius: 20, fontWeight: 600 }}>Schema: {aeo.schemaTypes.join(', ')}</span>
          )}
        </div>
      </div>

      <div style={{ ...card, padding: 20 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: 'var(--text-primary)' }}>Prístup AI botov</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 16 }}>Z robots.txt webu. Skóruje sa vedomé rozhodnutie — klikni na štítok pre allow / block / rozhodnúť.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
          {BOT_DEFS.map((b) => {
            const m = botMeta(dec[b.key]!);
            return (
              <div key={b.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: m.rowBg, borderRadius: 10, border: `1px solid ${m.border}` }}>
                <div><div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{b.name}</div><div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{b.sub}</div></div>
                <button onClick={() => setDec((d) => ({ ...d, [b.key]: nextBot(d[b.key]!) }))} style={{ padding: '5px 12px', background: m.bg, color: m.color, border: 'none', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{m.label}</button>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-primary)' }}>
          Pravidlá sa zapisujú do <span style={{ ...mono, color: 'var(--text-primary)' }}>robots.txt</span>. <a href="#" style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>Vysvetlenie kompromisu citácia vs. tréning →</a>
        </div>
      </div>

      <div style={{ ...card, padding: 20 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text-primary)' }}>Kontroly <span style={{ fontWeight: 500, color: 'var(--text-tertiary)', fontSize: 12.5 }}>· {passed} z {aeo.checks.length} splnené</span></h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13.5 }}>
          {aeo.checks.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '11px 14px', background: c.pass ? 'var(--ok-bg)' : 'var(--surface-secondary)', borderRadius: 10 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: c.pass ? 'var(--ok-color)' : 'var(--critical-bg)', color: c.pass ? 'white' : 'var(--critical-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{c.pass ? '✓' : '✕'}</span>
              <span style={{ flex: 1, color: 'var(--text-primary)' }}>{c.label}</span>
              <span style={{ ...mono, fontSize: 12, color: 'var(--text-tertiary)' }}>{c.earned}/{c.weight}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabInfra({ site }: { site: SiteVM }) {
  const sec = site.security;
  const headerRow: [string, keyof NonNullable<typeof sec>['headers']][] = [
    ['HSTS', 'hsts'],
    ['CSP', 'csp'],
    ['X-Frame-Options', 'xframe'],
    ['X-Content-Type', 'xcto'],
    ['Referrer-Policy', 'referrer'],
    ['Permissions-Policy', 'permissions'],
  ];
  const sbText =
    sec?.safeBrowsingOk === true ? 'Safe Browsing: čistý ✓' : sec?.safeBrowsingOk === false ? '⚠️ Safe Browsing: nález!' : 'Safe Browsing: nezistené';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {site.isWordPress ? (
        <>
          <MockBanner text="WordPress verzie, pluginy, updaty a zálohy sa spustia po nasadení WP agenta (mu-plugin + HMAC secret)." />
          <div style={{ ...card, padding: 16 }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text-primary)' }}>WordPress</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
              {([['Verzia', '6.4.2', false], ['Update dostupný', '6.4.3', true], ['PHP verzia', '8.2', false], ['Posledná záloha', 'pred 2 dňami', false], ['# pluginov', '23 (3 updaty)', false]] as const).map(([k, v, warn]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 14px', background: 'var(--surface-secondary)', borderRadius: 10 }}>
                  <span>{k}</span>
                  <strong style={{ ...(k === '# pluginov' || k.includes('verzia') || k === 'Verzia' ? mono : {}), color: warn ? 'var(--warning-color)' : 'var(--text-primary)', fontWeight: 600 }}>{v}</strong>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--border-primary)' }}>
              <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Pluginy</h3>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--warning-color)', background: 'var(--warning-bg)', padding: '3px 10px', borderRadius: 20 }}>3 updaty</span>
            </div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {([['Yoast SEO', '21.8', '22.0'], ['WooCommerce', '8.2.1', '8.2.2'], ['All in One SEO', '4.5.1', '4.6.0']] as const).map(([n, from, to], i) => (
                  <tr key={n} style={{ borderBottom: i < 2 ? '1px solid var(--border-primary)' : 'none' }}>
                    <td style={{ padding: '13px 18px', color: 'var(--text-primary)', fontWeight: 600 }}>{n}</td>
                    <td style={{ padding: '13px 18px', textAlign: 'right', color: 'var(--text-secondary)', ...mono }}>{from} → <span style={{ color: 'var(--warning-color)', fontWeight: 600 }}>{to}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ ...card, padding: 16 }}>
          <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text-primary)' }}>Doména &amp; TLS</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
            <ExpiryRow name="Doména expiruje o" days={site.domainDaysLeft} color={site.domainExpiryColor} />
            <ExpiryRow name="TLS certifikát expiruje o" days={site.tlsDaysLeft} color={site.tlsExpiryColor} />
          </div>
        </div>
      )}

      <div style={{ ...card, padding: 20 }}>
        {sec ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 18, flexWrap: 'wrap' }}>
              <Gauge score={sec.score} off={gaugeOffset(sec.score, 169.6)} color={scoreColor(sec.score)} size={64} sw={6} r={27} circ={169.6} />
              <div style={{ flex: 1, minWidth: 150 }}>
                <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 3 }}>Security skóre</h3>
                <div style={{ fontSize: 12.5, color: sec.safeBrowsingOk === false ? 'var(--critical-color)' : 'var(--text-secondary)' }}>
                  {sec.score === 100 ? 'Všetky bezpečnostné hlavičky nastavené. ' : 'Niektoré hlavičky chýbajú (nižšie). '}
                  {sbText}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, fontSize: 13 }}>
              {headerRow.map(([t, key]) => {
                const ok = sec.headers[key];
                return (
                  <div key={t} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '10px 13px', background: ok ? 'var(--ok-bg)' : 'var(--critical-bg)', borderRadius: 9 }}>
                    <span style={{ color: ok ? 'var(--ok-color)' : 'var(--critical-color)', fontWeight: 700 }}>{ok ? '✓' : '✗'}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{t}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ background: 'var(--surface-secondary)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>🔒</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Security sa ešte nemeralo</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Security headers + Safe Browsing sa merajú týždenne.</div>
          </div>
        )}
      </div>

      <div style={{ ...card, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Zraniteľnosti</h3>
        </div>
        <div style={{ marginBottom: 14 }}>
          <MockBanner text="Vuln/CVE matica (plugin verzia × známa CVE) sa spustí po pripojení WPScan / Patchstack tokenu." />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 15px', background: 'var(--critical-bg)', border: '1px solid var(--critical-color)', borderRadius: 11 }}>
            <span style={{ fontSize: 18 }}>🔴</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>Contact Form 7 · v5.7.1</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Aktívne zneužívaná · <span style={mono}>CVE-2024-2013</span> · oprava v 5.8.0</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: 'var(--critical-color)', padding: '4px 10px', borderRadius: 8, whiteSpace: 'nowrap' }}>CVSS 8.8</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 15px', background: 'var(--warning-bg)', borderRadius: 11 }}>
            <span style={{ fontSize: 18 }}>🟡</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>WooCommerce · v8.2.1</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Stredná závažnosť · <span style={mono}>CVE-2024-1854</span> · oprava v 8.2.2</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: 'var(--warning-color)', padding: '4px 10px', borderRadius: 8, whiteSpace: 'nowrap' }}>CVSS 5.3</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabClient({ site }: { site: SiteVM }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <MockBanner text="Meno klienta je reálne; tier, kontakt a fakturačné údaje sú zatiaľ ukážkové (napoja sa z karty klienta)." />
      <div style={{ ...card, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: 'var(--accent-primary)', ...mono }}>{site.clientInitial}</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>{site.clientName}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Aktívny klient · zmluva na dobu neurčitú</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, fontSize: 13 }}>
          {([['Tier / paušál', 'Premium · 59 €/mes'], ['Kontakt', 'peter@klient.sk'], ['Fakturácia', 'IČO 12345678'], ['Klient od', '3. 6. 2023']] as const).map(([k, v]) => (
            <div key={k} style={{ padding: '12px 14px', background: 'var(--surface-secondary)', borderRadius: 10 }}>
              <div style={{ ...label, fontSize: 11, marginBottom: 5, color: 'var(--text-tertiary)' }}>{k}</div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {([['📓', 'Notion', 'Poznámky & história prác'], ['🔐', 'Bitwarden', 'Prístupy (len odkaz)']] as const).map(([icon, t, sub]) => (
          <a key={t} href="#" style={{ flex: 1, minWidth: 140, textDecoration: 'none', ...card, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20 }}>{icon}</span>
            <div><div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>{t}</div><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sub}</div></div>
          </a>
        ))}
      </div>
      <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 'var(--radius)', padding: '14px 18px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
        🔒 Žiadne heslá ani kľúče sa tu neukladajú — iba odkazy do Bitwarden / Notion.
      </div>
    </div>
  );
}

/* ─────────────────────────── router ─────────────────────────── */
function SitesInner() {
  const id = useSearchParams().get('id');
  return id ? <SiteDetail id={id} /> : <SitesList />;
}

export default function SitesPage() {
  return (
    <Shell>
      <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-secondary)' }}>Načítavam…</div>}>
        <SitesInner />
      </Suspense>
    </Shell>
  );
}
