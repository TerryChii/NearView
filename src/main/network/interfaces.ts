import os from "node:os";
import type { NetworkInterfaceInfo } from "../../shared/types";

const VIRTUAL_INTERFACE_PATTERN =
  /(radmin|zero.?tier|tailscale|wireguard|wintun|tap|tun|vethernet|vmware|virtualbox|hyper-v|vpn)/i;

function isPrivateIpv4(address: string): boolean {
  if (address.startsWith("10.") || address.startsWith("192.168.")) {
    return true;
  }

  const match = /^172\.(\d+)\./.exec(address);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function listNetworkInterfaces(): NetworkInterfaceInfo[] {
  const interfaces = os.networkInterfaces();
  const results: NetworkInterfaceInfo[] = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const item of addresses ?? []) {
      if (item.family !== "IPv4" || item.internal) {
        continue;
      }

      results.push({
        id: `${name}:${item.address}`,
        name,
        address: item.address,
        netmask: item.netmask,
        virtual: VIRTUAL_INTERFACE_PATTERN.test(name),
        recommended: isPrivateIpv4(item.address)
      });
    }
  }

  return results.sort((a, b) => {
    if (a.recommended !== b.recommended) {
      return a.recommended ? -1 : 1;
    }
    if (a.virtual !== b.virtual) {
      return a.virtual ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function chooseInterfaceAddress(preferred?: string): string | undefined {
  const interfaces = listNetworkInterfaces();
  if (preferred && interfaces.some((item) => item.address === preferred)) {
    return preferred;
  }
  return interfaces[0]?.address;
}
