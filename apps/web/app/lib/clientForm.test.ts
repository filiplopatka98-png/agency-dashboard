import { describe, expect, it } from 'vitest';
import type { Client } from './supabase';
import { EMPTY_CLIENT_FORM, clientPatch, clientPayload, fromClient } from './clientForm';

const client = (over: Partial<Client> = {}): Client =>
  ({
    id: 'c-1',
    org_id: 'o-1',
    name: 'Kuko',
    company: null,
    contract_type: 'Standard',
    monthly_fee_eur: 39,
    email: '',
    phone: ' 0900 ',
    ico: null,
    notion_page_id: null,
    report_email: 'nie-je-email',
    status: 'active',
    ...over,
  }) as Client;

describe('formulár klienta — otvorenie bez zásahu nemení NIČ', () => {
  it.each([
    ['nepohodlné hodnoty (\'\' vs null, medzery, neplatný e-mail)', client()],
    ['desatinný paušál', client({ monthly_fee_eur: 12.5 })],
    ['bez paušálu', client({ monthly_fee_eur: null })],
  ])('%s → prázdny patch, žiadna chyba', (_l, c) => {
    expect(clientPatch(fromClient(c), fromClient(c))).toEqual({ patch: {}, error: null });
  });
});

describe('formulár klienta — úprava pošle len zmenené pole', () => {
  it('zmena telefónu nezmení e-mail ani paušál (a neblokuje ju starý neplatný report e-mail)', () => {
    const c = client();
    expect(clientPatch(fromClient(c), { ...fromClient(c), phone: '0911' })).toEqual({ patch: { phone: '0911' }, error: null });
  });
  it('validácia platí pre zmenené pole', () => {
    const c = client();
    expect(clientPatch(fromClient(c), { ...fromClient(c), monthly_fee_eur: 'abc' }).error).toBe('Paušál musí byť číslo.');
  });
});

describe('nový klient', () => {
  it('pošle všetky polia, prázdne → null', () => {
    const { payload } = clientPayload({ ...EMPTY_CLIENT_FORM, name: ' Nový ', monthly_fee_eur: '39,5' });
    expect(payload).toEqual({ name: 'Nový', company: null, contract_type: null, monthly_fee_eur: 39.5, email: null, phone: null, ico: null, notion_page_id: null, report_email: null });
  });
  it('bez názvu → chyba', () => {
    expect(clientPayload(EMPTY_CLIENT_FORM).error).toBe('Názov klienta je povinný.');
  });
});
