import dns from 'dns';
import net, { LookupFunction } from 'net';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import ipaddr from 'ipaddr.js';
import { logger } from './logger';

/**
 * SSRF (Server-Side Request Forgery) protection.
 *
 * The service fetches arbitrary user-supplied URLs, so every outbound request
 * must be prevented from reaching internal / cloud-metadata / loopback targets.
 *
 * Strategy (defense in depth):
 *  1. `assertPublicUrl(url)` — a cheap pre-flight check: scheme allow-list +
 *     DNS resolution + reject if ANY resolved address is non-public. Call this
 *     before kicking off a scrape/crawl so bad URLs fail fast with a 400.
 *  2. `ssrfSafeHttpAgent` / `ssrfSafeHttpsAgent` — HTTP(S) agents whose DNS
 *     `lookup` re-validates the resolved IP at *connection* time, for every
 *     request including each redirect hop. This closes the TOCTOU / DNS-rebinding
 *     gap that a pre-flight check alone cannot.
 *
 * IP classification uses `ipaddr.js`: only genuine global `unicast` addresses are
 * allowed. Everything else (loopback 127/8 & ::1, private 10/172.16/192.168,
 * link-local 169.254/16 incl. the 169.254.169.254 cloud-metadata endpoint,
 * carrier-grade NAT 100.64/10, unspecified 0.0.0.0/::, multicast, reserved,
 * IPv4-mapped IPv6, 6to4/Teredo, unique-local fc00::/7) is rejected.
 */

export class SsrfError extends Error {
  public readonly code = 'SSRF_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * When true (default), private targets are blocked. Set
 * ALLOW_PRIVATE_NETWORK_SCRAPE=true only for trusted internal deployments.
 */
function privateNetworkAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_NETWORK_SCRAPE === 'true';
}

/**
 * Returns true only for genuine, publicly-routable unicast addresses.
 * IPv4-mapped IPv6 addresses are unwrapped and re-checked as IPv4.
 */
export function isPublicIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return false;
  }

  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      addr = v6.toIPv4Address();
    }
  }

  // ipaddr.js range() buckets every non-global category; only 'unicast' is
  // publicly routable for both IPv4 and IPv6.
  return addr.range() === 'unicast';
}

/**
 * Validate a hostname string that may itself be an IP literal.
 * Returns the reason string if blocked, or null if allowed.
 */
function classifyHostLiteral(hostname: string): string | null {
  // Strip IPv6 brackets, e.g. "[::1]" -> "::1"
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  if (net.isIP(host)) {
    return isPublicIp(host) ? null : `blocked non-public IP literal: ${host}`;
  }
  return null; // not an IP literal — must be resolved via DNS
}

/**
 * Resolve a hostname and return all addresses, or throw SsrfError if any is
 * non-public. Used by the pre-flight check.
 */
async function resolveAndValidate(hostname: string): Promise<void> {
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  const addresses = await new Promise<dns.LookupAddress[]>((resolve, reject) => {
    dns.lookup(host, { all: true, verbatim: true }, (err, addrs) => {
      if (err) reject(err);
      else resolve(addrs as dns.LookupAddress[]);
    });
  });

  if (!addresses.length) {
    throw new SsrfError(`hostname did not resolve: ${host}`);
  }

  for (const a of addresses) {
    if (!isPublicIp(a.address)) {
      throw new SsrfError(`hostname ${host} resolves to non-public address ${a.address}`);
    }
  }
}

/**
 * Pre-flight SSRF check. Throws SsrfError for disallowed schemes, malformed
 * URLs, IP-literal hosts in private ranges, or hostnames that resolve to any
 * non-public address. Safe to call on every user-supplied URL before fetching.
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  if (privateNetworkAllowed()) return;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfError(`invalid URL: ${String(rawUrl).slice(0, 200)}`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SsrfError(`disallowed protocol: ${parsed.protocol}`);
  }

  const literalReason = classifyHostLiteral(parsed.hostname);
  if (literalReason) {
    throw new SsrfError(literalReason);
  }

  // Not an IP literal -> resolve DNS and validate every address.
  if (!net.isIP(parsed.hostname.replace(/^\[|\]$/g, ''))) {
    await resolveAndValidate(parsed.hostname);
  }
}

/**
 * A DNS lookup function that validates every resolved address before allowing a
 * connection. Installed on the shared agents so redirects and rebinding are
 * caught at connect time. Signature matches Node's `net`/`http` lookup option.
 */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | dns.LookupAddress[],
  family?: number
) => void;

function ssrfSafeLookup(
  hostname: string,
  options: dns.LookupOptions | LookupCallback,
  callback?: LookupCallback
): void {
  const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
  const opts = (typeof options === 'function' ? {} : options) || {};

  if (privateNetworkAllowed()) {
    dns.lookup(hostname, opts as dns.LookupOptions, cb as never);
    return;
  }

  dns.lookup(hostname, { all: true, verbatim: true, family: (opts as dns.LookupOptions).family }, (err, addresses) => {
    if (err) {
      cb(err);
      return;
    }
    const addrs = addresses as dns.LookupAddress[];
    for (const a of addrs) {
      if (!isPublicIp(a.address)) {
        cb(new SsrfError(`SSRF blocked: ${hostname} resolves to non-public ${a.address}`) as NodeJS.ErrnoException);
        return;
      }
    }
    if ((opts as dns.LookupOptions).all) {
      cb(null, addrs);
    } else {
      cb(null, addrs[0].address, addrs[0].family);
    }
  });
}

const lookupFn = ssrfSafeLookup as unknown as LookupFunction;
export const ssrfSafeHttpAgent = new HttpAgent({ lookup: lookupFn, keepAlive: true, maxSockets: 64 });
export const ssrfSafeHttpsAgent = new HttpsAgent({ lookup: lookupFn, keepAlive: true, maxSockets: 64 });

/**
 * The SSRF-safe DNS lookup, exported so callers that must build a custom agent
 * (e.g. an https.Agent with rejectUnauthorized:false) can still validate IPs.
 */
export { ssrfSafeLookup };

/**
 * Build an https.Agent that keeps SSRF-safe DNS validation but optionally
 * disables TLS certificate verification (only when the caller explicitly opts
 * in via skipTlsVerification). DNS-level SSRF protection is preserved either way.
 */
export function buildHttpsAgent(skipTlsVerification: boolean): HttpsAgent {
  if (skipTlsVerification) {
    return new HttpsAgent({ lookup: lookupFn, rejectUnauthorized: false, keepAlive: true, maxSockets: 64 });
  }
  return ssrfSafeHttpsAgent;
}

/**
 * Axios/http config fragment that installs the SSRF-safe agents. Spread this
 * into every axios request that fetches a user-influenced URL. Redirects are
 * validated because the agents are reused across hops.
 */
export function ssrfSafeRequestConfig(): {
  httpAgent: HttpAgent;
  httpsAgent: HttpsAgent;
} {
  return { httpAgent: ssrfSafeHttpAgent, httpsAgent: ssrfSafeHttpsAgent };
}

/**
 * Best-effort guard for Playwright: returns a request-route predicate that
 * aborts any request to a private IP literal. Full DNS-rebinding protection in
 * a browser context is not achievable here; pair this with `assertPublicUrl`
 * on the navigation target.
 */
export function isBlockedRequestUrl(requestUrl: string): boolean {
  if (privateNetworkAllowed()) return false;
  try {
    const u = new URL(requestUrl);
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) return false; // let browser handle data:, blob:, etc.
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) {
      return !isPublicIp(host);
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Wrap an async fetch operation so SSRF rejections are logged consistently.
 */
export function logSsrfBlock(context: string, url: string, err: unknown): void {
  if (err instanceof SsrfError || (err as { code?: string })?.code === 'SSRF_BLOCKED') {
    logger.warn(`SSRF blocked (${context}): ${(err as Error).message} [url=${url}]`);
  }
}
