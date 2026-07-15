import type { Metadata } from 'next';
import { StatusClient } from './StatusClient';

// Verejná status page je VŽDY noindex (nechceme ju v Google).
export const metadata: Metadata = {
  title: 'Stav webov — Monitorix',
  description: 'Verejný prehľad dostupnosti spravovaných webov.',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

// Slugy z anon-safe RPC (build-time). Neznámy slug → 404 (dynamicParams=false v exporte).
async function fetchSlugs(): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  try {
    const res = await fetch(`${url}/rest/v1/rpc/public_status_slugs`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export async function generateStaticParams() {
  return (await fetchSlugs()).map((slug) => ({ slug }));
}

export default async function PublicStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StatusClient slug={slug} />;
}
