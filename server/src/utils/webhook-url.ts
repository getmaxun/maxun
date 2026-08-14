import * as dns from 'dns';
import * as dnsPromises from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';

export interface WebhookUrlCheck {
  safe: boolean;
  reason?: string;
}

const allowPrivateTargets = (): boolean => process.env.ALLOW_PRIVATE_WEBHOOK_URLS === 'true';

/**
 * Blocks addresses that a webhook has no legitimate reason to reach:
 * loopback, private ranges, link-local (including cloud metadata at
 * 169.254.169.254), carrier-grade NAT, and the IPv6 equivalents.
 */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();

    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice('::ffff:'.length);
      if (net.isIPv4(mapped)) return isPrivateIp(mapped);
      return true;
    }

    const firstHextet = Number.parseInt(lower.split(':', 1)[0] || '0', 16);
    const isLinkLocal = (firstHextet & 0xffc0) === 0xfe80;
    const isUniqueLocal = (firstHextet & 0xfe00) === 0xfc00;

    return lower === '::' || lower === '::1' || isLinkLocal || isUniqueLocal;
  }

  return false;
}

/**
 * Validates that a webhook destination is safe to call. Resolves the hostname
 * so that a public name pointing at an internal address is rejected too. This
 * is a fast rejection for the API surface; the authoritative check happens at
 * connection time in safeLookup.
 */
export async function validateWebhookUrl(urlString: unknown): Promise<WebhookUrlCheck> {
  if (typeof urlString !== 'string' || !urlString.trim()) {
    return { safe: false, reason: 'Webhook URL is required' };
  }

  let parsed: URL;

  try {
    parsed = new URL(urlString);
  } catch {
    return { safe: false, reason: 'Invalid webhook URL format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: 'Only http and https webhook URLs are allowed' };
  }

  if (allowPrivateTargets()) {
    return { safe: true };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  let addresses: string[];
  try {
    if (net.isIP(hostname)) {
      addresses = [hostname];
    } else {
      const results = await dnsPromises.lookup(hostname, { all: true });
      addresses = results.map((result) => result.address);
    }
  } catch {
    return { safe: false, reason: 'Could not resolve webhook hostname' };
  }

  if (addresses.length === 0) {
    return { safe: false, reason: 'Could not resolve webhook hostname' };
  }

  for (const address of addresses) {
    if (isPrivateIp(address)) {
      return {
        safe: false,
        reason: `Webhook URL resolves to a private or reserved address (${address})`,
      };
    }
  }

  return { safe: true };
}

/**
 * Resolution used by the outbound webhook agents. Validating here rather than
 * only at request time binds the check to the address the socket actually
 * connects to, which closes the DNS rebinding window left open by validating
 * once up front. The hostname is still passed through for TLS and SNI.
 */
const safeLookup = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: any, family?: number) => void
): void => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, '', 0);
      return;
    }

    const resolved = Array.isArray(addresses) ? addresses : [addresses];

    if (!allowPrivateTargets()) {
      const blocked = resolved.find((entry) => isPrivateIp(entry.address));
      if (blocked) {
        callback(
          new Error(`Refusing to connect to private or reserved address (${blocked.address})`),
          '',
          0
        );
        return;
      }
    }

    if (resolved.length === 0) {
      callback(new Error(`Could not resolve ${hostname}`), '', 0);
      return;
    }

    if (options && options.all) {
      callback(null, resolved);
      return;
    }

    callback(null, resolved[0].address, resolved[0].family);
  });
};

const webhookHttpAgent = new http.Agent({ lookup: safeLookup } as http.AgentOptions);
const webhookHttpsAgent = new https.Agent({ lookup: safeLookup } as https.AgentOptions);

/**
 * Shared axios options for every outbound webhook call. Redirects are refused
 * so that a validated public URL cannot forward the request to an internal one,
 * and the agents re-validate the address at connection time.
 */
export const WEBHOOK_REQUEST_OPTIONS = {
  maxRedirects: 0,
  httpAgent: webhookHttpAgent,
  httpsAgent: webhookHttpsAgent,
};
