'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

const NAV = [
  { href: '/', label: 'Prehľad' },
  { href: '/clients', label: 'Klienti' },
  { href: '/alerts', label: 'Alerty' },
  { href: '/settings', label: 'Nastavenia' },
];

/** Auth guard + navigácia. Obaľuje chránené stránky. */
export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        if (!data.session) router.replace('/login');
        else setReady(true);
      })
      .catch(() => {
        if (active) router.replace('/login');
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace('/login');
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  if (!ready) {
    return (
      <main id="main" className="p-6 text-muted">
        Načítavam…
      </main>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16">
      <header className="flex items-center justify-between gap-2 py-4">
        <span className="font-semibold">Agency&nbsp;Dashboard</span>
        <nav className="flex items-center gap-1 text-sm" aria-label="Hlavná navigácia">
          {NAV.map((n) => {
            const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-md px-2.5 py-1.5"
                style={active ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--muted)' }}
              >
                {n.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="rounded-md px-2.5 py-1.5 text-muted"
          >
            Odhlásiť
          </button>
        </nav>
      </header>
      <main id="main">{children}</main>
    </div>
  );
}
