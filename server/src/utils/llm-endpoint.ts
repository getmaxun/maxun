import * as dns from 'dns';
import * as dnsPromises from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';

/**
 * Resolves the OpenAI-compatible credential for an outbound LLM call.
 *
 * A key configured on the robot is always used. The server's own
 * OPENAI_API_KEY is only released when the request is going to an endpoint the
 * operator configured, so pointing a robot at some other base URL and leaving
 * its key unset no longer hands the operator's credential to that endpoint.
 */
export function resolveOpenAiApiKey(configuredKey?: unknown, baseUrl?: unknown): string {
  const supplied = normalize(configuredKey);
  if (supplied) return supplied;

  const target = normalize(baseUrl);
  const operatorConfigured =
    !target ||
    target === normalize(OPENAI_DEFAULT_BASE_URL) ||
    target === normalize(process.env.OPENAI_BASE_URL);

  return operatorConfigured ? process.env.OPENAI_API_KEY || '' : '';
}

/**
 * Link-local addresses, which is where cloud instance metadata lives
 * (169.254.169.254 on AWS, GCP and Azure). No LLM runs on one of these, so
 * refusing them costs nothing, while leaving loopback and LAN addresses
 * reachable keeps a self-hosted Ollama, LM Studio or vLLM working.
 */
function isLinkLocalIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 169 && b === 254;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice('::ffff:'.length);
      return net.isIPv4(mapped) ? isLinkLocalIp(mapped) : false;
    }
    const firstHextet = Number.parseInt(lower.split(':', 1)[0] || '0', 16);
    return (firstHextet & 0xffc0) === 0xfe80;
  }

  return false;
}

/**
 * Resolution used by the outbound LLM agents. Checking here rather than only
 * against the configured string binds the check to the address the socket
 * actually connects to, so a hostname that resolves to metadata, or a redirect
 * onto one, is refused as well.
 */
const llmLookup = (
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
    const blocked = resolved.find((entry) => isLinkLocalIp(entry.address));

    if (blocked) {
      callback(
        new Error(`Refusing to connect to link-local address (${blocked.address})`),
        '',
        0
      );
      return;
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

/**
 * Spread into every outbound LLM axios call. Only the agents are set, so
 * timeouts, signals and redirect behaviour stay exactly as each caller had them.
 */
export const LLM_AGENTS = {
  httpAgent: new http.Agent({ lookup: llmLookup } as http.AgentOptions),
  httpsAgent: new https.Agent({ lookup: llmLookup } as https.AgentOptions),
};

/**
 * Pre-flight check for the fetch-based callers, which cannot take an agent and
 * so have no connection-time check to fall back on.
 *
 * Callers pass the fully resolved base URL, not the caller-supplied one, so an
 * environment fallback is checked too. A name that fails to resolve is refused
 * rather than allowed through: letting it pass would hand the decision to
 * whatever the request itself resolves later.
 */
export async function assertLlmBaseUrlAllowed(baseUrl?: unknown): Promise<void> {
  const target = normalize(baseUrl);
  if (!target) return;

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error('Invalid LLM base URL');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  let addresses: string[];
  try {
    addresses = net.isIP(hostname)
      ? [hostname]
      : (await dnsPromises.lookup(hostname, { all: true })).map((r) => r.address);
  } catch {
    throw new Error(`Could not resolve LLM base URL host (${hostname})`);
  }

  if (addresses.length === 0) {
    throw new Error(`Could not resolve LLM base URL host (${hostname})`);
  }

  const blocked = addresses.find(isLinkLocalIp);
  if (blocked) {
    throw new Error(`Refusing to connect to link-local address (${blocked})`);
  }
}

/**
 * Synchronous guard applied where a base URL is resolved.
 *
 * The agent lookup above only runs when Node has a hostname to resolve; a URL
 * written as a bare IP connects without ever consulting it, which is exactly
 * how the metadata endpoint is reached. Checking the literal here closes that,
 * and the two together cover both spellings.
 */
export function guardLlmBaseUrl(baseUrl: string): string {
  try {
    const hostname = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(hostname) && isLinkLocalIp(hostname)) {
      throw new Error(`Refusing to connect to link-local address (${hostname})`);
    }
  } catch (error: any) {
    if (error && /link-local/.test(error.message)) throw error;
  }

  return baseUrl;
}
