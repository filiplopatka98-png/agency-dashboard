'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type PublicSite = { domain: string; status: 'up' | 'down' | 'maintenance'; uptime30: number | null };
type PublicStatus = { client: string; generated_at: string; sites: PublicSite[] } | null;

const STATUS_META: Record<PublicSite['status'], { label: string; color: string; bg: string; dot: string }> = {
  up: { label: 'Dostupný', color: '#16a34a', bg: 'rgba(22,163,74,.1)', dot: '#16a34a' },
  down: { label: 'Nedostupný', color: '#dc2626', bg: 'rgba(220,38,38,.1)', dot: '#dc2626' },
  maintenance: { label: 'Údržba', color: '#6b7280', bg: 'rgba(107,114,128,.12)', dot: '#9ca3af' },
};

export function StatusClient({ slug }: { slug: string }) {
  const [data, setData] = useState<PublicStatus | 'loading' | 'error'>('loading');

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

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f6f7f9', padding: '40px 20px', fontFamily: 'Inter, -apple-system, sans-serif' };
  const cardBox: React.CSSProperties = { maxWidth: 640, margin: '0 auto', background: '#fff', border: '1px solid #eceef1', borderRadius: 16, padding: 'clamp(20px, 4vw, 34px)', boxShadow: '0 1px 3px rgba(0,0,0,.05)' };

  if (data === 'loading') {
    return (
      <main id="main" style={wrap}>
        <div style={cardBox}><div style={{ color: '#6b7280', fontSize: 14 }}>Načítavam stav…</div></div>
      </main>
    );
  }
  if (data === 'error' || data === null) {
    return (
      <main id="main" style={wrap}>
        <div style={{ ...cardBox, textAlign: 'center' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🔍</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111', margin: '0 0 6px' }}>Stránka sa nenašla</h1>
          <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>Tento status link neexistuje alebo bol zrušený.</p>
        </div>
      </main>
    );
  }

  const sites = data.sites ?? [];
  const allUp = sites.length > 0 && sites.every((s) => s.status === 'up');
  const anyDown = sites.some((s) => s.status === 'down');
  const overall = anyDown
    ? { label: 'Niektoré weby sú nedostupné', color: '#dc2626', bg: 'rgba(220,38,38,.08)' }
    : allUp
      ? { label: 'Všetky systémy v prevádzke', color: '#16a34a', bg: 'rgba(22,163,74,.08)' }
      : { label: 'Prevádzka s výnimkami', color: '#6b7280', bg: 'rgba(107,114,128,.08)' };

  return (
    <main id="main" style={wrap}>
      <div style={cardBox}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.4px', color: '#9ca3af' }}>MONITORIX · STAV WEBOV</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', margin: '4px 0 0', letterSpacing: '-0.02em' }}>{data.client}</h1>
          </div>
        </div>

        <div style={{ background: overall.bg, color: overall.color, fontWeight: 700, fontSize: 15, padding: '14px 16px', borderRadius: 12, marginBottom: 20 }}>
          {overall.label}
        </div>

        {sites.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>Žiadne monitorované weby.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sites.map((s) => {
              const m = STATUS_META[s.status];
              return (
                <div key={s.domain} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', border: '1px solid #eceef1', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: '#111', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.domain}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>
                    {s.status !== 'maintenance' && s.uptime30 != null && (
                      <span style={{ fontSize: 12.5, color: '#6b7280', fontFamily: "'Geist Mono', monospace" }}>{Number(s.uptime30).toFixed(2)} % / 30 d</span>
                    )}
                    <span style={{ fontSize: 12, fontWeight: 700, color: m.color, background: m.bg, padding: '4px 11px', borderRadius: 20 }}>{m.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid #f0f1f3', fontSize: 12, color: '#9ca3af', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>Aktualizované {new Date(data.generated_at).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span>Poháňa Monitorix</span>
        </div>
      </div>
    </main>
  );
}
