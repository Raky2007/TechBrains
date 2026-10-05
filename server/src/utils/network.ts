import os from 'os';

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
    for (const net of netList) {
      // Look for IPv4 that is not internal (127.0.0.1)
      if (net.family === 'IPv4' && !net.internal) {
        results.push({
          interfaceName: name,
          address: net.address
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
