'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { supabase } from '../lib/supabase';

type JobRun = { status: string; ok: number | null; failed: number | null; finished_at: string };
type Sched = { kind: 'every5' } | { kind: 'daily'; hh: number; mm: number } | { kind: 'weekly'; dow: number; hh: number; mm: number };

const JOBS: { key: string; label: string; desc: string; sched: Sched }[] = [
  { key: 'scheduler', label: 'Scheduler — uptime + domény', desc: 'každých 5 minút', sched: { kind: 'every5' } },
  { key: 'psi', label: 'PageSpeed / výkon', desc: 'denne 02:00 UTC', sched: { kind: 'daily', hh: 2, mm: 0 } },
  { key: 'tls', label: 'TLS certifikáty', desc: 'pondelok 03:00 UTC', sched: { kind: 'weekly', dow: 1, hh: 3, mm: 0 } },
  { key: 'security', label: 'Security + Safe Browsing', desc: 'pondelok 03:00 UTC', sched: { kind: 'weekly', dow: 1, hh: 3, mm: 0 } },
  { key: 'aeo', label: 'AEO analýza', desc: 'pondelok 03:30 UTC', sched: { kind: 'weekly', dow: 1, hh: 3, mm: 30 } },
  { key: 'gsc', label: 'Search Console', desc: 'pondelok 03:30 UTC', sched: { kind: 'weekly', dow: 1, hh: 3, mm: 30 } },
  { key: 'seo', label: 'SEO crawl', desc: 'pondelok 04:00 UTC', sched: { kind: 'weekly', dow: 1, hh: 4, mm: 0 } },
];

function nextRun(sched: Sched, from: Date): Date {
  const n = new Date(from.getTime());
  if (sched.kind === 'every5') {
    n.setUTCSeconds(0, 0);
    n.setUTCMinutes(Math.floor(from.getUTCMinutes() / 5) * 5 + 5);
    return n;
  }
  n.setUTCHours(sched.hh, sched.mm, 0, 0);
  if (sched.kind === 'daily') {
    if (n <= from) n.setUTCDate(n.getUTCDate() + 1);
    return n;
  }
  let delta = (sched.dow - n.getUTCDay() + 7) % 7;
  if (delta === 0 && n <= from) delta = 7;
  n.setUTCDate(n.getUTCDate() + delta);
  return n;
}

// „5 min", „3 h", „2 d" — hrubá relatívna vzdialenosť v čase.
function rel(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60000);
  if (min < 1) return 'teraz';
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

const jobStatusColor: Record<string, [string, string]> = {
  ok: ['var(--ok-color)', 'var(--ok-bg)'],
  partial: ['var(--warning-color)', 'var(--warning-bg)'],
  error: ['var(--critical-color)', 'var(--critical-bg)'],
};

export default function SettingsPage() {
  const [orgName, setOrgName] = useState<string>('—');
  const [email, setEmail] = useState<string>('—');
  const [orgSiteCount, setOrgSiteCount] = useState<number>(0);
  const [conn, setConn] = useState<Record<string, number>>({});
  const [jobs, setJobs] = useState<Record<string, JobRun> | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    const headCount = (table: 'perf_snapshots' | 'gsc_snapshots' | 'security_snapshots' | 'aeo_snapshots' | 'seo_snapshots') =>
      supabase.from(table).select('site_id', { count: 'exact', head: true });
    (async () => {
      const [o, u, s, perf, gsc, sec, aeo, seo, jr] = await Promise.all([
        supabase.from('organizations').select('name').limit(1).maybeSingle(),
        supabase.auth.getUser(),
        supabase.from('sites').select('id', { count: 'exact', head: true }).eq('is_active', true),
        headCount('perf_snapshots'),
        headCount('gsc_snapshots'),
        headCount('security_snapshots'),
        headCount('aeo_snapshots'),
        headCount('seo_snapshots'),
        supabase.from('job_runs').select('job, status, ok, failed, finished_at').order('finished_at', { ascending: false }).limit(300),
      ]);
      if (!active) return;
      setOrgName(o.data?.name ?? '—');
      setEmail(u.data.user?.email ?? '—');
      setOrgSiteCount(s.count ?? 0);
      setConn({
        perf_snapshots: perf.count ?? 0,
        gsc_snapshots: gsc.count ?? 0,
        security_snapshots: sec.count ?? 0,
        aeo_snapshots: aeo.count ?? 0,
        seo_snapshots: seo.count ?? 0,
      });
      const latest: Record<string, JobRun> = {};
      for (const r of jr.data ?? []) if (!latest[r.job]) latest[r.job] = r as JobRun; // prvý = najnovší (order desc)
      setJobs(latest);
      setNow(new Date());
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Shell>
      <div style={{ minHeight: '100vh', padding: '32px 24px 64px', background: 'var(--bg-base)' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <h1
            style={{
              fontSize: '30px',
              fontWeight: 800,
              letterSpacing: '-0.025em',
              marginBottom: '22px',
            }}
          >
            Nastavenia
          </h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Beh úloh (cron) */}
            <div style={{ background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius)', padding: '20px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
                <h3 style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Beh úloh (cron)</h3>
                <span style={{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>časy v UTC</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {JOBS.map((j) => {
                  const run = jobs?.[j.key];
                  const [c, bg] = run ? jobStatusColor[run.status] ?? ['var(--text-tertiary)', 'var(--surface-secondary)'] : ['var(--text-tertiary)', 'var(--surface-secondary)'];
                  const last = run && now ? `pred ${rel(now.getTime() - new Date(run.finished_at).getTime())}` : 'nikdy';
                  const next = now ? `o ${rel(nextRun(j.sched, now).getTime() - now.getTime())}` : '—';
                  const cnt = run && (run.ok != null || run.failed != null) ? ` · ${run.ok ?? 0}✓${run.failed ? ` ${run.failed}✗` : ''}` : '';
                  return (
                    <div key={j.key} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center', padding: '11px 14px', background: 'var(--surface-secondary)', borderRadius: '10px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{j.label}</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>{j.desc} · ďalší {next}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{last}{cnt}</span>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: c, background: bg, padding: '3px 9px', borderRadius: '20px', minWidth: '52px', textAlign: 'center' }}>{run ? run.status : '—'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {!jobs && <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>Načítavam…</div>}
            </div>

            {/* Organizácia */}
            <div
              style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
                padding: '20px',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <h3
                style={{
                  fontWeight: 700,
                  fontSize: '14px',
                  marginBottom: '14px',
                  color: 'var(--text-primary)',
                }}
              >
                Organizácia
              </h3>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontSize: '13.5px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '11px 14px',
                    background: 'var(--surface-secondary)',
                    borderRadius: '10px',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>Názov</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{orgName}</strong>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '11px 14px',
                    background: 'var(--surface-secondary)',
                    borderRadius: '10px',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>Prihlásený</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{email} (owner)</strong>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '11px 14px',
                    background: 'var(--surface-secondary)',
                    borderRadius: '10px',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>Monitorovaných webov</span>
                  <strong
                    style={{ fontFamily: "'Geist Mono', monospace", color: 'var(--text-primary)' }}
                  >
                    {orgSiteCount}
                  </strong>
                </div>
              </div>
            </div>

            {/* Integrácie / API kľúče */}
            <div
              style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
                padding: '20px',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <h3
                style={{
                  fontWeight: 700,
                  fontSize: '14px',
                  marginBottom: '14px',
                  color: 'var(--text-primary)',
                }}
              >
                Integrácie / API kľúče
              </h3>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                {'Stav sa odvodzuje z reálnych dát — „Pripojené" znamená, že collector už zapísal aspoň jeden snímok.'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {([
                  ['PageSpeed Insights', 'Lab + Field (CrUX) performance', conn.perf_snapshots],
                  ['Google Search Console', 'SEO kliknutia / impresie / pozície', conn.gsc_snapshots],
                  ['Security + Safe Browsing', 'Bezpečnostné hlavičky + blacklist', conn.security_snapshots],
                  ['AEO analýza', 'Pripravenosť pre AI / answer engines', conn.aeo_snapshots],
                  ['SEO crawl', 'Technické SEO issues z crawlu', conn.seo_snapshots],
                ] as const).map(([name, desc, count]) => {
                  const on = (count ?? 0) > 0;
                  return (
                    <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--surface-secondary)', borderRadius: '10px' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>{name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{desc}</div>
                      </div>
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: on ? 'var(--ok-color)' : 'var(--text-tertiary)', background: on ? 'var(--ok-bg)' : 'var(--surface-primary)', border: on ? 'none' : '1px solid var(--border-primary)', padding: '4px 11px', borderRadius: '20px' }}>
                        {on ? `Pripojené · ${count}` : 'Nenastavené'}
                      </span>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--surface-secondary)', borderRadius: '10px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>Resend</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Odosielanie e-mailov &amp; reportov</div>
                  </div>
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', padding: '4px 11px', borderRadius: '20px' }}>
                    Cez env / CI
                  </span>
                </div>
              </div>
            </div>

            {/* Notifikácie */}
            <div
              style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
                padding: '20px',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <h3
                style={{
                  fontWeight: 700,
                  fontSize: '14px',
                  marginBottom: '14px',
                  color: 'var(--text-primary)',
                }}
              >
                Notifikácie
              </h3>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontSize: '13.5px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '11px 14px',
                    background: 'var(--surface-secondary)',
                    borderRadius: '10px',
                  }}
                >
                  <span style={{ color: 'var(--text-primary)' }}>E-mail príjemca</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '11px 14px',
                    background: 'var(--surface-secondary)',
                    borderRadius: '10px',
                  }}
                >
                  <span style={{ color: 'var(--text-primary)' }}>Denný digest</span>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: 'var(--ok-color)',
                      background: 'var(--ok-bg)',
                      padding: '3px 10px',
                      borderRadius: '20px',
                    }}
                  >
                    07:00 zap.
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '11px 14px',
                    background: 'var(--surface-secondary)',
                    borderRadius: '10px',
                    opacity: 0.65,
                  }}
                >
                  <span style={{ color: 'var(--text-primary)' }}>Slack / Telegram</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>čoskoro</span>
                </div>
              </div>
            </div>

            {/* Retencia + Tím */}
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}
            >
              <div
                style={{
                  background: 'var(--surface-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius)',
                  padding: '20px',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <h3
                  style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    marginBottom: '10px',
                    color: 'var(--text-primary)',
                  }}
                >
                  Retencia
                </h3>
                <div
                  style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}
                >
                  Raw dáta <strong style={{ color: 'var(--text-primary)' }}>30 dní</strong>
                  <br />
                  Denné snapshoty{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>13 mesiacov</strong>
                </div>
              </div>
              <div
                style={{
                  background: 'var(--surface-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius)',
                  padding: '20px',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <h3
                  style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    marginBottom: '10px',
                    color: 'var(--text-primary)',
                  }}
                >
                  Tím
                </h3>
                <div
                  style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}
                >
                  1 owner (Filip)
                  <br />
                  <span style={{ color: 'var(--text-tertiary)' }}>Pozvať člena — fáza 4</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
