// Dialóg „Upraviť web" — formulár a patch. Zásada: dialóg NIKDY nemení hodnotu,
// ktorú používateľ nezmenil — ani pri otvorení (formulár drží surové hodnoty z DB,
// žiadne mapovanie/normalizácia), ani pri uložení (patch obsahuje len polia,
// ktoré sa líšia od stavu pri otvorení).
//
// Pôvodná chyba (od 536893e, 13. 7. 2026): openEdit mapoval cms cez
// `isWordPress ? 'wordpress' : 'static'`, takže web typu „Iné" sa pri otvorení
// zmenil na „Statický" a uložením (vždy všetky polia) sa to zapísalo do DB.
// Rovnako sa pri každom uložení prepisovalo `url` na `https://<doména>` (aj keď
// doména ostala, napr. web s www alebo cestou v URL).
import { expectedStringError, normalizeExpectedString } from './expectedString';

export const SITE_CMS_OPTIONS = [
  { value: 'wordpress', label: 'WordPress' },
  { value: 'static', label: 'Statický' },
  { value: 'other', label: 'Iné' },
] as const;
export type SiteCms = (typeof SITE_CMS_OPTIONS)[number]['value'];
const isSiteCms = (v: string): v is SiteCms => SITE_CMS_OPTIONS.some((o) => o.value === v);

export interface SiteEditSource {
  name: string;
  domain: string;
  cms: string | null;
  clientId: string | null;
  expectedString: string | null;
}

export interface SiteEditForm {
  name: string;
  domain: string;
  cms: string; // surová hodnota z DB — aj neznáma/prázdna ostane, kým ju používateľ nezmení
  client_id: string;
  expected_string: string;
}

export function siteEditForm(s: SiteEditSource): SiteEditForm {
  return {
    name: s.name,
    domain: s.domain,
    cms: s.cms ?? '',
    client_id: s.clientId ?? '',
    expected_string: s.expectedString ?? '',
  };
}

export function normalizeDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
}

export type SiteEditPatch = Partial<{
  name: string;
  domain: string;
  url: string;
  cms: SiteCms;
  client_id: string | null;
  expected_string: string | null;
}>;

/** Len zmenené polia (prázdny objekt = nič neukladať), alebo chyba pre formulár. */
export function siteEditPatch(initial: SiteEditForm, form: SiteEditForm): { patch: SiteEditPatch; error: string | null } {
  const patch: SiteEditPatch = {};
  if (form.name !== initial.name) {
    const name = form.name.trim();
    if (!name) return { patch: {}, error: 'Vyplň názov webu.' };
    if (name !== initial.name) patch.name = name;
  }
  if (form.domain !== initial.domain) {
    const domain = normalizeDomain(form.domain);
    if (!domain) return { patch: {}, error: 'Vyplň doménu.' };
    // url sa prepočíta LEN pri reálnej zmene domény — inak by sa prepísala vlastná URL (www, cesta).
    if (domain !== initial.domain) {
      patch.domain = domain;
      patch.url = `https://${domain}`;
    }
  }
  // Do DB len platná hodnota z ponuky (neznáma pôvodná hodnota sa nikdy neposiela späť).
  if (form.cms !== initial.cms && isSiteCms(form.cms)) patch.cms = form.cms;
  if (form.client_id !== initial.client_id) patch.client_id = form.client_id || null;
  if (form.expected_string !== initial.expected_string) {
    const err = expectedStringError(form.expected_string);
    if (err) return { patch: {}, error: err };
    const next = normalizeExpectedString(form.expected_string);
    const original = initial.expected_string === '' ? null : initial.expected_string;
    if (next !== original) patch.expected_string = next;
  }
  return { patch, error: null };
}
