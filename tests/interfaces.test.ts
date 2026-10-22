import { describe, expect, it } from "vitest";
import { normalizeManualEndpoint } from "../src/shared/endpoint";

describe("normalizeManualEndpoint", () => {
  it("adds the websocket scheme and default port to an IP", () => {
    expect(normalizeManualEndpoint("26.12.3.4")).toBe(
      "ws://26.12.3.4:42800/"
    );
  });

  it("keeps an explicit port", () => {
    expect(normalizeManualEndpoint("26.12.3.4:41000")).toBe(
      "ws://26.12.3.4:41000/"
    );
  });
});
