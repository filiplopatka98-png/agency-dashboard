// Akcie na stránke Alerty: vyriešiť všetky, archivovať (= „vymazať" v UI —
// riadok ostane, len sa skryje cez archived_at), obnoviť z archívu.
import type { Alert } from './supabase';

export type AlertView = 'all' | Alert['severity'] | 'archive';

type Row = Pick<Alert, 'severity' | 'resolved_at' | 'archived_at'>;

/** Riadky, ktoré daný pohľad zobrazuje. Archivované len v pohľade „Archív". */
export function inView<T extends Row>(alerts: T[], view: AlertView): T[] {
  if (view === 'archive') return alerts.filter((a) => a.archived_at);
  const live = alerts.filter((a) => !a.archived_at);
  return view === 'all' ? live : live.filter((a) => a.severity === view);
}

/** Koľko otvorených / vyriešených je v pohľade — na popisky hromadných tlačidiel. */
export function viewCounts(alerts: Row[], view: AlertView): { open: number; resolved: number } {
  const rows = inView(alerts, view);
  return { open: rows.filter((a) => !a.resolved_at).length, resolved: rows.filter((a) => a.resolved_at).length };
}

/**
 * Archivovanie jedného alertu. Otvorený sa pri tom aj vyrieši — inak by ho
 * počítadlo otvorených alertov (TopNav) ďalej rátalo, hoci ho nikde nevidno.
 */
export function archivePatch(a: Pick<Alert, 'resolved_at'>, nowIso: string): { archived_at: string; resolved_at?: string } {
  return a.resolved_at ? { archived_at: nowIso } : { archived_at: nowIso, resolved_at: nowIso };
}

/** Závažnosť, na ktorú sa obmedzí hromadná akcia (null = všetky). */
export function bulkSeverity(view: AlertView): Alert['severity'] | null {
  return view === 'all' || view === 'archive' ? null : view;
}
