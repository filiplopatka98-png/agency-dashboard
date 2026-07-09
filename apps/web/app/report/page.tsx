'use client';

import { Shell } from '../components/Shell';

/** Screen 6 — Mesačný report (fáza 4, mock dáta z predlohy). */

const reportMonth = 'Január 2025';
const clientNameReport = 'Klient A';
const reportDate = '1. 2. 2025';

export default function ReportPage() {
  return (
    <Shell>
      <div style={{ minHeight: '100vh', padding: '48px 24px 64px', background: 'var(--bg-base)' }}>
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto',
            background: 'var(--surface-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-md)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '28px 32px',
              borderBottom: '1px solid var(--border-primary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                Mesačná správa
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  color: 'var(--text-primary)',
                }}
              >
                {reportMonth}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                {clientNameReport} · healthy.sk
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: 13,
                }}
              >
                ◈
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                Monitorix
              </span>
            </div>
          </div>

          <div style={{ padding: '28px 32px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 14,
                marginBottom: 28,
              }}
            >
              <div style={{ background: 'var(--ok-bg)', borderRadius: 12, padding: 16 }}>
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                    marginBottom: 8,
                  }}
                >
                  Uptime
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    fontFamily: "'Geist Mono', monospace",
                    color: 'var(--ok-color)',
                  }}
                >
                  99.8%
                </div>
              </div>
              <div style={{ background: 'var(--surface-secondary)', borderRadius: 12, padding: 16 }}>
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                    marginBottom: 8,
                  }}
                >
                  Incidenty
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    fontFamily: "'Geist Mono', monospace",
                    color: 'var(--text-primary)',
                  }}
                >
                  1
                </div>
              </div>
              <div style={{ background: 'var(--surface-secondary)', borderRadius: 12, padding: 16 }}>
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                    marginBottom: 8,
                  }}
                >
                  Updaty
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    fontFamily: "'Geist Mono', monospace",
                    color: 'var(--text-primary)',
                  }}
                >
                  4
                </div>
              </div>
            </div>

            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 12,
              }}
            >
              Vykonané aktualizácie
            </div>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 28 }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ color: 'var(--ok-color)' }}>✓</span> WordPress 6.4.1 → 6.4.2
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ color: 'var(--ok-color)' }}>✓</span> Yoast SEO 21.8 → 22.0
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ color: 'var(--ok-color)' }}>✓</span> WooCommerce 8.2.1 → 8.2.2
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ color: 'var(--ok-color)' }}>✓</span> Bezpečnostný patch aplikovaný
              </div>
            </div>

            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 10,
              }}
            >
              Zhrnutie
            </div>
            <p
              style={{
                fontSize: 13.5,
                color: 'var(--text-secondary)',
                lineHeight: 1.65,
                marginBottom: 4,
              }}
            >
              Váš web bol počas {reportMonth} dostupný 99,8 % času. Vykonali sme všetky plánované
              aktualizácie bez výpadkov. Zaznamenali sme jeden kratší incident (8 minút), po ktorom
              sa web automaticky obnovil. Výkon sa medzimesačne zlepšil — CLS skóre kleslo o 0,02
              bodu.
            </p>
          </div>

          <div
            style={{
              padding: '18px 32px',
              borderTop: '1px solid var(--border-primary)',
              background: 'var(--surface-secondary)',
              fontSize: 12,
              color: 'var(--text-tertiary)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>Monitorix · {reportDate}</span>
            <span>Vygenerované automaticky</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}
