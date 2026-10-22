import { describe, expect, it } from "vitest";
import { normalizeManualEndpoint } from "../src/main/network/interfaces";

describe("normalizeManualEndpoint", () => {
  it("adds the websocket scheme to an IP and port", () => {
    expect(normalizeManualEndpoint("26.12.3.4:41000")).toBe(
      "ws://26.12.3.4:41000/"
    );
  });

  it("requires an explicit signaling port", () => {
    expect(() => normalizeManualEndpoint("26.12.3.4")).toThrow("端口");
  });
});
