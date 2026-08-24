export type DnsRecordType = 'A' | 'AAAA';
export type ResolveDns = (hostname: string, recordType: DnsRecordType) => Promise<string[]>;

export class ProviderUrlError extends Error {
  constructor() {
    super('AI_PROVIDER_URL_INVALID');
    this.name = 'ProviderUrlError';
  }
}

function parseIpv4(address: string): number | undefined {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) return undefined;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return undefined;
  return octets.reduce((result, octet) => (result << 8) | octet, 0) >>> 0;
}

function isGlobalIpv4(address: string): boolean | undefined {
  const value = parseIpv4(address);
  if (value === undefined) return undefined;
  const inRange = (base: number, mask: number) => ((value & mask) >>> 0) === (base >>> 0);
  return !(
    inRange(0x00000000, 0xff000000) || inRange(0x0a000000, 0xff000000)
    || inRange(0x64400000, 0xffc00000) || inRange(0x7f000000, 0xff000000)
    || inRange(0xa9fe0000, 0xffff0000) || inRange(0xac100000, 0xfff00000)
    || inRange(0xc0000000, 0xffffff00) || inRange(0xc0000200, 0xffffff00)
    || inRange(0xc0586300, 0xffffff00) || inRange(0xc0a80000, 0xffff0000)
    || inRange(0xc6120000, 0xfffe0000) || inRange(0xc6336400, 0xffffff00)
    || inRange(0xcb007100, 0xffffff00) || value >= 0xe0000000
  );
}

function parseIpv6(address: string): bigint | undefined {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (!value || value.includes('%') || value.includes(':::')) return undefined;
  const separator = value.indexOf('::');
  if (separator !== -1 && separator !== value.lastIndexOf('::')) return undefined;
  const split = (part: string) => part ? part.split(':') : [];
  const [leftText, rightText] = separator === -1
    ? [value, '']
    : [value.slice(0, separator), value.slice(separator + 2)];
  const left = split(leftText);
  const right = split(rightText);
  const all = [...left, ...right];
  const dottedIndex = all.findIndex((part) => part.includes('.'));
  if (dottedIndex !== -1) {
    if (dottedIndex !== all.length - 1) return undefined;
    const ipv4 = parseIpv4(all[dottedIndex]);
    if (ipv4 === undefined) return undefined;
    all.splice(dottedIndex, 1, ((ipv4 >>> 16) & 0xffff).toString(16), (ipv4 & 0xffff).toString(16));
  }
  if (all.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  const missing = 8 - all.length;
  if ((separator === -1 && missing !== 0) || (separator !== -1 && missing < 1)) return undefined;
  const words = separator === -1
    ? all
    : [...all.slice(0, left.length), ...Array<string>(missing).fill('0'), ...all.slice(left.length)];
  if (words.length !== 8) return undefined;
  return BigInt(`0x${words.map((word) => word.padStart(4, '0')).join('')}`);
}

function isInIpv6Range(value: bigint, base: string, prefixLength: number): boolean {
  const parsedBase = parseIpv6(base);
  if (parsedBase === undefined) return false;
  const shift = 128n - BigInt(prefixLength);
  return (value >> shift) === (parsedBase >> shift);
}

const NON_GLOBAL_IPV6_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['100:0:0:1::', 64], ['2001::', 23], ['2001:2::', 48], ['2001:10::', 28],
  ['2001:20::', 28], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
  ['3ffe::', 16], ['5f00::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
];

const GLOBAL_IPV6_ENVELOPE: ReadonlyArray<readonly [string, number]> = [
  ['2000::', 3],
  ['64:ff9b::', 96],
];

function isGlobalIpv6(address: string): boolean | undefined {
  const value = parseIpv6(address);
  if (value === undefined) return undefined;
  if (NON_GLOBAL_IPV6_RANGES.some(([base, prefix]) => isInIpv6Range(value, base, prefix))) return false;
  return GLOBAL_IPV6_ENVELOPE.some(([base, prefix]) => isInIpv6Range(value, base, prefix));
}

/** True only for syntactically valid IP literals reserved for non-global use. */
export function isNonGlobalIpLiteral(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  const global = normalized.includes(':') ? isGlobalIpv6(normalized) : isGlobalIpv4(normalized);
  return global === false;
}

function isGlobalDnsRecord(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  const global = normalized.includes(':') ? isGlobalIpv6(normalized) : isGlobalIpv4(normalized);
  return global === true;
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
    url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
    || isNonGlobalIpLiteral(hostname) || !normalizeAllowedHosts(allowedHosts).has(hostname)
  ) throw new ProviderUrlError();

  let records: string[];
  try {
    const [ipv4, ipv6] = await Promise.all([resolveDns(hostname, 'A'), resolveDns(hostname, 'AAAA')]);
    records = [...ipv4, ...ipv6];
  } catch {
    throw new ProviderUrlError();
  }

  if (!records.length || records.some((record) => !isGlobalDnsRecord(record))) throw new ProviderUrlError();
  return url;
}
