import * as dns from 'dns/promises';
import * as net from 'net';

export interface WebhookUrlCheck {
  safe: boolean;
  reason?: string;
}

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
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80')
    );
  }

  return false;
}

/**
 * Validates that a webhook destination is safe to call. Resolves the hostname
 * so that a public name pointing at an internal address is rejected too.
 */
export async function validateWebhookUrl(urlString: string): Promise<WebhookUrlCheck> {
  const allowPrivateTargets = process.env.ALLOW_PRIVATE_WEBHOOK_URLS === 'true';
  let parsed: URL;

  try {
    parsed = new URL(urlString);
  } catch {
    return { safe: false, reason: 'Invalid webhook URL format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: 'Only http and https webhook URLs are allowed' };
  }

  if (allowPrivateTargets) {
    return { safe: true };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  let addresses: string[];
  try {
    if (net.isIP(hostname)) {
      addresses = [hostname];
    } else {
      const results = await dns.lookup(hostname, { all: true });
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
 * Shared axios options for every outbound webhook call. Redirects are refused
 * so that a validated public URL cannot forward the request to an internal one.
 */
export const WEBHOOK_REQUEST_OPTIONS = {
  maxRedirects: 0,
};
