// Zdieľaná čistá logika pre PROAKTÍVNE degradačné alerty (poklesy metrík),
// aby denný psi-probe a týždenný history-snapshot generovali BYTE-IDENTICKÝ
// dedupe kľúč a nededupovali dvakrát (jeden e-mail, nie dva).
//
// ZDROJ PRAVDY formátu je tools/history-snapshot/index.mjs — `isoWeek` je
// kópia jeho algoritmu (dedupe kľúč `proactive:<site>:<metric>:<isoWeek>`) a
// `isDrop` zodpovedá jeho prahovej logike (`Math.abs(diff) < th` + smer dole).

// ISO 8601 týždeň, napr. '2026-W30'. Identický s history-snapshot/index.mjs
// (tam v .mjs bez typov používa Date-aritmetiku; tu s .getTime() kvôli TS).
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

// Kleslo skóre aspoň o `th`? True LEN pri zhoršení (pokles), nie pri zlepšení
// ani pri poklese menšom než prah. Zhoduje sa s history-snapshot: tam sa alert
// vyrába len keď `Math.abs(diff) >= th` a `improved === false` (diff < 0).
export function isDrop(before: number, cur: number, th: number): boolean {
  return before - cur >= th;
}
