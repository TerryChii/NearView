export const DEFAULT_SIGNALING_PORT = 42800;

export function normalizeManualEndpoint(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("请输入房主的虚拟局域网 IP");
  }

  const withProtocol = /^wss?:\/\//i.test(trimmed)
    ? trimmed
    : `ws://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("地址格式不正确，请输入房主 IP");
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("仅支持 ws:// 或 wss:// 连接");
  }
  if (!url.hostname) {
    throw new Error("地址中缺少房主 IP");
  }
  if (!url.port) {
    url.port = String(DEFAULT_SIGNALING_PORT);
  }

  return url.toString();
}
