import type { Metadata } from 'next';
import { StatusClient } from './StatusClient';

// Verejná status page je VŽDY noindex (nechceme ju v Google).
export const metadata: Metadata = {
  title: 'Stav webov — Monitorix',
  description: 'Verejný prehľad dostupnosti spravovaných webov.',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

// Slugy pre build (generateStaticParams). PO AUDITE 2026-07-17 (1.1):
// `public_status_slugs()` už NIE JE grantnuté pre `anon` (viď migrácia 0025) —
// vracalo by zoznam VŠETKÝCH klientov hocikomu, kto pozná anon kľúč z bundlu.
// Táto funkcia preto beží VÝLUČNE tu — v Node, pri builde (next.config má
// `output: 'export'`, žiadny SSR/API route) — a používa service_role kľúč z
// premennej BEZ `NEXT_PUBLIC_` prefixu, takže sa nikdy nedostane do
// klientského bundlu (Next inlineuje do browsera len `NEXT_PUBLIC_*`).
// Neznámy slug na verejnej stránke → 404 (dynamicParams=false v exporte).
async function fetchSlugs(): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Chýbajúca premenná pri builde nesmie ticho vypnúť VŠETKY status
    // stránky — nahlas to zaloguj, nech to CI/CD build log ukáže.
    console.warn(
      '[status] SUPABASE_SERVICE_ROLE_KEY alebo NEXT_PUBLIC_SUPABASE_URL chýba pri builde — ' +
        'generateStaticParams nevygeneruje ŽIADNU verejnú status stránku. ' +
        'Nastav SUPABASE_SERVICE_ROLE_KEY v build prostredí (pozri docs/DEPLOY.md).',
    );
    return [];
  }
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
