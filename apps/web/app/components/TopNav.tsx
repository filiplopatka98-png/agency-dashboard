'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

const NAV = [
  { href: '/', label: 'Prehľad', icon: '▦', primary: true, match: (p: string) => p === '/' },
  { href: '/sites', label: 'Weby', icon: '◱', primary: true, match: (p: string) => p.startsWith('/sites') },
  { href: '/clients', label: 'Klienti', icon: '☺', primary: true, match: (p: string) => p.startsWith('/clients') },
  { href: '/alerts', label: 'Alerty', icon: '◉', primary: true, badge: true, match: (p: string) => p.startsWith('/alerts') },
  { href: '/status', label: 'Status page', icon: '◈', primary: false, match: (p: string) => p.startsWith('/status') },
  { href: '/report', label: 'Report', icon: '▤', primary: false, match: (p: string) => p.startsWith('/report') },
  { href: '/settings', label: 'Nastavenia', icon: '⚙', primary: true, match: (p: string) => p.startsWith('/settings') },
];

export function TopNav() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [openAlerts, setOpenAlerts] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from('alerts')
      .select('id', { count: 'exact', head: true })
      .is('resolved_at', null)
      .then(({ count }) => setOpenAlerts(count ?? 0));
  }, [pathname]);

  return (
    <>
    <nav
      aria-label="Hlavná navigácia"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '14px 24px',
        background: 'var(--surface-primary)',
        borderBottom: '1px solid var(--border-primary)',
        position: 'sticky',
        top: 0,
        zIndex: 900,
        overflowX: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginRight: 24 }}>
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
            fontSize: 14,
          }}
        >
          ◈
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          Monitorix
        </div>
      </div>
      {/* Odkazy v hornej lište — na mobile skryté (nahradí ich spodný bottom-tab bar). */}
      <div className="mx-topnav-links" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {NAV.map((n) => {
        const active = n.match(pathname);
        return (
          <Link
            key={n.href}
            href={n.href}
            className="mx-nav-btn"
            aria-current={active ? 'page' : undefined}
            style={{
              padding: '7px 14px',
              background: active ? 'var(--accent-soft)' : 'transparent',
              borderRadius: 'var(--radius)',
              fontSize: 13.5,
              color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
            }}
          >
            {n.label}
            {n.badge && openAlerts ? (
              <span
                style={{
                  background: 'var(--critical-color)',
                  color: 'white',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '1px 7px',
                  borderRadius: 10,
                  fontFamily: "'Geist Mono', monospace",
                }}
              >
                {openAlerts}
              </span>
            ) : null}
          </Link>
        );
      })}
      </div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={toggle}
        aria-label="Prepnúť tému"
        style={{
          width: 36,
          height: 36,
          background: 'var(--surface-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 9,
          cursor: 'pointer',
          fontSize: 15,
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
    </nav>

    {/* Spodný tab-bar — LEN mobil (brief §5). Hlavné sekcie, palcom dosiahnuteľné. */}
    <nav
      aria-label="Hlavná navigácia (mobil)"
      className="mx-bottom-nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 900,
        background: 'var(--surface-primary)',
        borderTop: '1px solid var(--border-primary)',
        justifyContent: 'space-around',
        alignItems: 'stretch',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {NAV.filter((n) => n.primary).map((n) => {
        const active = n.match(pathname);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              padding: '8px 2px',
              fontSize: 10.5,
              fontWeight: 600,
              textDecoration: 'none',
              color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
              position: 'relative',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1 }}>{n.icon}</span>
            {n.label}
            {n.badge && openAlerts ? (
              <span
                style={{
                  position: 'absolute',
                  top: 4,
                  right: '50%',
                  transform: 'translateX(14px)',
                  background: 'var(--critical-color)',
                  color: 'white',
                  fontSize: 9,
                  fontWeight: 700,
                  minWidth: 15,
                  textAlign: 'center',
                  padding: '0 4px',
                  borderRadius: 8,
                }}
              >
                {openAlerts}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
    </>
  );
}
