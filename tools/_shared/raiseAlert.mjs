// Zdieľaný insert do `alerts` tabuľky pre collectory (wp-cve, tls-probe,
// gsc-probe, …). runAlerts (scheduler, každých 5 min) ich vydrénuje a pošle
// e-mailom. `alerts.type` je voľný text — nový typ NEtreba migrovať, stačí
// unikátny `dedupe_key`.
//
// Insert je NON-FATAL (log-and-continue, nie throw) — presne ako change_log
// insert v history-snapshot/wp-cve: zlyhanie zápisu alertu nesmie zhodiť
// zvyšok collectora (a jeho { ok, failed } návrat pre runJob), inak by chyba
// v alert inserte vyzerala ako mŕtvy zber.
//
// `?on_conflict=dedupe_key` je POVINNÉ: bez neho PostgREST mieri ON CONFLICT na
// primárny kľúč (`id`, ktorý je vždy nový), takže `resolution=ignore-duplicates`
// konflikt na `dedupe_key` NEzahodí — vyhodí 23505 a odmietne CELÚ dávku, čím
// sa stratia aj naozaj nové alerty v nej (napr. psi perf-drop, keď history už
// ten týždeň vložil ten istý kľúč). S explicitným cieľom sa duplikát preskočí
// per-riadok a nové sa vložia. (Rovnaký vzor ako perf_snapshots on_conflict.)
//
// rows: [{ org_id, site_id|null, type, severity: 'critical'|'warning'|'info',
//          title, body|null, dedupe_key }]
export async function raiseAlerts(url, key, rows, ev = 'alerts.raise_fail') {
  if (!rows || rows.length === 0) return;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal,resolution=ignore-duplicates',
  };
  const r = await fetch(`${url}/rest/v1/alerts?on_conflict=dedupe_key`, { method: 'POST', headers, body: JSON.stringify(rows) });
  if (!r.ok) console.log(JSON.stringify({ ev, status: r.status, body: (await r.text()).slice(0, 200) }));
}
