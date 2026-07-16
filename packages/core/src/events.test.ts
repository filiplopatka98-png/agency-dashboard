import { describe, it, expect } from 'vitest';
import { diffCore, diffPlugins, diffVulns, diffSeoIssues, type PluginInfo, type VulnInfo } from './events';

const plugin = (o: Partial<PluginInfo>): PluginInfo => ({ name: 'WooCommerce', slug: 'woocommerce', version: '5.1', ...o });
const vuln = (o: Partial<VulnInfo>): VulnInfo => ({ cve: 'CVE-2024-1', target: 'WooCommerce', slug: 'woocommerce', title: 'XSS', severity: 'high', ...o });

describe('diffCore', () => {
  it('zmena verzie → update udalosť', () => {
    const [ev] = diffCore('6.4', '6.5');
    expect(ev.kind).toBe('update');
    expect(ev.severity).toBe('info');
    expect(ev.payload).toEqual({ target: 'core', name: 'WordPress', slug: 'wordpress', from: '6.4', to: '6.5' });
  });
  it('prvý ingest (prev null) → žiadne udalosti', () => {
    expect(diffCore(null, '6.5')).toEqual([]);
  });
  it('bez zmeny → žiadne udalosti', () => {
    expect(diffCore('6.5', '6.5')).toEqual([]);
  });
});

describe('diffPlugins', () => {
  it('prvý ingest → žiadne udalosti (nelogujeme celý zoznam)', () => {
    expect(diffPlugins(null, [plugin({}), plugin({ slug: 'yoast', name: 'Yoast' })])).toEqual([]);
  });
  it('zmena verzie → update udalosť', () => {
    const evs = diffPlugins([plugin({ version: '5.1' })], [plugin({ version: '5.4' })]);
    expect(evs).toHaveLength(1);
    expect(evs[0].payload).toEqual({ target: 'plugin', name: 'WooCommerce', slug: 'woocommerce', from: '5.1', to: '5.4' });
  });
  it('nový plugin sa v1 ignoruje', () => {
    expect(diffPlugins([plugin({})], [plugin({}), plugin({ slug: 'yoast', name: 'Yoast' })])).toEqual([]);
  });
  it('bez zmeny → nič', () => {
    expect(diffPlugins([plugin({})], [plugin({})])).toEqual([]);
  });
});

describe('diffVulns', () => {
  it('prvý beh → nič', () => {
    expect(diffVulns(null, [vuln({})])).toEqual([]);
  });
  it('CVE zmizla → fixed (info)', () => {
    const [ev] = diffVulns([vuln({})], []);
    expect(ev.kind).toBe('cve');
    expect(ev.severity).toBe('info');
    expect(ev.payload).toMatchObject({ direction: 'fixed', cve: 'CVE-2024-1', target: 'WooCommerce', severity: 'high' });
  });
  it('CVE pribudla → new (critical)', () => {
    const [ev] = diffVulns([], [vuln({})]);
    expect(ev.severity).toBe('critical');
    expect(ev.payload).toMatchObject({ direction: 'new' });
  });
  it('CVE bez id sa páruje podľa title', () => {
    expect(diffVulns([vuln({ cve: null })], [vuln({ cve: null })])).toEqual([]);
  });
});

describe('diffSeoIssues', () => {
  it('prvý beh → nič', () => {
    expect(diffSeoIssues(null, [{ type: 'Duplicitný title', count: 3 }])).toEqual([]);
  });
  it('typ zmizol → fixed s pôvodným počtom', () => {
    const [ev] = diffSeoIssues([{ type: 'Duplicitný title', count: 12 }], []);
    expect(ev.payload).toEqual({ direction: 'fixed', type: 'Duplicitný title', was_count: 12 });
    expect(ev.severity).toBe('info');
  });
  it('typ pribudol → new (warning)', () => {
    const [ev] = diffSeoIssues([], [{ type: 'Duplicitný title', count: 2 }]);
    expect(ev.payload).toMatchObject({ direction: 'new' });
    expect(ev.severity).toBe('warning');
  });
});
