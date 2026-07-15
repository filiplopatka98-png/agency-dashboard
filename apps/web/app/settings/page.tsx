'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { supabase } from '../lib/supabase';

type JobRun = { status: string; ok: number | null; failed: number | null; finished_at: string };
type Sched =
  | { kind: 'every5' }
  | { kind: 'daily'; hh: number; mm: number }
  | { kind: 'weekly'; dow: number; hh: number; mm: number }
  | { kind: 'monthly'; dom: number; hh: number; mm: number };

const JOBS: { key: string; label: string; desc: string; sched: Sched }[] = [
  { key: 'scheduler', label: 'Scheduler — uptime + domény', desc: 'každých 5 minút', sched: { kind: 'every5' } },
  { key: 'psi', label: 'PageSpeed / výkon', desc: 'denne 02:00 UTC', sched: { kind: 'daily', hh: 2, mm: 0 } },
  { key: 'tls', label: 'TLS certifikáty', desc: 'pondelok 03:00 UTC', sched: { kind: 'weekly', dow: 1, hh: 3, mm: 0 } },
  { key: 'security', label: 'Security + Safe Browsing', desc: 'pondelok 03:00 UTC', sched: { kind: 'weekly', dow: 1, hh: 3, mm: 0 } },
  { key: 'aeo', label: 'AEO analýza', desc: 'pondelok 03:30 UTC', sched: { kind: 'weekly', dow: 1, hh: 3, mm: 30 } },
  { key: 'gsc', label: 'Search Console', desc: 'pondelok 03:30 UTC', sched: { kind: 'weekly', dow: 1, hh: 3, mm: 30 } },
  { key: 'seo', label: 'SEO crawl', desc: 'pondelok 04:00 UTC', sched: { kind: 'weekly', dow: 1, hh: 4, mm: 0 } },
  { key: 'infra', label: 'Infra (hosting/server/TLS)', desc: 'pondelok 04:00 UTC', sched: { kind: 'weekly', dow: 1, hh: 4, mm: 0 } },
  { key: 'cve', label: 'WPScan CVE matica', desc: 'pondelok 06:00 UTC', sched: { kind: 'weekly', dow: 1, hh: 6, mm: 0 } },
  { key: 'history', label: 'História + zmeny', desc: 'pondelok 07:00 UTC', sched: { kind: 'weekly', dow: 1, hh: 7, mm: 0 } },
  { key: 'digest', label: 'Týždenný digest (e-mail)', desc: 'pondelok 08:00 UTC', sched: { kind: 'weekly', dow: 1, hh: 8, mm: 0 } },
  { key: 'report', label: 'Mesačný report (e-mail)', desc: '1. deň mesiaca 07:00 UTC', sched: { kind: 'monthly', dom: 1, hh: 7, mm: 0 } },
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
  if (sched.kind === 'monthly') {
    n.setUTCDate(sched.dom);
    if (n <= from) n.setUTCMonth(n.getUTCMonth() + 1, sched.dom);
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

type NotifSettings = { org_id: string; weekly_digest: boolean; monthly_report: boolean; recipients: string[] };

export default function SettingsPage() {
  const [orgName, setOrgName] = useState<string>('—');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>('—');
  const [orgSiteCount, setOrgSiteCount] = useState<number>(0);
  const [conn, setConn] = useState<Record<string, number>>({});
  const [jobs, setJobs] = useState<Record<string, JobRun> | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [notif, setNotif] = useState<NotifSettings | null>(null);
  const [recipText, setRecipText] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const headCount = (table: 'perf_snapshots' | 'gsc_snapshots' | 'security_snapshots' | 'aeo_snapshots' | 'seo_snapshots') =>
      supabase.from(table).select('site_id', { count: 'exact', head: true });
    (async () => {
      const [o, u, s, perf, gsc, sec, aeo, seo, jr, ns] = await Promise.all([
        supabase.from('organizations').select('id, name').limit(1).maybeSingle(),
        supabase.auth.getUser(),
        supabase.from('sites').select('id', { count: 'exact', head: true }).eq('is_active', true),
        headCount('perf_snapshots'),
        headCount('gsc_snapshots'),
        headCount('security_snapshots'),
        headCount('aeo_snapshots'),
        headCount('seo_snapshots'),
        supabase.from('job_runs').select('job, status, ok, failed, finished_at').order('finished_at', { ascending: false }).limit(300),
        supabase.from('notification_settings').select('org_id, weekly_digest, monthly_report, recipients').limit(1).maybeSingle(),
      ]);
      if (!active) return;
      setOrgName(o.data?.name ?? '—');
      setOrgId(o.data?.id ?? null);
      setEmail(u.data.user?.email ?? '—');
      setOrgSiteCount(s.count ?? 0);
      if (ns.data) {
        setNotif(ns.data as NotifSettings);
        setRecipText((ns.data.recipients ?? []).join('\n'));
      } else if (o.data?.id) {
        setNotif({ org_id: o.data.id, weekly_digest: true, monthly_report: true, recipients: [] });
      }
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

  const saveNotif = async () => {
    if (!notif || !orgId) return;
    setSaving(true);
    setSaved(null);
    // e-maily: 1 na riadok/čiarku, orezať, dedup, len validné
    const recipients = Array.from(
      new Set(
        recipText
          .split(/[\n,;]+/)
          .map((r) => r.trim())
          .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)),
      ),
    );
    const { error } = await supabase
      .from('notification_settings')
      .upsert({ org_id: orgId, weekly_digest: notif.weekly_digest, monthly_report: notif.monthly_report, recipients }, { onConflict: 'org_id' });
    setSaving(false);
    if (error) {
      setSaved(`Chyba: ${error.message}`);
    } else {
      setNotif({ ...notif, recipients });
      setRecipText(recipients.join('\n'));
      setSaved('Uložené ✓');
      setTimeout(() => setSaved(null), 2500);
    }
  };

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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <h3 style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Notifikácie &amp; reporty</h3>
                {saved && <span style={{ fontSize: '12px', fontWeight: 600, color: saved.startsWith('Chyba') ? 'var(--critical-color)' : 'var(--ok-color)' }}>{saved}</span>}
              </div>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                Komu chodia týždenný digest a mesačný report. Prázdny zoznam = fallback na admin e-mail{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>.
              </div>
              {notif ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13.5px' }}>
                  <div>
                    <label htmlFor="recip" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      Príjemcovia e-mailov (jeden na riadok)
                    </label>
                    <textarea
                      id="recip"
                      value={recipText}
                      onChange={(e) => setRecipText(e.target.value)}
                      rows={3}
                      placeholder={email === '—' ? 'meno@firma.sk' : email}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '13px', fontFamily: "'Geist Mono', monospace", background: 'var(--surface-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '10px', resize: 'vertical' }}
                    />
                  </div>
                  {([
                    ['weekly_digest', 'Týždenný digest', 'Prehľad všetkých webov · pondelok'],
                    ['monthly_report', 'Mesačný report', 'Súhrn za mesiac · 1. deň mesiaca'],
                  ] as const).map(([key, title, desc]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setNotif({ ...notif, [key]: !notif[key] })}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--surface-secondary)', border: '1px solid var(--border-primary)', borderRadius: '10px', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                    >
                      <span>
                        <span style={{ display: 'block', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{desc}</span>
                      </span>
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: notif[key] ? 'var(--ok-color)' : 'var(--text-tertiary)', background: notif[key] ? 'var(--ok-bg)' : 'var(--surface-primary)', border: notif[key] ? 'none' : '1px solid var(--border-primary)', padding: '4px 12px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
                        {notif[key] ? 'zapnuté' : 'vypnuté'}
                      </span>
                    </button>
                  ))}
                  <div>
                    <button
                      type="button"
                      onClick={saveNotif}
                      disabled={saving}
                      style={{ padding: '10px 20px', fontSize: '13.5px', fontWeight: 600, color: '#fff', background: saving ? 'var(--text-tertiary)' : 'var(--accent-primary)', border: 'none', borderRadius: '10px', cursor: saving ? 'default' : 'pointer' }}
                    >
                      {saving ? 'Ukladám…' : 'Uložiť nastavenia'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '12.5px', color: 'var(--text-tertiary)' }}>Načítavam…</div>
              )}
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
