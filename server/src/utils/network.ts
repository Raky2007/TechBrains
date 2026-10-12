import os from 'os';
import net from 'net';

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  family: string;
  internal: boolean;
  netmask?: string;
}

/**
 * Returns all active non-internal IPv4 addresses on the host machine.
 */
export function getLanIpv4Addresses(): { interfaceName: string; address: string; netmask?: string }[] {
  const interfaces = os.networkInterfaces();
  const results: { interfaceName: string; address: string; netmask?: string }[] = [];

  for (const [name, netList] of Object.entries(interfaces)) {
    if (!netList) continue;
    for (const netInfo of netList) {
      // Look for IPv4 that is not internal (127.0.0.1)
      if (netInfo.family === 'IPv4' && !netInfo.internal) {
        results.push({
          interfaceName: name,
          address: netInfo.address,
          netmask: netInfo.netmask
        });
      }
    }
  }

  // Sort so physical adapters (Ethernet, Wi-Fi, en, eth, wlan) appear first
  results.sort((a, b) => {
    const priority = (name: string) => {
      const lower = name.toLowerCase();
      if (lower.includes('ethernet') || lower.includes('eth')) return 1;
      if (lower.includes('wi-fi') || lower.includes('wlan') || lower.includes('wireless')) return 2;
      if (lower.includes('local area connection')) return 3;
      if (lower.includes('vethernet') || lower.includes('virtual') || lower.includes('wsl')) return 10;
      return 5;
    };
    return priority(a.interfaceName) - priority(b.interfaceName);
  });

  return results;
}

/**
 * Returns the best candidate primary LAN IPv4 address or '127.0.0.1' as fallback
 */
export function getPrimaryLanIpv4(): string {
  const list = getLanIpv4Addresses();
  if (list.length > 0) {
    return list[0].address;
  }
  return '127.0.0.1';
}

/**
 * Checks whether an IPv4 address falls within a given network subnet.
 */
function isIpInSubnet(ip: string, networkIp: string, netmask?: string): boolean {
  if (!netmask || netmask === '0.0.0.0') return false;
  const maskParts = netmask.split('.').map(Number);
  if (maskParts.length !== 4 || maskParts[0] !== 255) return false; // At least a /8 mask required

  const ipParts = ip.split('.').map(Number);
  const netParts = networkIp.split('.').map(Number);
  if (ipParts.length !== 4 || netParts.length !== 4) return false;

  for (let i = 0; i < 4; i++) {
    if (isNaN(ipParts[i]) || isNaN(netParts[i]) || isNaN(maskParts[i])) return false;
    if ((ipParts[i] & maskParts[i]) !== (netParts[i] & maskParts[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Retrieves all IP addresses and hostnames that identify this host machine.
 */
export function getHostIdentifiers(): Set<string> {
  const identifiers = new Set<string>();
  identifiers.add('localhost');
  identifiers.add('127.0.0.1');
  identifiers.add('::1');

  try {
    const host = os.hostname().toLowerCase();
    identifiers.add(host);
    identifiers.add(`${host}.local`);
  } catch {}

  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.address) {
        identifiers.add(info.address.toLowerCase());
      }
    }
  }

  return identifiers;
}

/**
 * Parses user-defined allowed origins from environment variables.
 */
function getConfiguredAllowedOrigins(): string[] {
  const envVars = [
    process.env.CLIENT_URL,
    process.env.CORS_ORIGIN,
    process.env.ALLOWED_ORIGINS,
    process.env.FRONTEND_URL
  ];

  const allowed: string[] = [];
  for (const envVal of envVars) {
    if (!envVal) continue;
    const items = envVal.split(',').map((s) => s.trim()).filter(Boolean);
    allowed.push(...items);
  }
  return allowed;
}

/**
 * Validates whether an incoming HTTP/WebSocket origin belongs to a permitted local or LAN network address.
 */
export function isAllowedLanOrigin(origin?: string): boolean {
  if (!origin) return true; // Same-origin or non-browser client requests

  try {
    const trimmedOrigin = origin.trim();

    // Check wildcard or configured environment variables first
    const configuredOrigins = getConfiguredAllowedOrigins();
    if (configuredOrigins.includes('*') || process.env.CORS_ALLOW_ALL === 'true') {
      return true;
    }

    if (configuredOrigins.some((allowed) => allowed === trimmedOrigin || allowed.replace(/\/+$/, '') === trimmedOrigin.replace(/\/+$/, ''))) {
      return true;
    }

    const url = new URL(trimmedOrigin);

    // Only allow HTTP/HTTPS/WS/WSS protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return false;
    }

    // Strip brackets around IPv6 literals (e.g. [::1] -> ::1)
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // 1. Loopback and Localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    // 2. Direct match with any host machine interface IP or hostname
    const hostIdentifiers = getHostIdentifiers();
    if (hostIdentifiers.has(hostname)) {
      return true;
    }

    // 3. Local network domain suffixes (mDNS / router local domains, never public TLDs)
    if (
      hostname.endsWith('.local') ||
      hostname.endsWith('.lan') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.home')
    ) {
      return true;
    }

    // 4. Strict IPv4 parsing & validation
    if (net.isIPv4(hostname)) {
      const octets = hostname.split('.').map(Number);
      if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) {
        return false;
      }

      // Loopback (127.0.0.0/8)
      if (octets[0] === 127) return true;

      // RFC 1918: 10.0.0.0/8
      if (octets[0] === 10) return true;

      // RFC 1918: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;

      // RFC 1918: 192.168.0.0/16
      if (octets[0] === 192 && octets[1] === 168) return true;

      // Link-local: 169.254.0.0/16
      if (octets[0] === 169 && octets[1] === 254) return true;

      // Carrier-Grade NAT (RFC 6598): 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
      if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;

      // Check if IP belongs to the local subnet of any active host network interface
      const ifaces = os.networkInterfaces();
      for (const netList of Object.values(ifaces)) {
        if (!netList) continue;
        for (const iface of netList) {
          if (iface.family === 'IPv4' && !iface.internal && iface.address && iface.netmask) {
            if (isIpInSubnet(hostname, iface.address, iface.netmask)) {
              return true;
            }
          }
        }
      }
    }

    // 5. IPv6 validation
    if (net.isIPv6(hostname)) {
      // IPv6 Loopback
      if (hostname === '::1') return true;
      // IPv6 Unique Local Address (ULA) fc00::/7 (fc00:: - fdff::)
      if (hostname.startsWith('fc') || hostname.startsWith('fd')) return true;
      // IPv6 Link-Local Address fe80::/10
      if (hostname.startsWith('fe80:')) return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Normalizes a raw peer IP address string (e.g. from Socket.IO handshake or Express socket).
 * Strips IPv4-mapped IPv6 prefixes (::ffff:) and maps loopback addresses to 127.0.0.1.
 */
export function normalizeClientIp(rawIp?: string | null): string {
  if (!rawIp || typeof rawIp !== 'string') return 'unknown';
  let ip = rawIp.trim();
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  if (ip === '::1' || ip.toLowerCase() === 'localhost') {
    return '127.0.0.1';
  }
  return ip || 'unknown';
}

/**
 * Extracts normalized remote client IP directly from a Socket.IO connection's underlying TCP socket.
 */
export function getClientIpFromSocket(socket: { handshake?: { address?: string }; conn?: { remoteAddress?: string } }): string {
  const raw = socket.handshake?.address || socket.conn?.remoteAddress;
  return normalizeClientIp(raw);
}

/**
 * Extracts normalized remote client IP from an Express HTTP request socket.
 */
export function getClientIpFromRequest(req: { socket?: { remoteAddress?: string }; ip?: string }): string {
  const raw = req.socket?.remoteAddress || req.ip;
  return normalizeClientIp(raw);
}

