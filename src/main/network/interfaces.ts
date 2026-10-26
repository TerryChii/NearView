import os from "node:os";
import type { NetworkInterfaceInfo } from "../../shared/types";

const VIRTUAL_INTERFACE_PATTERN =
  /(radmin|zero.?tier|tailscale|wireguard|wintun|tap|tun|vethernet|vmware|virtualbox|hyper-v|vpn)/i;

function virtualProvider(name: string): {
  provider: string | null;
  priority: number;
} {
  if (/radmin/i.test(name)) {
    return { provider: "Radmin VPN", priority: 0 };
  }
  if (/tailscale/i.test(name)) {
    return { provider: "Tailscale", priority: 1 };
  }
  if (/zero.?tier/i.test(name)) {
    return { provider: "ZeroTier", priority: 2 };
  }
  if (/wireguard|wintun/i.test(name)) {
    return { provider: "WireGuard", priority: 3 };
  }
  if (/vpn|tap|tun/i.test(name)) {
    return { provider: "虚拟网卡", priority: 10 };
  }
  if (/vethernet|hyper-v|vmware|virtualbox|wsl/i.test(name)) {
    return { provider: "系统虚拟交换机", priority: 90 };
  }
  return { provider: null, priority: 100 };
}

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

      const virtual = VIRTUAL_INTERFACE_PATTERN.test(name);
      const virtualInfo = virtualProvider(name);
      results.push({
        id: `${name}:${item.address}`,
        name,
        address: item.address,
        netmask: item.netmask,
        virtual,
        recommended: virtual
          ? virtualInfo.priority < 90
          : isPrivateIpv4(item.address),
        virtualPriority: virtual ? virtualInfo.priority : 1_000,
        provider: virtual ? virtualInfo.provider : null
      });
    }
  }

  return results.sort((a, b) => {
    if (a.virtual !== b.virtual) {
      return a.virtual ? 1 : -1;
    }
    if (a.virtual && a.virtualPriority !== b.virtualPriority) {
      return a.virtualPriority - b.virtualPriority;
    }
    if (a.recommended !== b.recommended) {
      return a.recommended ? -1 : 1;
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
