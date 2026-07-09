'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { TopNav } from './TopNav';

/** Auth guard + Monitorix top-nav. Obaľuje chránené stránky. */
export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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
      .catch(() => active && router.replace('/login'));
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
      <main id="main" style={{ padding: 32, color: 'var(--text-secondary)' }}>
        Načítavam…
      </main>
    );
  }

  return (
    <>
      <TopNav />
      <main id="main">{children}</main>
    </>
  );
}
