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

export function normalizeManualEndpoint(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("请输入房主地址");
  }

  const withProtocol = /^wss?:\/\//i.test(trimmed)
    ? trimmed
    : `ws://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("地址格式不正确，请使用 IP:端口");
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("仅支持 ws:// 或 wss:// 地址");
  }
  if (!url.port) {
    throw new Error("地址中需要包含信令端口，例如 26.12.3.4:41000");
  }

  return url.toString();
}
