// Čistá dátová matematika pre mesačný report — bez `./supabase` (a teda
// testovateľná bez env premenných, rovnaký vzor ako `./dataMath`). Používa ju
// `./reportPreview` aj testy.

export interface ReportPeriod {
  startDay: string; // 'YYYY-MM-DD', inclusive — pre dátumové stĺpce (day, happened_at)
  endDay: string; // 'YYYY-MM-DD', exkluzívne
  startIso: string; // ISO timestamp, inclusive — pre timestamptz stĺpce (created_at, started_at)
  endIso: string; // ISO timestamp, exkluzívne
  monthLabel: string; // „Júl 2026"
  periodLabel: string; // „V júli"
}

const MONTHS = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December'];
// Lokál pre vigilance vetu („V júli sme spravili…") — rovnaké znenie ako
// tools/monthly-report/index.mjs, nech sa preview a reálny mail nerozídu.
const MONTHS_IN = ['V januári', 'Vo februári', 'V marci', 'V apríli', 'V máji', 'V júni', 'V júli', 'V auguste', 'V septembri', 'V októbri', 'V novembri', 'V decembri'];

/** 'YYYY-MM' predchádzajúceho kalendárneho mesiaca (UTC) — default pre výber v UI. */
export function previousMonthValue(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' → celý kalendárny mesiac [start, end). Rovnaká logika ako monthly-report. */
export function periodForMonthValue(ym: string): ReportPeriod {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return {
    startDay: start.toISOString().slice(0, 10),
    endDay: end.toISOString().slice(0, 10),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    monthLabel: `${MONTHS[m - 1]} ${y}`,
    periodLabel: MONTHS_IN[m - 1]!,
  };
}
