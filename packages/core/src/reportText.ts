// Jazyk reportov. Z tej istej udalosti vyrobí klientsku vetu (ľudská reč) alebo
// admin riadok (stručne). Klient nikdy nevidí zhoršenia — to zaisťuje isClientVisible.
// Hlas: auto-zistené udalosti = vecný („bol aktualizovaný"), denník = agentúrny
// (text píše operátor). Netvrdíme, kto výpadok opravil — len že sme ho zachytili.

import type { ChangeEvent, UpdatePayload, CvePayload, SeoPayload, ScorePayload } from './events';

export function isClientVisible(ev: ChangeEvent): boolean {
  const dir = (ev.payload as { direction?: string }).direction;
  switch (ev.kind) {
    case 'update':
      return true;
    case 'cve':
    case 'seo':
      return dir === 'fixed';
    case 'score':
      return dir === 'up';
    default:
      return false;
  }
}

// Vety per metrika — slovenský rod sa nedá skladať z holého labelu
// („Pripravenosť sa zlepšila" vs „Nastavenia sa zlepšili").
const METRIC_SENTENCE: Record<string, (from: number, to: number) => string> = {
  aeo: (f, t) => `Pripravenosť webu pre AI vyhľadávače sa zlepšila zo ${f} na ${t} bodov.`,
  security: (f, t) => `Bezpečnostné nastavenia sa zlepšili zo ${f} na ${t} bodov.`,
  perf_mobile: (f, t) => `Rýchlosť na mobile sa zlepšila zo ${f} na ${t} bodov.`,
  perf_desktop: (f, t) => `Rýchlosť na počítači sa zlepšila zo ${f} na ${t} bodov.`,
};

// Zrkadlové vety pre zhoršenie (direction: 'down') — rovnaký rod, opačný smer.
const METRIC_SENTENCE_DOWN: Record<string, (from: number, to: number) => string> = {
  aeo: (f, t) => `Pripravenosť webu pre AI vyhľadávače sa zhoršila zo ${f} na ${t} bodov.`,
  security: (f, t) => `Bezpečnostné nastavenia sa zhoršili zo ${f} na ${t} bodov.`,
  perf_mobile: (f, t) => `Rýchlosť na mobile sa zhoršila zo ${f} na ${t} bodov.`,
  perf_desktop: (f, t) => `Rýchlosť na počítači sa zhoršila zo ${f} na ${t} bodov.`,
};

// SEO typy sú v seo.ts už po slovensky, ale technicky — preklad do klientskej reči.
// Fallback = pôvodný text (zrozumiteľný, nič si nevymýšľa).
export const SEO_CLIENT_LABELS: Record<string, string> = {
  'Nefunkčné odkazy (4xx/5xx)': 'nefunkčné odkazy',
  'Chýbajúci title / meta description': 'chýbajúce názvy a popisy stránok pre vyhľadávače',
  'Duplicitný title': 'rovnaké názvy na viacerých stránkach',
  'Obrázky bez alt atribútu': 'obrázky bez textového popisu',
  'Chýbajúci alebo viacnásobný H1': 'nesprávne hlavné nadpisy stránok',
  'Chýbajúci canonical': 'chýbajúce označenie hlavnej verzie stránky',
  'Mixed content (HTTP na HTTPS)': 'nezabezpečené prvky na zabezpečenej stránke',
};

const SEVERITY_SK: Record<string, string> = {
  critical: 'kritickej',
  high: 'vysokej',
  medium: 'strednej',
  low: 'nízkej',
};

const pages = (n: number) => (n === 1 ? 'stránke' : 'stránkach');
const minutes = (n: number) => (n === 1 ? 'minútu' : n < 5 ? 'minúty' : 'minút');

// Zdieľané formátovanie (importuje aj clientReport.ts — nech nie je na dvoch miestach).
// Tisícky s pevnou medzerou, percentá s desatinnou čiarkou a bez „,00".
// Pozn.: toLocaleString('sk-SK') závisí od ICU dát skompilovaných do Node — tento
// projekt vyžaduje a CI používa oficiálne Node ≥22 distribúcie, ktoré sú
// full-ICU predvolene. Normalizácia /\s/g nižšie pokrýva varianty medzier
// (NBSP, narrow-NBSP, medzera), ktoré takéto plné-ICU zostavenia produkujú.
export const fmtNum = (n: number): string => n.toLocaleString('sk-SK').replace(/\s/g, ' ');
export const fmtPct = (p: number): string => p.toFixed(2).replace('.', ',').replace(',00', '');

// HTML escape pre e-mailové rendery (report.ts, digest.ts, clientReport.ts).
// Boli tri byte-identické kópie — jedno miesto, aby sa pri budúcom rozšírení
// (napr. o ' → &#39;) nerozišli. Reťazce, ktoré sa cez toto renderujú, môžu
// pochádzať z DB (mená webov, pluginy z WP agenta), takže musí byť konzistentné
// všade, kde ide do HTML e-mailu.
export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Renderuje pravdivo v OBOCH smeroch (fixed/new, up/down) — nerozhoduje, čo klient
// smie vidieť. Filtrovanie podľa publika je zodpovednosť volajúceho cez
// isClientVisible (napr. buildClientLines) — tu sa to zámerne nemení.
export function renderClient(ev: ChangeEvent): string {
  switch (ev.kind) {
    case 'update': {
      const p = ev.payload as UpdatePayload;
      return `${p.name} bol aktualizovaný na verziu ${p.to}.`;
    }
    case 'cve': {
      const p = ev.payload as CvePayload;
      const sev = SEVERITY_SK[p.severity];
      if (p.direction === 'new') {
        return sev
          ? `Zistená nová bezpečnostná zraniteľnosť ${sev} závažnosti v module ${p.target}.`
          : `Zistená nová bezpečnostná zraniteľnosť v module ${p.target}.`;
      }
      return sev
        ? `Odstránená bezpečnostná zraniteľnosť ${sev} závažnosti v module ${p.target}.`
        : `Odstránená bezpečnostná zraniteľnosť v module ${p.target}.`;
    }
    case 'seo': {
      const p = ev.payload as SeoPayload;
      const label = SEO_CLIENT_LABELS[p.type] ?? p.type;
      const verb = p.direction === 'new' ? 'Zistené' : 'Opravené';
      return `${verb}: ${label} — na ${p.was_count} ${pages(p.was_count)}.`;
    }
    case 'score': {
      const p = ev.payload as ScorePayload;
      const from = Math.round(p.from);
      const to = Math.round(p.to);
      if (p.direction === 'down') {
        const sentenceDown = METRIC_SENTENCE_DOWN[p.metric];
        return sentenceDown ? sentenceDown(from, to) : `${p.metric}: zhoršenie zo ${from} na ${to} bodov.`;
      }
      const sentence = METRIC_SENTENCE[p.metric];
      return sentence ? sentence(from, to) : `${p.metric}: zlepšenie zo ${from} na ${to} bodov.`;
    }
    default:
      return ev.message;
  }
}

const BRATISLAVA = 'Europe/Bratislava';
function localParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('sk-SK', { day: 'numeric', month: 'numeric', timeZone: BRATISLAVA }).format(d);
  const time = new Intl.DateTimeFormat('sk-SK', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BRATISLAVA }).format(d);
  return { date: date.replace(/\s/g, ' '), time };
}

// „Zachytili sme" je pravda (monitoring ho naozaj zachytil). Že sme ho opravili
// NEtvrdíme — web sa mohol obnoviť aj sám.
export function renderIncident(startedAt: string, resolvedAt: string): string {
  const mins = Math.max(1, Math.round((Date.parse(resolvedAt) - Date.parse(startedAt)) / 60000));
  const { date, time } = localParts(startedAt);
  return `Zachytili sme krátky výpadok ${date} o ${time}, trval ${mins} ${minutes(mins)}.`;
}

export interface Vigilance {
  checks: number;
  uptimePct: number | null;
  downtimeSeconds: number;
}

export function renderVigilance(v: Vigilance, periodLabel: string): string {
  // Nula kontrol = nemonitorovali sme, nie „stabilne bez problémov". Nulu
  // nesmieme podať ako pozitívnu vetu ani rámcovať cez periodLabel — nič sme
  // nezmerali, takže nič netvrdíme.
  if (v.checks === 0) return 'Za toto obdobie nemáme merania dostupnosti.';
  const pct = v.uptimePct === null ? null : fmtPct(v.uptimePct);
  const head = `${periodLabel} sme spravili ${fmtNum(v.checks)} kontrol dostupnosti.`;
  if (pct === null) return head;
  const mins = Math.round(v.downtimeSeconds / 60);
  return mins > 0
    ? `${head} Web bol dostupný ${pct} % času, celkový výpadok ${mins} ${minutes(mins)}.`
    : `${head} Web bol dostupný ${pct} % času.`;
}

export interface TimedLine {
  at: string;
  text: string;
}

export function buildClientLines(input: {
  events: { at: string; ev: ChangeEvent }[];
  diary: { happened_at: string; text: string }[];
  incidents: { started_at: string; resolved_at: string }[];
}): TimedLine[] {
  const lines: TimedLine[] = [
    ...input.events.filter((e) => isClientVisible(e.ev)).map((e) => ({ at: e.at, text: renderClient(e.ev) })),
    ...input.diary.map((d) => ({ at: d.happened_at, text: d.text })),
    ...input.incidents.map((i) => ({ at: i.started_at, text: renderIncident(i.started_at, i.resolved_at) })),
  ];
  return lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
