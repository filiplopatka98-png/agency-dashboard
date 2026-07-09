'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { supabase, type Alert } from '../lib/supabase';
import { loadDashboard } from '../lib/data';
import { relativeTime } from '../lib/format';

type Filter = 'all' | Alert['severity'];

const sevMeta: Record<Alert['severity'], { glyph: string; sevColor: string; tintBg: string; sevLabel: string }> = {
  critical: { glyph: '⛔', sevColor: 'var(--critical-color)', tintBg: 'var(--critical-bg)', sevLabel: 'Kritické' },
  warning: { glyph: '⚠', sevColor: 'var(--warning-color)', tintBg: 'var(--warning-bg)', sevLabel: 'Varovanie' },
  info: { glyph: 'ℹ', sevColor: 'var(--accent-primary)', tintBg: 'var(--accent-soft)', sevLabel: 'Info' },
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [siteName, setSiteName] = useState<Map<string, string>>(new Map());
  const [alertFilter, setAlertFilter] = useState<Filter>('all');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const { alerts, sites } = await loadDashboard();
      if (!active) return;
      setAlerts(alerts);
      setSiteName(new Map(sites.map((s) => [s.id, s.name])));
    })();
    return () => {
      active = false;
    };
  }, [tick]);

  const resolveById = async (id: string) => {
    await supabase.from('alerts').update({ resolved_at: new Date().toISOString() }).eq('id', id);
    setTick((t) => t + 1);
  };

  const allAlerts = alerts.map((a) => {
    const resolved = !!a.resolved_at;
    const m = sevMeta[a.severity] || sevMeta.info;
    return {
      ...a,
      resolved,
      glyph: m.glyph,
      sevColor: m.sevColor,
      tintBg: m.tintBg,
      sevLabel: m.sevLabel,
      siteName: (a.site_id && siteName.get(a.site_id)) || '—',
      time: relativeTime(a.created_at),
      opacity: resolved ? 0.5 : 1,
      resolveLabel: resolved ? '✓ Hotové' : 'Vyriešiť',
      onResolve: resolved ? () => {} : () => resolveById(a.id),
    };
  });

  const filteredAlerts = alertFilter === 'all' ? allAlerts : allAlerts.filter((a) => a.severity === alertFilter);
  const openAlerts = allAlerts.filter((a) => !a.resolved).length;
  const alertStats = `${openAlerts} otvorených`;

  const fpill = (k: Filter) => ({
    bg: alertFilter === k ? 'var(--surface-primary)' : 'transparent',
    color: alertFilter === k ? 'var(--accent-primary)' : 'var(--text-secondary)',
  });

  const alertsPopulated = filteredAlerts.length > 0;
  const alertsEmpty = filteredAlerts.length === 0;

  return (
    <Shell>
      <div style={{ minHeight: '100vh', padding: '32px 24px 64px', background: 'var(--bg-base)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.025em', marginBottom: 6 }}>Alerty</h1>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{alertStats}</div>
          </div>

          {/* Filter pills */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap', background: 'var(--surface-secondary)', padding: 5, borderRadius: 12, width: 'fit-content', maxWidth: '100%' }}>
            <button onClick={() => setAlertFilter('all')} style={{ padding: '7px 15px', background: fpill('all').bg, border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13.5, color: fpill('all').color, fontWeight: 600 }}>Všetky</button>
            <button onClick={() => setAlertFilter('critical')} style={{ padding: '7px 15px', background: fpill('critical').bg, border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13.5, color: fpill('critical').color, fontWeight: 600 }}>Kritické</button>
            <button onClick={() => setAlertFilter('warning')} style={{ padding: '7px 15px', background: fpill('warning').bg, border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13.5, color: fpill('warning').color, fontWeight: 600 }}>Varovania</button>
            <button onClick={() => setAlertFilter('info')} style={{ padding: '7px 15px', background: fpill('info').bg, border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13.5, color: fpill('info').color, fontWeight: 600 }}>Info</button>
          </div>

          {/* Alerts list */}
          {alertsPopulated && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredAlerts.map((alert, i) => (
                <div key={i} className="mx-list-row" style={{ background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius)', padding: '15px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: 'var(--shadow-sm)', opacity: alert.opacity, transition: 'all 0.18s' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: alert.tintBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>{alert.glyph}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{alert.title}</div>
                      <span style={{ fontSize: 11, color: alert.sevColor, background: alert.tintBg, padding: '2px 8px', borderRadius: 20, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{alert.sevLabel}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{alert.siteName} · {alert.time} · <span style={{ fontFamily: "'Geist Mono', monospace", color: 'var(--text-tertiary)' }}>{alert.type}</span></div>
                  </div>
                  <button onClick={alert.onResolve} style={{ padding: '7px 13px', background: 'var(--surface-secondary)', border: '1px solid var(--border-primary)', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontWeight: 600 }}>{alert.resolveLabel}</button>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {alertsEmpty && (
            <div style={{ textAlign: 'center', padding: '72px 20px', background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius)' }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--ok-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 26 }}>✓</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>Žiadne alerty</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Všetko beží tak, ako má.</div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
