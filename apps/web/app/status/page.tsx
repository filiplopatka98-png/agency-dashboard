'use client';

import { Shell } from '../components/Shell';

/** Screen 5 — verejná Status page (fáza 4, mock dáta z predlohy). */

const statusPageTitle = 'Zdravý web';

const statusPageUptimeBars = Array.from({ length: 90 }, (_, i) => ({
  color: i % 13 === 0 ? 'var(--warning-color)' : 'var(--ok-color)',
  date: `${i + 1}. deň`,
  uptime: i % 13 === 0 ? 97 : 100,
}));

export default function StatusPage() {
  return (
    <Shell>
      <div style={{ minHeight: '100vh', padding: '48px 24px 64px', background: 'var(--bg-base)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              justifyContent: 'center',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius)',
                background: 'var(--accent-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: 15,
              }}
            >
              ◈
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: 'var(--text-primary)',
              }}
            >
              {statusPageTitle}
            </div>
          </div>
          <div
            style={{
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--text-tertiary)',
              marginBottom: 32,
            }}
          >
            Verejná status stránka
          </div>

          <div
            style={{
              background: 'var(--ok-bg)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius)',
              padding: 26,
              marginBottom: 20,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: 'var(--ok-color)',
                }}
              ></div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.02em',
                }}
              >
                Všetky systémy fungujú
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Posledná kontrola pred 2 minútami
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 14,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
                padding: 18,
                textAlign: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  fontFamily: "'Geist Mono', monospace",
                  color: 'var(--ok-color)',
                }}
              >
                99.9%
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                Uptime 30d
              </div>
            </div>
            <div
              style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
                padding: 18,
                textAlign: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  fontFamily: "'Geist Mono', monospace",
                  color: 'var(--text-primary)',
                }}
              >
                1
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                Incident (30d)
              </div>
            </div>
            <div
              style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius)',
                padding: 18,
                textAlign: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  fontFamily: "'Geist Mono', monospace",
                  color: 'var(--text-primary)',
                }}
              >
                145
                <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>ms</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                Odozva
              </div>
            </div>
          </div>

          <div
            style={{
              background: 'var(--surface-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius)',
              padding: 20,
              marginBottom: 20,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                Uptime za 90 dní
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ok-color)', fontWeight: 600 }}>
                99.9% dostupnosť
              </div>
            </div>
            <div style={{ display: 'flex', gap: 2, height: 34 }}>
              {statusPageUptimeBars.map((bar, i) => (
                <div
                  key={i}
                  style={{ flex: 1, background: bar.color, borderRadius: 2 }}
                  title={`${bar.date}: ${bar.uptime}%`}
                ></div>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 8,
                fontSize: 11.5,
                color: 'var(--text-tertiary)',
              }}
            >
              <span>pred 90 dňami</span>
              <span>dnes</span>
            </div>
          </div>

          <div
            style={{
              background: 'var(--surface-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius)',
              padding: 20,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 14,
              }}
            >
              História incidentov
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--border-primary)',
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--warning-color)',
                    marginTop: 5,
                    flexShrink: 0,
                  }}
                ></div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Krátky výpadok · vyriešené
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    15. 1. 2025 · trvanie 8 min
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--ok-color)',
                    marginTop: 5,
                    flexShrink: 0,
                  }}
                ></div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Plánovaná údržba · dokončené
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    2. 1. 2025 · trvanie 20 min
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              textAlign: 'center',
              marginTop: 28,
              fontSize: 12,
              color: 'var(--text-tertiary)',
            }}
          >
            Monitoring zabezpečuje{' '}
            <strong style={{ color: 'var(--text-secondary)' }}>Monitorix</strong>
          </div>
        </div>
      </div>
    </Shell>
  );
}
