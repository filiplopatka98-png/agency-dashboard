import { connect } from 'cloudflare:sockets';
import { parseWhoisSk } from '@agency/core';

/**
 * WHOIS:43 dopyt na SK-NIC (pre .sk domény — nemajú RDAP). Používa cloudflare:sockets.
 *
 * ⚠️ cloudflare:sockets na Workers FREE treba overiť na NASADENOM workeri
 * (`wrangler dev` klame — beží na Node). Ak na Free nefunguje, fallback je Node
 * GitHub Action (net.Socket, port 43) — parser parseWhoisSk je zdieľaný z core.
 * Parser je unit-testovaný; táto socket obálka je tenká a deploy-gated.
 */
export async function whoisSk(
  domain: string,
): Promise<{ expiresAt: string | null; registrar: string | null }> {
  const socket = connect({ hostname: 'whois.sk-nic.sk', port: 43 });
  try {
    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode(`${domain}\r\n`));
    writer.releaseLock();

    const reader = socket.readable.getReader();
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return parseWhoisSk(out);
  } finally {
    await socket.close();
  }
}
