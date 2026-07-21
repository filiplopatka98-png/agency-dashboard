'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';

type DaySeg = { d: string; u: number | null };
type PublicIncident = { started_at: string; minutes: number };
type PublicVigilance = { checks: number; uptime_pct: number | null } | null;
type PublicSite = {
  domain: string;
  status: 'up' | 'down' | 'maintenance';
  uptime30: number | null;
  history?: DaySeg[];
  vigilance?: PublicVigilance;
  incidents?: PublicIncident[];
};
type PublicStatus = { client: string; generated_at: string; sites: PublicSite[] } | null;

// Farba dennej kocky — rovnaké prahy ako interný segColor (>=99.5 ok, >=95 warn, inak crit).
// CSS tokeny → light aj dark automaticky (rovnaký systém ako zvyšok appky).
function dayColor(u: number | null): string {
  if (u === null) return 'var(--border-strong)';
  if (u >= 99.5) return 'var(--ok-color)';
  if (u >= 95) return 'var(--warning-color)';
  return 'var(--critical-color)';
}
const fmtDay = (d: string) => {
  const [y, m, dd] = d.split('-');
  return `${Number(dd)}. ${Number(m)}. ${y}`;
};

const fmtIncident = (i: PublicIncident) => {
  const d = new Date(i.started_at);
  const date = d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' });
  const time = d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
  const m = Math.round(i.minutes);
  return `${date} o ${time} — výpadok ${m} ${m === 1 ? 'minúta' : m < 5 ? 'minúty' : 'minút'}, vyriešené`;
};

const STATUS_META: Record<PublicSite['status'], { label: string; color: string; bg: string; dot: string }> = {
  up: { label: 'Dostupný', color: 'var(--ok-color)', bg: 'var(--ok-bg)', dot: 'var(--ok-color)' },
  down: { label: 'Nedostupný', color: 'var(--critical-color)', bg: 'var(--critical-bg)', dot: 'var(--critical-color)' },
  maintenance: { label: 'Údržba', color: 'var(--text-secondary)', bg: 'var(--surface-secondary)', dot: 'var(--unknown-color)' },
};

export function StatusClient({ slug }: { slug: string }) {
  const [data, setData] = useState<PublicStatus | 'loading' | 'error'>('loading');
  const { theme, toggle } = useTheme();

  // Malý prepínač témy — verejná stránka nemá hlavičku appky, takže klient si
  // vie prepnúť motív aj tu (nad rámec automatiky podľa OS preferencie).
  const themeToggle = (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Prepnúť na svetlý režim' : 'Prepnúť na tmavý režim'}
      style={{
        width: 34,
        height: 34,
        flexShrink: 0,
        borderRadius: 9,
        border: '1px solid var(--border-primary)',
        background: 'var(--surface-secondary)',
        color: 'var(--text-secondary)',
        fontSize: 15,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );

  useEffect(() => {
    let active = true;
    (async () => {
      // RPC nie je v generovaných typoch → cielený cast.
      const { data: res, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: PublicStatus; error: unknown }>)('public_client_status', { p_slug: slug });
      if (!active) return;
      if (error || !res) setData(res === null && !error ? null : 'error');
      else setData(res);
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--bg-base)', padding: '40px 20px', fontFamily: 'Inter, -apple-system, sans-serif' };
  const cardBox: React.CSSProperties = { maxWidth: 640, margin: '0 auto', background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', borderRadius: 16, padding: 'clamp(20px, 4vw, 34px)', boxShadow: 'var(--shadow-sm)' };

  if (data === 'loading') {
    return (
      <main id="main" style={wrap}>
        <div style={cardBox}><div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Načítavam stav…</div></div>
      </main>
    );
  }
  if (data === 'error' || data === null) {
    return (
      <main id="main" style={wrap}>
        <div style={{ ...cardBox, textAlign: 'center' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🔍</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>Stránka sa nenašla</h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>Tento status link neexistuje alebo bol zrušený.</p>
        </div>
      </main>
    );
  }

  const sites = data.sites ?? [];
  const allUp = sites.length > 0 && sites.every((s) => s.status === 'up');
  const anyDown = sites.some((s) => s.status === 'down');
  const overall = anyDown
    ? { label: 'Niektoré weby sú nedostupné', color: 'var(--critical-color)', bg: 'var(--critical-bg)' }
    : allUp
      ? { label: 'Všetky systémy v prevádzke', color: 'var(--ok-color)', bg: 'var(--ok-bg)' }
      : { label: 'Prevádzka s výnimkami', color: 'var(--text-secondary)', bg: 'var(--surface-secondary)' };

  return (
    <main id="main" style={wrap}>
      <div style={cardBox}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.4px', color: 'var(--text-tertiary)' }}>MONITORIX · STAV WEBOV</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: '4px 0 0', letterSpacing: '-0.02em' }}>{data.client}</h1>
          </div>
          {themeToggle}
        </div>

        <div style={{ background: overall.bg, color: overall.color, fontWeight: 700, fontSize: 15, padding: '14px 16px', borderRadius: 12, marginBottom: 20 }}>
          {overall.label}
        </div>

        {sites.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>Žiadne monitorované weby.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sites.map((s) => {
              const m = STATUS_META[s.status];
              const hist = (s.history ?? []).slice(-90);
              return (
                <div key={s.domain} style={{ padding: '14px 16px', border: '1px solid var(--border-primary)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.domain}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>
                      {s.status !== 'maintenance' && s.uptime30 != null && (
                        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontFamily: "'Geist Mono', monospace" }}>{Number(s.uptime30).toFixed(2)} % / 30 d</span>
                      )}
                      <span style={{ fontSize: 12, fontWeight: 700, color: m.color, background: m.bg, padding: '4px 11px', borderRadius: 20 }}>{m.label}</span>
                    </div>
                  </div>
                  {hist.length > 0 && (
                    <>
                      <div style={{ display: 'flex', gap: 2, marginTop: 12, height: 26, alignItems: 'stretch' }}>
                        {hist.map((day) => (
                          <span
                            key={day.d}
                            title={`${fmtDay(day.d)} — ${day.u == null ? 'bez dát' : `${Number(day.u).toFixed(2)} %`}`}
                            style={{ flex: 1, minWidth: 3, borderRadius: 2, background: dayColor(day.u) }}
                          />
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10.5, color: 'var(--text-tertiary)' }}>
                        <span>pred {hist.length} {hist.length === 1 ? 'dňom' : hist.length < 5 ? 'dňami' : 'dňami'}</span>
                        <span>dnes</span>
                      </div>
                    </>
                  )}
                  {s.vigilance && s.vigilance.checks > 0 && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                      Za 90 dní {s.vigilance.checks.toLocaleString('sk-SK').replace(/ /g, ' ')} kontrol dostupnosti
                      {s.vigilance.uptime_pct != null ? ` · ${Number(s.vigilance.uptime_pct).toFixed(2)} % dostupnosť` : ''}
                    </div>
                  )}
                  {(s.incidents?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-primary)' }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>História výpadkov (90 dní)</div>
                      {s.incidents!.slice(0, 10).map((i, idx) => (
                        <div key={idx} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '3px 0' }}>{fmtIncident(i)}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border-primary)', fontSize: 12, color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>Aktualizované {new Date(data.generated_at).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span>Poháňa Monitorix</span>
        </div>
      </div>
    </main>
  );
}
