// Formulár klienta (pridať / upraviť). Pri úprave platí rovnaká zásada ako v
// siteEdit.ts: do DB ide LEN to, čo používateľ zmenil. Predtým sa pri každom
// uložení posielali všetky polia znormalizované (trim, '' → null, paušál cez
// Number()), takže úprava jedného poľa potichu prepísala aj ostatné.
import type { Client } from './supabase';

export type ClientForm = {
  name: string;
  company: string;
  contract_type: string;
  monthly_fee_eur: string;
  email: string;
  phone: string;
  ico: string;
  notion_page_id: string;
  report_email: string;
};

export const EMPTY_CLIENT_FORM: ClientForm = { name: '', company: '', contract_type: '', monthly_fee_eur: '', email: '', phone: '', ico: '', notion_page_id: '', report_email: '' };

export function fromClient(c: Client): ClientForm {
  return {
    name: c.name ?? '',
    company: c.company ?? '',
    contract_type: c.contract_type ?? '',
    monthly_fee_eur: c.monthly_fee_eur != null ? String(c.monthly_fee_eur) : '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    ico: c.ico ?? '',
    notion_page_id: c.notion_page_id ?? '',
    report_email: c.report_email ?? '',
  };
}

export type ClientPayload = {
  name: string;
  company: string | null;
  contract_type: string | null;
  monthly_fee_eur: number | null;
  email: string | null;
  phone: string | null;
  ico: string | null;
  notion_page_id: string | null;
  report_email: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEXT_FIELDS = ['company', 'contract_type', 'email', 'phone', 'ico', 'notion_page_id'] as const;

function field<K extends keyof ClientForm>(k: K, raw: string): { value: ClientPayload[K]; error: string | null } {
  if (k === 'name') {
    const v = raw.trim();
    return { value: v as ClientPayload[K], error: v ? null : 'Názov klienta je povinný.' };
  }
  if (k === 'monthly_fee_eur') {
    const v = raw.trim();
    if (v === '') return { value: null as ClientPayload[K], error: null };
    const n = Number(v.replace(',', '.'));
    return { value: n as ClientPayload[K], error: Number.isNaN(n) ? 'Paušál musí byť číslo.' : null };
  }
  if (k === 'report_email') {
    const v = raw.trim();
    return { value: (v || null) as ClientPayload[K], error: v && !EMAIL_RE.test(v) ? 'Report e-mail nie je platný.' : null };
  }
  return { value: (raw.trim() || null) as ClientPayload[K], error: null };
}

const KEYS: (keyof ClientForm)[] = ['name', ...TEXT_FIELDS.slice(0, 2), 'monthly_fee_eur', ...TEXT_FIELDS.slice(2), 'report_email'];

/** Nový klient — všetky polia. */
export function clientPayload(form: ClientForm): { payload: ClientPayload | null; error: string | null } {
  const out = {} as Record<string, unknown>;
  for (const k of KEYS) {
    const { value, error } = field(k, form[k]);
    if (error) return { payload: null, error };
    out[k] = value;
  }
  return { payload: out as ClientPayload, error: null };
}

/** Úprava — len polia, ktoré sa líšia od stavu pri otvorení. Prázdny objekt = nič neukladať. */
export function clientPatch(initial: ClientForm, form: ClientForm): { patch: Partial<ClientPayload>; error: string | null } {
  const patch: Record<string, unknown> = {};
  for (const k of KEYS) {
    if (form[k] === initial[k]) continue;
    const { value, error } = field(k, form[k]);
    if (error) return { patch: {}, error };
    patch[k] = value;
  }
  return { patch: patch as Partial<ClientPayload>, error: null };
}
