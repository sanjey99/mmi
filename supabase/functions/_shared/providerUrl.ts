export type DnsRecordType = 'A' | 'AAAA';
export type ResolveDns = (hostname: string, recordType: DnsRecordType) => Promise<string[]>;

export class ProviderUrlError extends Error {
  constructor() {
    super('AI_PROVIDER_URL_INVALID');
    this.name = 'ProviderUrlError';
  }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice('::ffff:'.length));
  return normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff');
}

export function isPrivateOrSpecialIp(address: string): boolean {
  return address.includes(':') ? isPrivateIpv6(address) : isPrivateIpv4(address);
}

function normalizeAllowedHosts(allowedHosts: Iterable<string>): Set<string> {
  return new Set([...allowedHosts].map((host) => host.trim().toLowerCase()).filter(Boolean));
}

/**
 * Validates a credential-bearing provider destination before any request is sent.
 * DNS is injected so tests can cover rebinding and IPv6 paths deterministically.
 */
export async function assertSafeProviderUrl(
  value: string,
  allowedHosts: Iterable<string>,
  resolveDns: ResolveDns,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderUrlError();
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
    || isPrivateOrSpecialIp(hostname)
    || !normalizeAllowedHosts(allowedHosts).has(hostname)
  ) {
    throw new ProviderUrlError();
  }

  let records: string[];
  try {
    const [ipv4, ipv6] = await Promise.all([resolveDns(hostname, 'A'), resolveDns(hostname, 'AAAA')]);
    records = [...ipv4, ...ipv6];
  } catch {
    throw new ProviderUrlError();
  }

  if (!records.length || records.some(isPrivateOrSpecialIp)) throw new ProviderUrlError();
  return url;
}
