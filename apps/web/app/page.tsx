'use client';

import { useEffect, useState } from 'react';
import { Shell } from './components/Shell';
import { loadDashboard, type SiteVM } from './lib/data';
import { supabase, type Client } from './lib/supabase';

const RANK: Record<SiteVM['statusKey'], number> = { down: 0, degraded: 1, maintenance: 2, unknown: 3, up: 4 };

export default function OverviewPage() {
  const [sites, setSites] = useState<SiteVM[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [showAddSite, setShowAddSite] = useState(false);
  const [addName, setAddName] = useState('');
  const [addDomain, setAddDomain] = useState('');
  const [addClient, setAddClient] = useState('');
  const [addCms, setAddCms] = useState<'wordpress' | 'static' | 'other'>('wordpress');
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  const reload = async () => {
    const { sites, clients } = await loadDashboard();
    setSites(sites);
    setClients(clients);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [dash, mem] = await Promise.all([loadDashboard(), supabase.from('memberships').select('org_id').limit(1).maybeSingle()]);
        if (!active) return;
        setSites(dash.sites);
        setClients(dash.clients);
        setOrgId(mem.data?.org_id ?? null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // — odvodené hodnoty —
  const sorted = [...sites].sort((a, b) => RANK[a.statusKey] - RANK[b.statusKey]);

  const countUp = sites.filter((s) => s.statusKey === 'up').length;
  const countDegraded = sites.filter((s) => s.statusKey === 'degraded').length;
  const countDown = sites.filter((s) => s.statusKey === 'down').length;
  const countUnknown = sites.filter((s) => s.statusKey === 'unknown').length;
  const countDownColor = countDown > 0 ? 'var(--critical-color)' : 'var(--text-primary)';

  const filtered = sorted.filter((s) => {
    if (clientFilter && s.clientId !== clientFilter) return false;
    if (statusFilter && s.statusKey !== statusFilter) return false;
    return true;
  });

  const attentionSites = filtered.filter(
    (s) =>
      s.statusKey === 'down' ||
      s.statusKey === 'degraded' ||
      (s.hasExpiry && s.expiryIssues.some((e) => e.color === 'var(--critical-color)')),
  );
  const hasAttention = attentionSites.length > 0;
  const attentionCount = attentionSites.length;

  const summaryText = `${sites.length} webov · ${countUp} dostupných · ${countDown} nedostupných`;

  const isLoading = loading;
  const sitesEmpty = !loading && sites.length === 0;
  const sitesPopulated = !loading && sites.length > 0;

  // region banner — ponechané, ale skryté
  const hasRegionOutage = false;
  const outageMessage = '3 z 25 webov nedostupné — možný regionálny výpadok';

  // — akcie —
  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };
  const openAddSite = () => {
    setAddName('');
    setAddDomain('');
    setAddClient('');
    setAddCms('wordpress');
    setAddErr(null);
    setShowAddSite(true);
  };
  const closeAddSite = () => setShowAddSite(false);
  const submitAddSite = async () => {
    const name = addName.trim();
    const domain = addDomain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
    if (!name || !domain) {
      setAddErr('Vyplň názov aj doménu.');
      return;
    }
    if (!orgId) {
      setAddErr('Organizácia sa nenačítala — obnov stránku.');
      return;
    }
    setAddBusy(true);
    setAddErr(null);
    const { error } = await supabase.from('sites').insert({
      org_id: orgId,
      client_id: addClient || null,
      name,
      url: `https://${domain}`,
      domain,
      cms: addCms,
      is_active: true,
    });
    setAddBusy(false);
    if (error) {
      setAddErr(`Pridanie zlyhalo: ${error.message}`);
      return;
    }
    setShowAddSite(false);
    showToast(`Web pridaný · ${name}`);
    await reload();
  };

  return (
    <Shell>
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1200,
            background: 'var(--text-primary)',
            color: 'var(--bg-base)',
            padding: '12px 20px',
            borderRadius: '12px',
            fontSize: '13.5px',
            fontWeight: 600,
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            animation: 'slideIn 0.25s ease',
          }}
        >
          <span style={{ color: 'var(--ok-color)' }}>✓</span>
          {toast}
        </div>
      )}

      {/* Add site modal */}
      {showAddSite && (
        <div
          onClick={closeAddSite}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            background: 'rgba(10,14,20,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            animation: 'slideIn 0.2s ease',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '18px',
              boxShadow: 'var(--shadow-lg)',
              width: '100%',
              maxWidth: '440px',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
              <div style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                Pridať web
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Nový web sa začne monitorovať pri prvej kontrole.
              </div>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: '7px',
                  }}
                >
                  Názov webu
                </label>
                <input
                  type="text"
                  value={addName}
                  onInput={(e) => setAddName((e.target as HTMLInputElement).value)}
                  placeholder="napr. Firemný web"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '10px',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: '7px',
                  }}
                >
                  Doména
                </label>
                <input
                  type="text"
                  value={addDomain}
                  onInput={(e) => setAddDomain((e.target as HTMLInputElement).value)}
                  placeholder="napr. firma.sk"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '10px',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    fontFamily: "'Geist Mono', monospace",
                    outline: 'none',
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: '7px',
                  }}
                >
                  Klient
                </label>
                <select
                  value={addClient}
                  onChange={(e) => setAddClient(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '10px',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">Bez klienta</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '7px' }}>Typ webu (CMS)</label>
                <select value={addCms} onChange={(e) => setAddCms(e.target.value as 'wordpress' | 'static' | 'other')} style={{ width: '100%', padding: '11px 14px', background: 'var(--bg-base)', border: '1px solid var(--border-primary)', borderRadius: '10px', color: 'var(--text-primary)', fontSize: '14px', cursor: 'pointer' }}>
                  <option value="wordpress">WordPress</option>
                  <option value="static">Statický</option>
                  <option value="other">Iné</option>
                </select>
              </div>
              {addErr && <div style={{ fontSize: '13px', color: 'var(--critical-color)', background: 'var(--critical-bg)', padding: '9px 13px', borderRadius: '10px' }}>{addErr}</div>}
            </div>
            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--border-primary)',
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-end',
                background: 'var(--surface-secondary)',
              }}
            >
              <button
                onClick={closeAddSite}
                style={{
                  padding: '10px 16px',
                  background: 'var(--surface-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                }}
              >
                Zrušiť
              </button>
              <button
                onClick={submitAddSite}
                disabled={addBusy}
                style={{
                  padding: '10px 18px',
                  background: 'var(--accent-primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  opacity: addBusy ? 0.6 : 1,
                }}
              >
                {addBusy ? 'Pridávam…' : 'Pridať web'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screen 1: Overview */}
      <div style={{ minHeight: '100vh', padding: '32px 24px 64px', background: 'var(--bg-base)' }}>
        <div style={{ maxWidth: '1320px', margin: '0 auto' }}>
          {/* Region outage banner (conditional) */}
          {hasRegionOutage && (
            <div
              style={{
                background: 'var(--warning-bg)',
                border: '1px solid var(--warning-border)',
                borderRadius: 'var(--radius)',
                padding: '14px 18px',
                marginBottom: '24px',
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '20px' }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>
                  Možný výpadok monitoringu
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{outageMessage}</div>
              </div>
            </div>
          )}

          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: '16px',
              flexWrap: 'wrap',
              marginBottom: '28px',
            }}
          >
            <div>
              <h1 style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-0.025em', marginBottom: '6px' }}>
                Prehľad
              </h1>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{summaryText}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                style={{
                  padding: '9px 14px',
                  background: 'var(--surface-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '13.5px',
                  cursor: 'pointer',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <option value="">Všetci klienti</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: '9px 14px',
                  background: 'var(--surface-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '13.5px',
                  cursor: 'pointer',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <option value="">Všetky stavy</option>
                <option value="up">Dostupné</option>
                <option value="degraded">Degradované</option>
                <option value="down">Nedostupné</option>
                <option value="unknown">Nezistené</option>
              </select>
            </div>
          </div>

          {/* Summary stat tiles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '16px',
              marginBottom: '32px',
            }}
          >
            <div
              style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
                padding: '20px',
                boxShadow: 'var(--shadow-sm)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: 'var(--ok-color)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--ok-color)' }} />
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Dostupné
                </span>
              </div>
              <div
                style={{
                  fontSize: '40px',
                  fontWeight: 800,
                  fontFamily: "'Geist Mono', monospace",
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text-primary)',
                  lineHeight: 1,
                }}
              >
                {countUp}
              </div>
            </div>
            <div
              style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
                padding: '20px',
                boxShadow: 'var(--shadow-sm)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: 'var(--warning-color)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--warning-color)' }} />
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Degradované
                </span>
              </div>
              <div
                style={{
                  fontSize: '40px',
                  fontWeight: 800,
                  fontFamily: "'Geist Mono', monospace",
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text-primary)',
                  lineHeight: 1,
                }}
              >
                {countDegraded}
              </div>
            </div>
            <div
              style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
                padding: '20px',
                boxShadow: 'var(--shadow-sm)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: 'var(--critical-color)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--critical-color)' }} />
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Nedostupné
                </span>
              </div>
              <div
                style={{
                  fontSize: '40px',
                  fontWeight: 800,
                  fontFamily: "'Geist Mono', monospace",
                  fontVariantNumeric: 'tabular-nums',
                  color: countDownColor,
                  lineHeight: 1,
                }}
              >
                {countDown}
              </div>
            </div>
            <div
              style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
                padding: '20px',
                boxShadow: 'var(--shadow-sm)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: 'var(--unknown-color)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--unknown-color)' }} />
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Nezistené
                </span>
              </div>
              <div
                style={{
                  fontSize: '40px',
                  fontWeight: 800,
                  fontFamily: "'Geist Mono', monospace",
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text-primary)',
                  lineHeight: 1,
                }}
              >
                {countUnknown}
              </div>
            </div>
          </div>

          {/* Attention section */}
          {hasAttention && (
            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                  Vyžaduje pozornosť
                </h2>
                <span
                  style={{
                    background: 'var(--critical-bg)',
                    color: 'var(--critical-color)',
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '2px 9px',
                    borderRadius: '20px',
                    fontFamily: "'Geist Mono', monospace",
                  }}
                >
                  {attentionCount}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '14px' }}>
                {attentionSites.map((site) => (
                  <div
                    key={site.id}
                    className="mx-card-soft"
                    onClick={() => { window.location.href = `/sites?id=${site.id}`; }}
                    style={{
                      background: site.tintBg,
                      border: '1px solid var(--border-primary)',
                      borderLeft: `4px solid ${site.dotColor}`,
                      borderRadius: 'var(--radius)',
                      padding: '16px 18px',
                      cursor: 'pointer',
                      transition: 'all 0.18s',
                      boxShadow: 'var(--shadow-sm)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                    }}
                  >
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: site.dotColor, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: '14.5px',
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {site.name}
                      </div>
                      <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {site.statusLabel} · {site.lastCheckTime}
                      </div>
                    </div>
                    {site.hasExpiry && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {site.expiryIssues.map((issue, i) => (
                          <div
                            key={i}
                            style={{
                              background: issue.color,
                              color: 'white',
                              padding: '3px 9px',
                              borderRadius: '6px',
                              fontWeight: 600,
                              fontSize: '11.5px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {issue.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  style={{
                    background: 'var(--surface-primary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 'var(--radius)',
                    padding: '18px',
                    height: '190px',
                  }}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {sitesEmpty && (
            <div
              style={{
                textAlign: 'center',
                padding: '72px 20px',
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div style={{ fontSize: '34px', marginBottom: '12px' }}>📭</div>
              <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
                Zatiaľ žiadne weby
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '18px' }}>
                Pridaj svoj prvý web na monitoring.
              </div>
              <button
                onClick={openAddSite}
                style={{
                  padding: '11px 18px',
                  background: 'var(--accent-primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '14px',
                }}
              >
                + Pridať web
              </button>
            </div>
          )}

          {/* All sites grid */}
          {sitesPopulated && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '12px' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Všetky weby</h2>
                <button
                  onClick={openAddSite}
                  style={{ padding: '9px 16px', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '13.5px', fontWeight: 600, whiteSpace: 'nowrap' }}
                >
                  + Pridať web
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                {filtered.map((site) => (
                  <div
                    key={site.id}
                    className="mx-card"
                    onClick={() => { window.location.href = `/sites?id=${site.id}`; }}
                    style={{
                      background: 'var(--surface-primary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 'var(--radius)',
                      padding: '18px',
                      cursor: 'pointer',
                      transition: 'all 0.18s',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    {/* Status indicator + name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '11px', marginBottom: '16px' }}>
                      <div
                        className={site.pulseClass}
                        style={{
                          width: '11px',
                          height: '11px',
                          borderRadius: '50%',
                          background: site.dotColor,
                          flexShrink: 0,
                          boxShadow: `0 0 0 4px ${site.tintBg}`,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '14.5px',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            letterSpacing: '-0.01em',
                          }}
                        >
                          {site.name}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-tertiary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            marginTop: '1px',
                          }}
                        >
                          {site.domain}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 600,
                          color: site.dotColor,
                          background: site.tintBg,
                          padding: '3px 9px',
                          borderRadius: '7px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {site.statusShort}
                      </span>
                    </div>

                    {/* Big uptime figure */}
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <div>
                        <span
                          style={{
                            fontSize: '26px',
                            fontWeight: 800,
                            fontFamily: "'Geist Mono', monospace",
                            fontVariantNumeric: 'tabular-nums',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {site.uptimeDisplay}
                        </span>
                        <span style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginLeft: '6px' }}>uptime 30d</span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>{site.lastCheckTime}</div>
                    </div>

                    {/* Uptime bar (30d) */}
                    <div style={{ display: 'flex', gap: '2px', height: '26px', borderRadius: '6px', overflow: 'hidden', marginBottom: '14px' }}>
                      {site.uptimeSegments.map((segment, i) => (
                        <div
                          key={i}
                          style={{ flex: 1, background: segment.color }}
                          title={`${segment.date}: ${segment.value === null ? 'nezistené' : `${segment.value}%`}`}
                        />
                      ))}
                    </div>

                    {/* Quick badges */}
                    {site.hasExpiry && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {site.expiryIssues.map((issue, i) => (
                          <div
                            key={i}
                            style={{
                              background: issue.color,
                              color: 'white',
                              padding: '3px 9px',
                              borderRadius: '6px',
                              fontWeight: 600,
                              fontSize: '11.5px',
                            }}
                          >
                            {issue.label}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Napojenie integrácií */}
                    <div style={{ marginTop: '10px', fontSize: '11.5px' }}>
                      {site.pendingIntegrations.length === 0 ? (
                        <span style={{ color: 'var(--ok-color)', fontWeight: 600 }}>✓ Všetko napojené</span>
                      ) : (
                        <span style={{ color: 'var(--warning-color)', fontWeight: 600, background: 'var(--warning-bg)', padding: '3px 9px', borderRadius: '6px', display: 'inline-block' }}>
                          ⚠ Chýba napojiť: {site.pendingIntegrations.join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
