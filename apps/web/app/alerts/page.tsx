'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { supabase, type Alert } from '../lib/supabase';
import { relativeTime } from '../lib/format';

const SEVERITY_COLOR: Record<Alert['severity'], string> = {
  critical: 'var(--dot-down)',
  warning: 'var(--dot-warn)',
  info: 'var(--dot-ok)',
};

type Filter = 'all' | Alert['severity'];

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (active) setAlerts(data ?? []);
    })();
    return () => {
      active = false;
    };
  }, [tick]);

  const resolve = async (id: string) => {
    await supabase.from('alerts').update({ resolved_at: new Date().toISOString() }).eq('id', id);
    setTick((t) => t + 1);
  };

  const shown = (alerts ?? []).filter((a) => filter === 'all' || a.severity === filter);

  return (
    <Shell>
      <h1 className="mb-4 text-lg font-semibold">Alerty</h1>

      <div className="mb-4 flex gap-1 text-sm">
        {(['all', 'critical', 'warning', 'info'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="rounded-md px-2.5 py-1"
            style={filter === f ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--muted)' }}
          >
            {f === 'all' ? 'Všetky' : f}
          </button>
        ))}
      </div>

      {!alerts && <p className="text-muted">Načítavam…</p>}
      {alerts && shown.length === 0 && <p className="text-muted">Žiadne alerty.</p>}

      <ul className="flex flex-col gap-2">
        {shown.map((a) => (
          <li
            key={a.id}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
            style={{ opacity: a.resolved_at ? 0.55 : 1 }}
          >
            <span
              aria-hidden
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: SEVERITY_COLOR[a.severity] }}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{a.title}</p>
              {a.body && <p className="text-sm text-muted">{a.body}</p>}
              <p className="mt-1 text-xs text-muted">
                {a.type} · {relativeTime(a.created_at)}
                {a.sent_at ? ' · odoslané' : ' · čaká'}
              </p>
            </div>
            {!a.resolved_at && (
              <button
                onClick={() => resolve(a.id)}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs"
              >
                Vyriešené
              </button>
            )}
          </li>
        ))}
      </ul>
    </Shell>
  );
}
