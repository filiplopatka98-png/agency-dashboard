import { describe, expect, it } from 'vitest';
import { archivePatch, bulkSeverity, inView, viewCounts } from './alertActions';

const a = (severity: 'critical' | 'warning' | 'info', resolved: boolean, archived = false) => ({
  severity,
  resolved_at: resolved ? '2026-10-01T08:00:00Z' : null,
  archived_at: archived ? '2026-10-01T09:00:00Z' : null,
});

const rows = [a('critical', false), a('warning', true), a('warning', false), a('info', true, true), a('critical', true, true)];

describe('inView', () => {
  it('bežné pohľady archivované skryjú', () => {
    expect(inView(rows, 'all')).toHaveLength(3);
    expect(inView(rows, 'warning')).toHaveLength(2);
    expect(inView(rows, 'info')).toHaveLength(0);
  });
  it('archív ukáže len archivované', () => {
    expect(inView(rows, 'archive')).toHaveLength(2);
  });
});

describe('viewCounts', () => {
  it('ráta otvorené a vyriešené len v pohľade', () => {
    expect(viewCounts(rows, 'all')).toEqual({ open: 2, resolved: 1 });
    expect(viewCounts(rows, 'critical')).toEqual({ open: 1, resolved: 0 });
  });
});

describe('archivePatch', () => {
  it('otvorený alert sa pri archivovaní aj vyrieši', () => {
    expect(archivePatch({ resolved_at: null }, 'T')).toEqual({ archived_at: 'T', resolved_at: 'T' });
  });
  it('vyriešenému sa pôvodný čas vyriešenia nemení', () => {
    expect(archivePatch({ resolved_at: 'R' }, 'T')).toEqual({ archived_at: 'T' });
  });
});

describe('bulkSeverity', () => {
  it('filter závažnosti obmedzí hromadnú akciu, „Všetky" nie', () => {
    expect(bulkSeverity('warning')).toBe('warning');
    expect(bulkSeverity('all')).toBeNull();
  });
});
