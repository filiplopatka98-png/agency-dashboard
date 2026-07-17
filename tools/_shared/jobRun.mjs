// Zapíše beh úlohy do job_runs (best-effort — nikdy nezhodí collector).
// `error` (voliteľné) — text chyby pri predčasnom zlyhaní (viď runJob.mjs);
// keď je zadaný, status je vždy 'error' bez ohľadu na ok/failed počty.
export async function recordJobRun(url, key, job, ok, failed, error = null) {
  if (!url || !key) return;
  const status = error ? 'error' : failed > 0 ? (ok > 0 ? 'partial' : 'error') : 'ok';
  try {
    await fetch(`${url}/rest/v1/job_runs`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job, status, ok, failed, error, finished_at: new Date().toISOString() }),
    });
  } catch {
    /* best-effort: log úlohy nesmie zhodiť samotný collector */
  }
}
