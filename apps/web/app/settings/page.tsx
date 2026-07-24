'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { supabase } from '../lib/supabase';
// JOB_SCHEDULES/isOverdue žijú v @agency/core (zdieľané s apps/scheduler —
// Worker z nich počíta ten istý dead-man's switch, viď runJobHealth.ts).
// Jediný zdroj pravdy pre očakávaný interval jobu — nehardcoduj druhú kópiu.
import { JOB_SCHEDULES, isOverdue, type JobSchedule } from '@agency/core/jobSchedule';

type JobRun = { status: string; ok: number | null; failed: number | null; error: string | null; finished_at: string };

const JOBS: { key: string; label: string; desc: string; sched: JobSchedule }[] = [
  { key: 'scheduler', label: 'Scheduler — uptime + domény', desc: 'každých 5 minút' },
  { key: 'psi', label: 'PageSpeed / výkon', desc: 'denne 02:00 UTC' },
  { key: 'tls', label: 'TLS certifikáty', desc: 'pondelok 03:00 UTC' },
  { key: 'security', label: 'Security + Safe Browsing', desc: 'pondelok 03:00 UTC' },
  { key: 'aeo', label: 'AEO analýza', desc: 'pondelok 03:30 UTC' },
  { key: 'gsc', label: 'Search Console', desc: 'pondelok 03:30 UTC' },
  { key: 'seo', label: 'SEO crawl', desc: 'pondelok 04:00 UTC' },
  { key: 'infra', label: 'Infra (hosting/server/TLS)', desc: 'pondelok 04:00 UTC' },
  { key: 'cve', label: 'WPScan CVE matica', desc: 'denne 06:00 UTC' },
  { key: 'history', label: 'História + zmeny', desc: 'pondelok 07:00 UTC' },
  { key: 'digest', label: 'Týždenný digest (e-mail)', desc: 'pondelok 08:00 UTC' },
  { key: 'report', label: 'Mesačný report (e-mail)', desc: '1. deň mesiaca 07:00 UTC' },
  { key: 'asset-check', label: 'Kontrola CSS (rozbité assety)', desc: 'každú hodinu' },
].map((j) => ({ ...j, sched: JOB_SCHEDULES[j.key]! }));

function nextRun(sched: JobSchedule, from: Date): Date {
  const n = new Date(from.getTime());
  if (sched.kind === 'every5') {
    n.setUTCSeconds(0, 0);
    n.setUTCMinutes(Math.floor(from.getUTCMinutes() / 5) * 5 + 5);
    return n;
  }
  if (sched.kind === 'hourly') {
    n.setUTCMinutes(0, 0, 0);
    n.setUTCHours(from.getUTCHours() + 1);
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

// Worker endpoint pre ručné spustenie (dispatchne GitHub workflow). Scheduler beží na cron → nedispatchovateľný.
const WORKER_URL = 'https://agency-dashboard-scheduler.filip-lopatka98.workers.dev';
const DISPATCHABLE = new Set(['psi', 'tls', 'security', 'aeo', 'gsc', 'seo', 'infra', 'cve', 'history', 'digest', 'report', 'asset-check']);

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
  const [trig, setTrig] = useState<Record<string, 'run' | 'ok' | 'err'>>({});
  const [trigErr, setTrigErr] = useState<Record<string, string>>({});

  const runNow = async (jobKey: string) => {
    setTrig((t) => ({ ...t, [jobKey]: 'run' }));
    setTrigErr((e) => { const n = { ...e }; delete n[jobKey]; return n; });
    // Dôvod zlyhania MUSÍ byť vidno. Predtým tu bolo len 'err' pre všetko —
    // 401, 503 aj sieťový výpadok vyzerali rovnako a nedalo sa hádať, čo je zle.
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setTrig((t) => ({ ...t, [jobKey]: 'err' }));
        setTrigErr((e) => ({ ...e, [jobKey]: 'Nie si prihlásený (chýba token) — obnov stránku.' }));
        return;
      }
      const res = await fetch(`${WORKER_URL}/trigger`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: jobKey }),
      });
      if (res.ok) {
        setTrig((t) => ({ ...t, [jobKey]: 'ok' }));
      } else {
        const body = await res.json().catch(() => ({}));
        const why = (body as { error?: string }).error ?? res.statusText;
        setTrig((t) => ({ ...t, [jobKey]: 'err' }));
        setTrigErr((e) => ({ ...e, [jobKey]: `${res.status}: ${why}` }));
      }
    } catch (err) {
      setTrig((t) => ({ ...t, [jobKey]: 'err' }));
      setTrigErr((e) => ({ ...e, [jobKey]: `Sieť/CORS: ${err instanceof Error ? err.message : String(err)}` }));
    }
    // Chybu nechaj visieť dlhšie než úspech — je čo čítať.
    setTimeout(() => setTrig((t) => { const n = { ...t }; delete n[jobKey]; return n; }), 8000);
  };

  useEffect(() => {
    let active = true;
    const headCount = (table: 'perf_snapshots' | 'gsc_snapshots' | 'security_snapshots' | 'aeo_snapshots' | 'seo_snapshots') =>
      supabase.from(table).select('site_id', { count: 'exact', head: true });
    (async () => {
      // job_runs: scheduler píše každých 5 min a pri dlhšom chybovom stave
      // (status != 'ok', ktorý retencia 0031 NEmaže) by tisíce scheduler riadkov
      // vytlačili posledné behy denných/týždenných jobov z jedného plochého
      // `.limit()` okna → dead-man's-switch (audit 3.3) by ich hlásil ako „nikdy".
      // Preto scheduler čítame ZVLÁŠŤ (najnovší 1) a non-scheduler joby druhým
      // dotazom (nízkoobjemové, 0035 drží najnovší riadok per job navždy).
      const jobCols = 'job, status, ok, failed, error, finished_at';
      const [o, u, s, perf, gsc, sec, aeo, seo, jrSched, jrOther, ns] = await Promise.all([
        supabase.from('organizations').select('id, name').limit(1).maybeSingle(),
        supabase.auth.getUser(),
        supabase.from('sites').select('id', { count: 'exact', head: true }).eq('is_active', true),
        headCount('perf_snapshots'),
        headCount('gsc_snapshots'),
        headCount('security_snapshots'),
        headCount('aeo_snapshots'),
        headCount('seo_snapshots'),
        supabase.from('job_runs').select(jobCols).eq('job', 'scheduler').order('finished_at', { ascending: false }).limit(1),
        supabase.from('job_runs').select(jobCols).neq('job', 'scheduler').order('finished_at', { ascending: false }).limit(500),
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
      for (const r of [...(jrSched.data ?? []), ...(jrOther.data ?? [])])
        if (!latest[r.job]) latest[r.job] = r as JobRun; // prvý výskyt = najnovší (order desc)
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
                  // Dead-man's switch (audit 3.3): job, čo naposledy uspel pred
                  // dvoma mesiacmi, nesmie svietiť zeleno len preto, že jeho
                  // POSLEDNÝ status bol 'ok' — ak od finished_at ubehlo > 2× jeho
                  // očakávaný interval, je to alarmujúce bez ohľadu na status.
                  const overdue = Boolean(run && now && isOverdue(run.finished_at, j.sched, now.getTime()));
                  const [c, bg] = overdue
                    ? jobStatusColor.error
                    : run
                      ? jobStatusColor[run.status] ?? ['var(--text-tertiary)', 'var(--surface-secondary)']
                      : ['var(--text-tertiary)', 'var(--surface-secondary)'];
                  const last = run && now ? `pred ${rel(now.getTime() - new Date(run.finished_at).getTime())}` : 'nikdy';
                  const next = now ? `o ${rel(nextRun(j.sched, now).getTime() - now.getTime())}` : '—';
                  const cnt = run && (run.ok != null || run.failed != null) ? ` · ${run.ok ?? 0}✓${run.failed ? ` ${run.failed}✗` : ''}` : '';
                  const badgeText = overdue ? 'meškanie' : run ? run.status : '—';
                  const badgeTitle = overdue
                    ? `Posledný beh ${last} (status ${run!.status}) — očakávaný interval prekročený viac než 2×`
                    : undefined;
                  // FIX 3.5 — error text sa zbieral, ale nikde sa nezobrazoval;
                  // skrátené nabok od odznaku, celý text v title (bez otvárania Supabase).
                  const errText = run?.error ? (run.error.length > 72 ? `${run.error.slice(0, 72)}…` : run.error) : null;
                  return (
                    <div key={j.key} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center', padding: '11px 14px', background: 'var(--surface-secondary)', borderRadius: '10px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{j.label}</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>{j.desc} · ďalší {next}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{last}{cnt}</span>
                          <span title={badgeTitle} style={{ fontSize: '11px', fontWeight: 700, color: c, background: bg, padding: '3px 9px', borderRadius: '20px', minWidth: '52px', textAlign: 'center' }}>{badgeText}</span>
                          {DISPATCHABLE.has(j.key) && (
                            <button
                              onClick={() => runNow(j.key)}
                              disabled={trig[j.key] === 'run'}
                              title="Spustiť job teraz (GitHub Action)"
                              style={{ fontSize: '11px', fontWeight: 600, color: trig[j.key] === 'ok' ? 'var(--ok-color)' : trig[j.key] === 'err' ? 'var(--critical-color)' : 'var(--accent-primary)', background: 'transparent', border: '1px solid var(--border-primary)', borderRadius: '7px', padding: '3px 9px', cursor: trig[j.key] === 'run' ? 'default' : 'pointer', minWidth: '64px' }}
                            >
                              {trig[j.key] === 'run' ? '…' : trig[j.key] === 'ok' ? 'spustené ✓' : trig[j.key] === 'err' ? 'chyba' : 'Spustiť'}
                            </button>
                          )}
                        </div>
                        {/* Dôvod zlyhania spustenia — bez neho je „chyba" nediagnostikovateľná. */}
                        {trigErr[j.key] && (
                          <div title={trigErr[j.key]} style={{ fontSize: '11px', color: 'var(--critical-color)', maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {trigErr[j.key]}
                          </div>
                        )}
                        {errText && (
                          <div title={run?.error ?? undefined} style={{ fontSize: '11px', color: 'var(--critical-color)', maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {errText}
                          </div>
                        )}
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
                {saved && <span role="status" aria-live="polite" style={{ fontSize: '12px', fontWeight: 600, color: saved.startsWith('Chyba') ? 'var(--critical-color)' : 'var(--ok-color)' }}>{saved}</span>}
              </div>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                Interný prehľad (všetky weby) — komu chodí týždenný digest a mesačný agregát. Prázdny zoznam = fallback na admin e-mail{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>. Report pre konkrétneho klienta (len jeho weby) nastavíš pri klientovi v sekcii <strong style={{ color: 'var(--text-primary)' }}>Klienti</strong> (pole „Report e-mail&quot;).
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
                      role="switch"
                      aria-checked={notif[key]}
                      aria-label={title}
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
