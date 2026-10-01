import { describe, expect, it } from 'vitest';
import { siteEditForm, siteEditPatch, type SiteEditSource } from './siteEdit';

const site = (over: Partial<SiteEditSource> = {}): SiteEditSource => ({
  name: 'Kuko detský svet',
  domain: 'kukodetskysvet.sk',
  cms: 'other',
  clientId: 'c-1',
  expectedString: null,
  ...over,
});

// Rôzne „nepohodlné" hodnoty z DB — žiadna sa nesmie pri otvorení+uložení zmeniť.
const SITES: [string, SiteEditSource][] = [
  ['cms Iné (pôvodná chyba → Statický)', site({ cms: 'other' })],
  ['cms Statický', site({ cms: 'static' })],
  ['cms WordPress', site({ cms: 'wordpress' })],
  ['cms neznáma hodnota', site({ cms: 'drupal' })],
  ['cms null', site({ cms: null })],
  ['bez klienta', site({ clientId: null })],
  ['názov s medzerami okolo', site({ name: '  Kuko  ' })],
  ['doména s veľkými písmenami / www', site({ domain: 'WWW.Kuko.sk' })],
  ['kontrolný text s medzerami', site({ expectedString: '  Kuko  ' })],
  ['kontrolný text prázdny reťazec', site({ expectedString: '' })],
];

describe('dialóg „Upraviť web" — otvorenie bez zásahu nemení NIČ', () => {
  it.each(SITES)('%s → prázdny patch', (_label, s) => {
    const opened = siteEditForm(s);
    const { patch, error } = siteEditPatch(siteEditForm(s), opened);
    expect(error).toBeNull();
    expect(patch).toEqual({});
  });

  it('regresia: formulár drží surový cms („other" ostane „other", nie „static")', () => {
    expect(siteEditForm(site({ cms: 'other' })).cms).toBe('other');
  });
});

describe('dialóg „Upraviť web" — do DB ide len zmenené pole', () => {
  it('zmena len kontrolného textu → len expected_string (cms, url, doména ostanú)', () => {
    const s = site({ cms: 'other' });
    const { patch } = siteEditPatch(siteEditForm(s), { ...siteEditForm(s), expected_string: ' Kuko ' });
    expect(patch).toEqual({ expected_string: 'Kuko' });
  });

  it('zmena typu → len cms', () => {
    const s = site({ cms: 'other' });
    expect(siteEditPatch(siteEditForm(s), { ...siteEditForm(s), cms: 'static' }).patch).toEqual({ cms: 'static' });
  });

  it('url sa prepočíta len pri reálnej zmene domény', () => {
    const s = site();
    expect(siteEditPatch(siteEditForm(s), { ...siteEditForm(s), domain: 'https://kukodetskysvet.sk/' }).patch).toEqual({});
    expect(siteEditPatch(siteEditForm(s), { ...siteEditForm(s), domain: 'kuko.sk' }).patch).toEqual({ domain: 'kuko.sk', url: 'https://kuko.sk' });
  });

  it('vymazanie kontrolného textu → null; klient → null', () => {
    const s = site({ expectedString: 'Kuko' });
    expect(siteEditPatch(siteEditForm(s), { ...siteEditForm(s), expected_string: '', client_id: '' }).patch).toEqual({ expected_string: null, client_id: null });
  });

  it('vymazaný názov → chyba, nič sa neuloží', () => {
    const s = site();
    expect(siteEditPatch(siteEditForm(s), { ...siteEditForm(s), name: '  ' })).toEqual({ patch: {}, error: 'Vyplň názov webu.' });
  });

  it('neznámy cms sa nikdy nepošle (len hodnoty z ponuky)', () => {
    const s = site({ cms: 'other' });
    expect(siteEditPatch(siteEditForm(s), { ...siteEditForm(s), cms: 'drupal' }).patch).toEqual({});
  });
});
