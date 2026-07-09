// Zapíše beh úlohy do job_runs (best-effort — nikdy nezhodí collector).
export async function recordJobRun(url, key, job, ok, failed) {
  if (!url || !key) return;
  const status = failed > 0 ? (ok > 0 ? 'partial' : 'error') : 'ok';
  try {
    await fetch(`${url}/rest/v1/job_runs`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job, status, ok, failed, finished_at: new Date().toISOString() }),
    });
  } catch {
    /* best-effort: log úlohy nesmie zhodiť samotný collector */
  }
}
