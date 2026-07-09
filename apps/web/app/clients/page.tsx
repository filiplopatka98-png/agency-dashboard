'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { loadDashboard, type SiteVM } from '../lib/data';
import { type Client } from '../lib/supabase';

interface ClientCard {
  id: string;
  initial: string;
  name: string;
  tier: string | null;
  fee: string;
  status: string;
  statusColor: string;
  statusBg: string;
  sites: number;
}

function statusMeta(status: string): { text: string; color: string; bg: string } {
  switch (status) {
    case 'paused':
      return { text: 'Pozastavený', color: 'var(--warning-color)', bg: 'var(--warning-bg)' };
    case 'archived':
      return { text: 'Archivovaný', color: 'var(--text-tertiary)', bg: 'var(--surface-secondary)' };
    case 'active':
    default:
      return { text: 'Aktívny', color: 'var(--ok-color)', bg: 'var(--ok-bg)' };
  }
}

function buildClientList(clients: Client[], sites: SiteVM[]): ClientCard[] {
  return clients.map((c) => {
    const meta = statusMeta(c.status);
    return {
      id: c.id,
      initial: (c.name.trim().charAt(0) || '?').toUpperCase(),
      name: c.name,
      tier: c.contract_type ?? null,
      fee: c.monthly_fee_eur != null ? `${c.monthly_fee_eur} €` : '—',
      status: meta.text,
      statusColor: meta.color,
      statusBg: meta.bg,
      sites: sites.filter((s) => s.clientId === c.id).length,
    };
  });
}

function ClientsView() {
  const [clientList, setClientList] = useState<ClientCard[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { clients, sites } = await loadDashboard();
      if (!active) return;
      setClientList(buildClientList(clients, sites));
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px 64px', background: 'var(--bg-base)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.025em', marginBottom: 6 }}>
          Klienti
        </h1>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 22 }}>
          Prehľad zmlúv a priradených webov
        </div>

        {clientList === null ? (
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Načítavam…</div>
        ) : clientList.length === 0 ? (
          <div
            style={{
              background: 'var(--surface-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius)',
              padding: '48px 18px',
              boxShadow: 'var(--shadow-sm)',
              textAlign: 'center',
              fontSize: 14,
              color: 'var(--text-tertiary)',
            }}
          >
            Zatiaľ žiadni klienti
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 16,
            }}
          >
            {clientList.map((c) => (
              <div
                key={c.id}
                className="mx-card-soft"
                style={{
                  background: 'var(--surface-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius)',
                  padding: 18,
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 11,
                      background: 'var(--accent-soft)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      fontWeight: 800,
                      color: 'var(--accent-primary)',
                      fontFamily: "'Geist Mono', monospace",
                    }}
                  >
                    {c.initial}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                      {c.tier ? `${c.tier} · ` : ''}
                      {c.fee}/mes
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: c.statusColor,
                      background: c.statusBg,
                      padding: '3px 10px',
                      borderRadius: 20,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.status}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: 14,
                    borderTop: '1px solid var(--border-primary)',
                  }}
                >
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    Webov v správe
                  </span>
                  <span
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      fontFamily: "'Geist Mono', monospace",
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {c.sites}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Shell>
      <ClientsView />
    </Shell>
  );
}
