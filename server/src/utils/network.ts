import os from 'os';
import net from 'net';

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  family: string;
  internal: boolean;
}

/**
 * Returns all active non-internal IPv4 addresses on the host machine.
 */
export function getLanIpv4Addresses(): { interfaceName: string; address: string }[] {
  const interfaces = os.networkInterfaces();
  const results: { interfaceName: string; address: string }[] = [];

  for (const [name, netList] of Object.entries(interfaces)) {
    if (!netList) continue;
    for (const netInfo of netList) {
      // Look for IPv4 that is not internal (127.0.0.1)
      if (netInfo.family === 'IPv4' && !netInfo.internal) {
        results.push({
          interfaceName: name,
          address: netInfo.address
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
      if (lower.includes('vEthernet') || lower.includes('virtual') || lower.includes('wsl')) return 10;
      return 5;
    };
    return priority(a.interfaceName) - priority(b.interfaceName);
  });

  return results;
}

/**
 * Returns the best candidate primary LAN IPv4 address or 'localhost' as fallback
 */
export function getPrimaryLanIpv4(): string {
  const list = getLanIpv4Addresses();
  if (list.length > 0) {
    return list[0].address;
  }
  return '127.0.0.1';
}

/**
 * Validates whether an incoming HTTP/WebSocket origin belongs to a permitted local or LAN network address.
 */
export function isAllowedLanOrigin(origin?: string): boolean {
  if (!origin) return true; // Same-origin or non-browser client requests
  try {
    const url = new URL(origin);

    // Only allow HTTP/HTTPS protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname;

    // Loopback & localhost
    if (hostname === 'localhost' || hostname === '::1') {
      return true;
    }

    // Strict IPv4 parsing & validation
    if (net.isIPv4(hostname)) {
      const octets = hostname.split('.').map(Number);
      // Loopback (127.0.0.0/8)
      if (octets[0] === 127) return true;
      // 10.0.0.0/8
      if (octets[0] === 10) return true;
      // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
      // 192.168.0.0/16
      if (octets[0] === 192 && octets[1] === 168) return true;
      // Link-local (169.254.0.0/16)
      if (octets[0] === 169 && octets[1] === 254) return true;
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

