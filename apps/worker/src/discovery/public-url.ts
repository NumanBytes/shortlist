import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Links read off a third-party careers page are chosen by the model from that page, so a
// hostile page could point one at the worker's own network — the cloud metadata service
// (169.254.169.254), localhost, the Docker network — and have the worker fetch it (SSRF, code
// review 2026-10-13). Before fetching such a link, every address its host resolves to must be
// public. Since sources can be added by any user from the app (2026-10-14), every worker
// fetch goes through this (http.ts), source URLs included.

const PRIVATE_V4: [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // 169.254/16 link-local (cloud metadata)
  [0xac100000, 12], // 172.16/12
  [0xc0a80000, 16], // 192.168/16
  [0xe0000000, 3], // multicast + reserved
];

function isPrivateV4(ip: string): boolean {
  const n = ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
  return PRIVATE_V4.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateV4(mapped[1]!);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

// Cheap, no-DNS screen for a link before it's stored or shown: http(s), not a private literal,
// not localhost or an internal-only name.
export function looksPublic(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return !isPrivateAddress(host);
  return !/^(localhost|.*\.(localhost|local|internal|lan|home|corp))$/i.test(host) && host.includes('.');
}

export async function assertPublicUrl(url: string): Promise<void> {
  if (!looksPublic(url)) throw new Error(`Refusing to fetch a non-public address: ${url}`);
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return;
  const addresses = await lookup(host, { all: true });
  const bad = addresses.find((a) => isPrivateAddress(a.address));
  if (bad) throw new Error(`Refusing to fetch ${host}: it resolves to a private address`);
}
