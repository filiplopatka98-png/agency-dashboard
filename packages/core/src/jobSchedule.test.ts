import { describe, expect, it } from 'vitest';
import { expectedIntervalMs, isOverdue, JOB_SCHEDULES, overdueFactor, type JobSchedule } from './jobSchedule';

describe('expectedIntervalMs', () => {
  it('every5 = 5 minút', () => {
    expect(expectedIntervalMs({ kind: 'every5' })).toBe(5 * 60_000);
  });
  it('daily = 24 hodín', () => {
    expect(expectedIntervalMs({ kind: 'daily', hh: 2, mm: 0 })).toBe(24 * 3_600_000);
  });
  it('weekly = 7 dní', () => {
    expect(expectedIntervalMs({ kind: 'weekly', dow: 1, hh: 3, mm: 0 })).toBe(7 * 24 * 3_600_000);
  });
  it('monthly = horný odhad 31 dní', () => {
    expect(expectedIntervalMs({ kind: 'monthly', dom: 1, hh: 7, mm: 0 })).toBe(31 * 24 * 3_600_000);
  });
});

describe('isOverdue', () => {
  const daily: JobSchedule = { kind: 'daily', hh: 2, mm: 0 };
  const now = Date.parse('2026-07-17T12:00:00Z');

  it('nikdy nezaznamenaný beh (null) nie je overdue — je to iný stav ("nikdy")', () => {
    expect(isOverdue(null, daily, now)).toBe(false);
  });

  it('beh spred 1 dňa (< 2× 24h) nie je overdue', () => {
    expect(isOverdue('2026-07-16T12:00:00Z', daily, now)).toBe(false);
  });

  it('beh presne na hranici 2× intervalu ešte nie je overdue', () => {
    expect(isOverdue('2026-07-15T12:00:01Z', daily, now)).toBe(false);
  });

  it('beh spred > 2 dní (2× 24h) JE overdue, bez ohľadu na status (nekontroluje sa tu)', () => {
    expect(isOverdue('2026-07-15T11:00:00Z', daily, now)).toBe(true);
  });

  it('týždenný job, ktorý naposledy bežal pred 2 mesiacmi, je overdue', () => {
    const weekly: JobSchedule = { kind: 'weekly', dow: 1, hh: 3, mm: 0 };
    expect(isOverdue('2026-05-17T03:00:00Z', weekly, now)).toBe(true);
  });

  it('neplatný dátum sa netraktuje ako overdue (fail-safe, nie falošný poplach)', () => {
    expect(isOverdue('not-a-date', daily, now)).toBe(false);
  });
});

describe('JOB_SCHEDULES', () => {
  it('obsahuje presne 13 jobov (12 collectorov + scheduler)', () => {
    expect(Object.keys(JOB_SCHEDULES)).toHaveLength(13);
  });

  it('kľúče zodpovedajú job_runs.job hodnotám použitým v collectoroch', () => {
    for (const key of [
      'scheduler', 'psi', 'tls', 'security', 'aeo', 'gsc', 'seo', 'infra', 'cve', 'history', 'digest', 'report',
    ]) {
      expect(JOB_SCHEDULES).toHaveProperty(key);
    }
  });

  it('cve je DENNÝ (wp-cve.yml beží 0 6 * * *), nie týždenný (FIX 3)', () => {
    expect(JOB_SCHEDULES.cve!.kind).toBe('daily');
  });

  it('asset-check je hourly a expectedIntervalMs = 1 h', () => {
    expect(JOB_SCHEDULES['asset-check']!.kind).toBe('hourly');
    expect(expectedIntervalMs({ kind: 'hourly' })).toBe(3_600_000);
  });
});

describe('overdueFactor', () => {
  it('hourly dostáva väčšiu toleranciu (6×) — GitHub cron mešká/vynecháva hodinové behy', () => {
    expect(overdueFactor({ kind: 'hourly' })).toBe(6);
  });
  it('ostatné kindy = 2×', () => {
    expect(overdueFactor({ kind: 'every5' })).toBe(2);
    expect(overdueFactor({ kind: 'daily', hh: 2, mm: 0 })).toBe(2);
    expect(overdueFactor({ kind: 'weekly', dow: 1, hh: 3, mm: 0 })).toBe(2);
    expect(overdueFactor({ kind: 'monthly', dom: 1, hh: 7, mm: 0 })).toBe(2);
  });
  it('hodinový job: beh spred 2,5 h NIE je overdue (GitHub jitter), spred 7 h ÁNO', () => {
    const now = Date.parse('2026-07-20T12:00:00Z');
    const h = 3_600_000;
    const sched = { kind: 'hourly' } as const;
    // s overdueFactor (6×) — prah je 6 h
    expect(isOverdue(new Date(now - 2.5 * h).toISOString(), sched, now, overdueFactor(sched))).toBe(false);
    expect(isOverdue(new Date(now - 7 * h).toISOString(), sched, now, overdueFactor(sched))).toBe(true);
  });
});
