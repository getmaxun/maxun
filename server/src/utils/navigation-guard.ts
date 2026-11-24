import * as dnsPromises from 'dns/promises';
import * as net from 'net';
import type { BrowserContext, Page, Request, Route } from 'playwright-core';
import logger from '../logger';

/**
 * SSRF protection for everything the server-side browser loads.
 *
 * The browser runs inside our network, so any URL a user can make it open
 * (robot URLs, the recorder's address bar, SDK scrape/crawl/extract targets,
 * links followed while crawling, iframes and fetches made by a page) could
 * otherwise reach loopback services, private networks and cloud metadata
 * endpoints such as http://169.254.169.254/.
 *
 * Self-hosted deployments that intentionally scrape intranet sites can opt
 * out with ALLOW_PRIVATE_NAVIGATION_URLS=true.
 */
export const allowPrivateNavigation = (): boolean =>
  process.env.ALLOW_PRIVATE_NAVIGATION_URLS === 'true';

export class BlockedNavigationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedNavigationError';
  }
}

export interface NavigationUrlCheck {
  safe: boolean;
  reason?: string;
}

const parseIPv4 = (ip: string): number[] | null => {
  if (!net.isIPv4(ip)) return null;
  return ip.split('.').map(Number);
};

const isPrivateIPv4 = ([a, b, c]: number[]): boolean =>
  a === 0 ||                                   // "this" network
  a === 10 ||                                  // RFC1918
  a === 127 ||                                 // loopback
  (a === 100 && b >= 64 && b <= 127) ||        // carrier-grade NAT
  (a === 169 && b === 254) ||                  // link-local, cloud metadata
  (a === 172 && b >= 16 && b <= 31) ||         // RFC1918
  (a === 192 && b === 0 && c === 0) ||         // IETF protocol assignments
  (a === 192 && b === 168) ||                  // RFC1918
  (a === 198 && (b === 18 || b === 19)) ||     // benchmarking
  a >= 224;                                    // multicast, reserved, broadcast

/** Expands an IPv6 address (optionally with an embedded IPv4 tail) to 8 hextets. */
const parseIPv6 = (ip: string): number[] | null => {
  if (!net.isIPv6(ip)) return null;
  let address = ip.toLowerCase().split('%')[0];

  const v4Tail = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const octets = parseIPv4(v4Tail[1]);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    address = address.slice(0, -v4Tail[1].length) + `${high}:${low}`;
  }

  const [head, tail] = address.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (address.includes('::') ? missing < 0 : missing !== 0) return null;

  const hextets = [
    ...headParts,
    ...Array(address.includes('::') ? missing : 0).fill('0'),
    ...tailParts,
  ].map((part) => Number.parseInt(part, 16));

  return hextets.length === 8 && hextets.every((h) => Number.isInteger(h) && h >= 0 && h <= 0xffff)
    ? hextets
    : null;
};

const embeddedIPv4 = (high: number, low: number): number[] => [
  high >> 8, high & 0xff, low >> 8, low & 0xff,
];

/**
 * True for addresses a scraping browser has no legitimate reason to reach:
 * loopback, private ranges, link-local (including cloud metadata), carrier-grade
 * NAT, multicast/reserved space, and the IPv6 equivalents, including IPv4
 * addresses smuggled inside IPv4-mapped, IPv4-compatible, NAT64 and 6to4 forms.
 */
export function isPrivateIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPrivateIPv4(v4);

  const h = parseIPv6(ip.replace(/^\[|\]$/g, ''));
  if (!h) return false;

  const leadingZeros = (n: number) => h.slice(0, n).every((x) => x === 0);

  if (leadingZeros(8)) return true;                                   // ::
  if (leadingZeros(7) && h[7] === 1) return true;                     // ::1
  if (leadingZeros(5) && h[5] === 0xffff) return isPrivateIPv4(embeddedIPv4(h[6], h[7])); // ::ffff:a.b.c.d
  if (leadingZeros(6)) return isPrivateIPv4(embeddedIPv4(h[6], h[7])); // ::a.b.c.d (deprecated)
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIPv4(embeddedIPv4(h[6], h[7]));                   // NAT64 64:ff9b::/96
  }
  if (h[0] === 0x2002) return isPrivateIPv4(embeddedIPv4(h[1], h[2])); // 6to4
  if ((h[0] & 0xfe00) === 0xfc00) return true;                        // unique local fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true;                        // link-local fe80::/10
  if ((h[0] & 0xffc0) === 0xfec0) return true;                        // site-local fec0::/10
  if ((h[0] & 0xff00) === 0xff00) return true;                        // multicast

  return false;
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata', 'metadata.google.internal']);
const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.internal'];

const stripBrackets = (hostname: string) => hostname.replace(/^\[|\]$/g, '');

/**
 * Checks that need no network access: scheme, reserved hostnames and IP
 * literals. Returns `needsDns: true` when the host is a name that must be
 * resolved before it can be trusted.
 */
export function checkNavigationUrlSync(
  rawUrl: string
): NavigationUrlCheck & { needsDns?: boolean; hostname?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: 'Only http(s) URLs are allowed' };
  }

  if (allowPrivateNavigation()) return { safe: true };

  // The WHATWG parser already canonicalises decimal/hex/octal IPv4 forms
  // (e.g. http://2852039166/ -> 169.254.169.254), so literals are reliable here.
  const hostname = stripBrackets(parsed.hostname.toLowerCase()).replace(/\.$/, '');

  if (net.isIP(hostname)) {
    return isPrivateIp(hostname)
      ? { safe: false, reason: `URL points to a private or reserved address (${hostname})` }
      : { safe: true };
  }

  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return { safe: false, reason: `URL points to an internal host (${hostname})` };
  }

  return { safe: true, needsDns: true, hostname };
}

const DNS_CACHE_TTL_MS = 60_000;
const DNS_CACHE_MAX = 2_000;
const dnsCache = new Map<string, { expires: number; privateAddress: string | null }>();
const dnsInFlight = new Map<string, Promise<string | null>>();

/**
 * Synchronous cache probe: the private address a hostname is known to map to,
 * null if it is known to be public, or undefined if it has not been resolved
 * recently.
 */
function cachedPrivateAddress(hostname: string): string | null | undefined {
  const cached = dnsCache.get(hostname);
  return cached && cached.expires > Date.now() ? cached.privateAddress : undefined;
}

/**
 * Resolves a hostname and returns the first private address it maps to, or
 * null if every address is public. Throws when the name cannot be resolved.
 */
async function findPrivateAddress(hostname: string): Promise<string | null> {
  const cached = cachedPrivateAddress(hostname);
  if (cached !== undefined) return cached;

  const pending = dnsInFlight.get(hostname);
  if (pending) return pending;

  const lookup = (async () => {
    try {
      const results = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
      if (results.length === 0) throw new Error(`Could not resolve ${hostname}`);
      const blocked = results.find((r) => isPrivateIp(r.address));
      const privateAddress = blocked ? blocked.address : null;
      if (dnsCache.size >= DNS_CACHE_MAX) dnsCache.clear();
      dnsCache.set(hostname, { expires: Date.now() + DNS_CACHE_TTL_MS, privateAddress });
      return privateAddress;
    } finally {
      dnsInFlight.delete(hostname);
    }
  })();

  dnsInFlight.set(hostname, lookup);
  return lookup;
}

/**
 * Full validation of a user-supplied navigation target, including DNS
 * resolution so that a public name pointing at an internal address is
 * rejected too. Fails closed when the name cannot be resolved.
 */
export async function validateNavigationUrl(rawUrl: unknown): Promise<NavigationUrlCheck> {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { safe: false, reason: 'URL is required' };
  }

  const sync = checkNavigationUrlSync(rawUrl.trim());
  if (!sync.safe || !sync.needsDns || !sync.hostname) return sync;

  try {
    const privateAddress = await findPrivateAddress(sync.hostname);
    if (privateAddress) {
      return {
        safe: false,
        reason: `URL resolves to a private or reserved address (${privateAddress})`,
      };
    }
  } catch {
    return { safe: false, reason: `Could not resolve hostname ${sync.hostname}` };
  }

  return { safe: true };
}

/** Throws a {@link BlockedNavigationError} if the URL is not safe to open. */
export async function assertSafeNavigationUrl(rawUrl: unknown): Promise<void> {
  const check = await validateNavigationUrl(rawUrl);
  if (!check.safe) {
    throw new BlockedNavigationError(`Navigation blocked: ${check.reason}`);
  }
}

/**
 * Decides whether an in-browser request must be blocked. Non-http(s) schemes
 * are not this guard's concern (data:, blob: etc. never reach the network) and
 * unresolvable names are let through so the browser can fail on its own.
 */
async function shouldBlockRequestUrl(rawUrl: string): Promise<string | null> {
  if (!/^https?:/i.test(rawUrl)) return null;
  const sync = checkNavigationUrlSync(rawUrl);
  if (!sync.safe) return sync.reason || 'blocked';
  if (!sync.needsDns || !sync.hostname) return null;
  try {
    const privateAddress = await findPrivateAddress(sync.hostname);
    return privateAddress ? `resolves to private address ${privateAddress}` : null;
  } catch {
    return null;
  }
}

const guardedContexts = new WeakSet<BrowserContext>();

const describeUrl = (rawUrl: string) => {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '<invalid url>';
  }
};

const closeFramePage = (request: Request) => {
  let page: Page | undefined;
  try {
    page = request.frame().page();
  } catch {
    return;
  }
  page?.close().catch(() => {});
};

const blockRequestPage = (request: Request, what: string, reason: string) => {
  logger.log('warn', `[navigation-guard] ${what} ${describeUrl(request.url())} blocked (${reason}); closing page`);
  closeFramePage(request);
};

/**
 * Installs the SSRF guard on a browser context:
 *
 * - every request the context makes (navigations, popups, iframes, XHR/fetch,
 *   subresources) is routed through a check that aborts it when it targets a
 *   private, loopback, link-local or internal destination;
 * - WebSocket connections are routed too and refused for internal targets;
 * - Playwright does not route the individual hops of an HTTP redirect, so any
 *   request (navigation or subresource) redirected into private address space
 *   closes its page so the response cannot be read back;
 *
 * Limits: the redirect check acts after the browser has sent the redirected
 * request, so it stops the response being read back but not a blind request.
 * Names are resolved here and again by the browser, so DNS rebinding between
 * the two lookups is not prevented. Binding the check to the address the
 * browser actually connects to needs an egress firewall or filtering proxy in
 * front of the browser (see SETUP.md).
 *
 * Page-level routes registered elsewhere must call `route.fallback()` (not
 * `route.continue()`) for this context-level guard to see the request.
 * Idempotent per context.
 */
export async function installNavigationGuard(context: BrowserContext): Promise<void> {
  if (allowPrivateNavigation() || guardedContexts.has(context)) return;
  guardedContexts.add(context);

  await context.route('**/*', async (route: Route) => {
    const request = route.request();
    const reason = await shouldBlockRequestUrl(request.url());
    if (reason) {
      logger.log('warn', `[navigation-guard] Blocked ${request.resourceType()} request to ${describeUrl(request.url())}: ${reason}`);
      await route.abort('blockedbyclient').catch(() => {});
      return;
    }
    await route.fallback().catch(() => {});
  });

  await context.routeWebSocket(/.*/, async (ws) => {
    const httpUrl = ws.url().replace(/^ws(s?):/i, 'http$1:');
    const reason = await shouldBlockRequestUrl(httpUrl);
    if (reason) {
      logger.log('warn', `[navigation-guard] Blocked WebSocket to ${describeUrl(httpUrl)}: ${reason}`);
      await ws.close({ code: 1008, reason: 'Blocked' }).catch(() => {});
      return;
    }
    ws.connectToServer();
  });

  context.on('request', (request: Request) => {
    if (!request.redirectedFrom()) return;

    // Literal hosts and recently resolved names are decided synchronously so
    // the page is closed before the request that triggered the redirect can
    // resolve. Names not seen before are resolved asynchronously (best effort).
    const sync = checkNavigationUrlSync(request.url());
    const cached = sync.safe && sync.needsDns && sync.hostname
      ? cachedPrivateAddress(sync.hostname)
      : null;
    if (!sync.safe || cached) {
      blockRequestPage(request, 'Redirect into', sync.reason || `resolves to private address ${cached}`);
      return;
    }
    if (!sync.needsDns || cached === null) return;

    shouldBlockRequestUrl(request.url())
      .then((reason) => { if (reason) blockRequestPage(request, 'Redirect into', reason); })
      .catch(() => {});
  });
}
