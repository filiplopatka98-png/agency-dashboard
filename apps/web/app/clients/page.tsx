'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Shell } from '../components/Shell';
import { supabase, type Client, type Site } from '../lib/supabase';
import { DASH } from '../lib/format';

function ClientsList() {
  const id = useSearchParams().get('id');
  const [clients, setClients] = useState<Client[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);

  useEffect(() => {
    (async () => {
      const c = await supabase.from('clients').select('*').order('name');
      setClients(c.data ?? []);
      if (id) {
        const s = await supabase.from('sites').select('*').eq('client_id', id).order('name');
        setSites(s.data ?? []);
      }
    })();
  }, [id]);

  if (!clients) return <p className="text-muted">Načítavam…</p>;

  if (id) {
    const client = clients.find((c) => c.id === id);
    if (!client) return <p className="text-muted">Klient sa nenašiel.</p>;
    return (
      <>
        <Link href="/clients" className="text-sm text-muted">
          ← Klienti
        </Link>
        <h1 className="mt-2 text-lg font-semibold">{client.name}</h1>
        <p className="mb-4 text-sm text-muted">{client.company ?? DASH}</p>
        <div className="mb-4 rounded-xl border border-border bg-card p-4 text-sm">
          <div className="flex justify-between border-b border-border py-2">
            <span className="text-muted">E-mail</span>
            <span>{client.email ?? DASH}</span>
          </div>
          <div className="flex justify-between border-b border-border py-2">
            <span className="text-muted">Telefón</span>
            <span>{client.phone ?? DASH}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted">Stav</span>
            <span>{client.status}</span>
          </div>
        </div>
        <h2 className="mb-2 text-sm font-medium">Weby</h2>
        {sites.length === 0 ? (
          <p className="text-sm text-muted">Žiadne weby.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sites.map((s) => (
              <li key={s.id}>
                <Link href={`/sites?id=${s.id}`} className="text-accent underline">
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Klienti</h1>
      {clients.length === 0 ? (
        <p className="text-muted">Zatiaľ žiadni klienti.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clients.map((c) => (
            <li key={c.id}>
              <Link
                href={`/clients?id=${c.id}`}
                className="flex items-center justify-between rounded-xl border border-border bg-card p-4"
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-muted">{c.company ?? DASH}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ClientsPage() {
  return (
    <Shell>
      <Suspense fallback={<p className="text-muted">Načítavam…</p>}>
        <ClientsList />
      </Suspense>
    </Shell>
  );
}
