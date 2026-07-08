import { fetchRdapDomain, pickDomainStrategy, type DomainInfo } from '@agency/core';
import { whoisSk } from './whois';

/** Default resolver — .sk cez whois:43 (socket), ostatné cez RDAP. */
export async function defaultDomainResolver(domain: string): Promise<DomainInfo> {
  if (pickDomainStrategy(domain) === 'whois43') {
    try {
      const { expiresAt, registrar } = await whoisSk(domain);
      return { expiresAt, registrar, nameservers: [], source: 'whois43' };
    } catch (err) {
      return {
        expiresAt: null,
        registrar: null,
        nameservers: [],
        source: 'whois43',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return fetchRdapDomain(domain);
}
