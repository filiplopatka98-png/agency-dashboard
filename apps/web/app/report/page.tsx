'use client';

import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../components/Shell';
import {
  loadClientReportPreview,
  loadReportClientOptions,
  periodForMonthValue,
  previousMonthValue,
  type ClientReportPreview,
  type ReportClientOption,
} from '../lib/reportPreview';

const card = {
  background: 'var(--surface-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-md)',
} as const;
const mono = { fontFamily: "'Geist Mono', monospace", fontVariantNumeric: 'tabular-nums' } as const;
const selectStyle: React.CSSProperties = {
  padding: '9px 12px',
  background: 'var(--bg-base)',
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontSize: 13.5,
};

export default function ReportPage() {
  const [clientOptions, setClientOptions] = useState<ReportClientOption[] | null>(null);
  const [clientId, setClientId] = useState('');
  const [ym, setYm] = useState(previousMonthValue());
  const [preview, setPreview] = useState<ClientReportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);

  // Zoznam klientov — raz pri načítaní.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const opts = await loadReportClientOptions();
        if (!active) return;
        setClientOptions(opts);
        if (opts.length > 0) setClientId(opts[0]!.id);
        else setLoading(false);
      } catch (e) {
        if (!active) return;
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const period = useMemo(() => periodForMonthValue(ym), [ym]);

  // Náhľad — prehráva sa vždy, keď sa zmení klient alebo obdobie.
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await loadClientReportPreview(clientId, period);
        if (!active) return;
        setPreview(r);
      } catch (e) {
        if (!active) return;
        setErr(e instanceof Error ? e.message : String(e));
        setPreview(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [clientId, period]);

  return (
    <Shell>
      <div style={{ minHeight: '100vh', padding: '32px 24px 64px', background: 'var(--bg-base)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', marginBottom: 4 }}>Náhľad klientskeho reportu</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Presne to, čo klientovi odíde mailom 1. dňa v mesiaci — rovnaký renderer (
              <span style={mono}>@agency/core</span>), rovnaké dáta. Žiadne vzorové čísla.
            </p>
          </div>

          <div style={{ ...card, padding: 16, marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              Klient
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={selectStyle} disabled={!clientOptions || clientOptions.length === 0}>
                {(clientOptions ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.hasReportEmail ? '' : ' (bez report_email)'}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              Obdobie
              <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} style={selectStyle} />
            </label>
            {clientOptions && clientOptions.length === 0 && (
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Žiadny aktívny klient na výber.</span>
            )}
          </div>

          {err && (
            <div style={{ ...card, padding: 16, marginBottom: 20, borderColor: 'var(--critical-border)', color: 'var(--critical-color)', fontSize: 13.5 }}>
              Náhľad sa nepodarilo zostaviť: {err}
            </div>
          )}

          {loading && !err && (
            <div style={{ ...card, padding: 32, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13.5 }}>Zostavujem náhľad…</div>
          )}

          {!loading && preview && (
            <>
              <div style={{ ...card, padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }}>Predmet</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{preview.subject}</div>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {preview.clientLabel} · {preview.siteCount} {preview.siteCount === 1 ? 'web' : preview.siteCount >= 2 && preview.siteCount <= 4 ? 'weby' : 'webov'}
                </div>
              </div>

              {preview.siteCount === 0 ? (
                <div style={{ ...card, padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13.5 }}>
                  Tento klient nemá žiadny aktívny web — reálny report by mu neodišiel.
                </div>
              ) : (
                <div style={{ ...card, overflow: 'hidden' }}>
                  <iframe
                    title="Náhľad e-mailu"
                    srcDoc={preview.html}
                    sandbox=""
                    style={{ width: '100%', minHeight: 640, border: 'none', background: '#fff' }}
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowText((v) => !v)}
                style={{ marginTop: 16, padding: '8px 14px', background: 'var(--surface-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
              >
                {showText ? 'Skryť textovú verziu' : 'Zobraziť textovú verziu (fallback bez HTML)'}
              </button>
              {showText && (
                <pre style={{ ...card, ...mono, marginTop: 12, padding: 18, fontSize: 12.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{preview.text}</pre>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
