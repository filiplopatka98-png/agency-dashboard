'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

const NAV = [
  { href: '/', label: 'Prehľad', match: (p: string) => p === '/' },
  { href: '/sites', label: 'Weby', match: (p: string) => p.startsWith('/sites') },
  { href: '/clients', label: 'Klienti', match: (p: string) => p.startsWith('/clients') },
  { href: '/alerts', label: 'Alerty', match: (p: string) => p.startsWith('/alerts'), badge: true },
  { href: '/status', label: 'Status page', match: (p: string) => p.startsWith('/status') },
  { href: '/report', label: 'Report', match: (p: string) => p.startsWith('/report') },
  { href: '/settings', label: 'Nastavenia', match: (p: string) => p.startsWith('/settings') },
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
    <div
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
      {NAV.map((n) => {
        const active = n.match(pathname);
        return (
          <Link
            key={n.href}
            href={n.href}
            className="mx-nav-btn"
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
    </div>
  );
}
