'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { loadDashboard, type SiteVM } from '../lib/data';
import type { Alert } from '../lib/supabase';

const card = {
  background: 'var(--surface-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-md)',
} as const;
const mono = { fontFamily: "'Geist Mono', monospace", fontVariantNumeric: 'tabular-nums' } as const;

const MONTHS = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December'];

export default function ReportPage() {
  const [sites, setSites] = useState<SiteVM[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    let a = true;
    loadDashboard().then(({ sites, alerts }) => {
      if (!a) return;
      setSites(sites);
      setAlerts(alerts);
    });
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

  const now = new Date();
  const monthLabel = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const reportDate = `${now.getDate()}. ${now.getMonth() + 1}. ${now.getFullYear()}`;

  const monitored = sites.filter((s) => s.statusKey !== 'unknown');
  const upVals = monitored.map((s) => s.uptime30d).filter((v): v is number => v !== null);
  const avgUptime = upVals.length ? Math.round((upVals.reduce((a, b) => a + b, 0) / upVals.length) * 10) / 10 : null;
  const incidents30 = sites.reduce((n, s) => n + s.incidentCount30, 0);
  const updateAlerts = alerts.filter((a) => a.type === 'core_update' || a.type === 'plugin_update');

  return (
    <Shell>
      <div style={{ minHeight: '100vh', padding: '48px 24px 64px', background: 'var(--bg-base)' }}>
        <div style={{ ...card, maxWidth: 720, margin: '0 auto', overflow: 'hidden' }}>
          <div style={{ padding: '28px 32px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 6 }}>Mesačná správa</div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{monthLabel}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>Lopatka — všetky weby ({sites.length})</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 13 }}>◈</div>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Monitorix</span>
            </div>
          </div>

          <div style={{ padding: '28px 32px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
              <div style={{ background: 'var(--ok-bg)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 8 }}>Uptime</div>
                <div style={{ fontSize: 28, fontWeight: 800, ...mono, color: 'var(--ok-color)' }}>{avgUptime === null ? '—' : `${avgUptime}%`}</div>
              </div>
              <div style={{ background: 'var(--surface-secondary)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 8 }}>Incidenty</div>
                <div style={{ fontSize: 28, fontWeight: 800, ...mono, color: 'var(--text-primary)' }}>{incidents30}</div>
              </div>
              <div style={{ background: 'var(--surface-secondary)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 8 }}>Update alerty</div>
                <div style={{ fontSize: 28, fontWeight: 800, ...mono, color: 'var(--text-primary)' }}>{updateAlerts.length}</div>
              </div>
            </div>

            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Dostupné aktualizácie</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 28 }}>
              {updateAlerts.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Detailný zoznam vykonaných updatov pribudne po pripojení WP agenta.</div>
              ) : (
                updateAlerts.map((a) => (
                  <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--warning-color)' }}>•</span> {a.title}
                  </div>
                ))
              )}
            </div>

            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Zhrnutie</div>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: 4 }}>
              Za posledných 30 dní boli vaše weby dostupné v priemere {avgUptime === null ? '—' : `${avgUptime} %`} času. Zaznamenali sme {incidents30}{' '}
              {incidents30 === 1 ? 'incident' : incidents30 >= 2 && incidents30 <= 4 ? 'incidenty' : 'incidentov'}. Monitoring beží nepretržite a o výpadkoch vás upozorníme e-mailom skôr, než ich zaznamenajú návštevníci.
            </p>
          </div>

          <div style={{ padding: '18px 32px', borderTop: '1px solid var(--border-primary)', background: 'var(--surface-secondary)', fontSize: 12, color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Monitorix · {reportDate}</span>
            <span>Vygenerované automaticky</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}
