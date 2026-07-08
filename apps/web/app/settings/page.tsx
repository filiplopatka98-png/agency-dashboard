'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { supabase } from '../lib/supabase';

export default function SettingsPage() {
  const [org, setOrg] = useState<{ name: string } | null>(null);
  const [email, setEmail] = useState<string>('');
  const [siteCount, setSiteCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [o, u, s] = await Promise.all([
        supabase.from('organizations').select('name').limit(1).maybeSingle(),
        supabase.auth.getUser(),
        supabase.from('sites').select('id', { count: 'exact', head: true }).eq('is_active', true),
      ]);
      setOrg(o.data);
      setEmail(u.data.user?.email ?? '');
      setSiteCount(s.count ?? 0);
    })();
  }, []);

  return (
    <Shell>
      <h1 className="mb-4 text-lg font-semibold">Nastavenia</h1>

      <section className="mb-4 rounded-xl border border-border bg-card p-4 text-sm">
        <h2 className="mb-2 font-medium">Organizácia</h2>
        <div className="flex justify-between border-b border-border py-2">
          <span className="text-muted">Názov</span>
          <span>{org?.name ?? '—'}</span>
        </div>
        <div className="flex justify-between border-b border-border py-2">
          <span className="text-muted">Prihlásený ako</span>
          <span>{email || '—'}</span>
        </div>
        <div className="flex justify-between py-2">
          <span className="text-muted">Aktívne weby</span>
          <span>{siteCount ?? '—'}</span>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 text-sm">
        <h2 className="mb-2 font-medium">Notifikácie</h2>
        <p className="text-muted">
          Príjemcov e-mailových alertov (ALERT_EMAIL_TO/FROM, Resend) konfiguruje scheduler cez
          Cloudflare Worker secrets. UI ich zámerne nespravuje — service_role sa sem nikdy nedostane.
        </p>
      </section>
    </Shell>
  );
}
