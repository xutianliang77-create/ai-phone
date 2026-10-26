import { describe, expect, it } from "vitest";
import { isPublicReleaseEndpoint, releaseDeferredCapabilities, releaseDistribution } from "./release-distribution.js";

describe("release channel boundary", () => {
  it("preserves the restricted default but rejects unknown channels", () => {
    expect(releaseDistribution(undefined)).toEqual({ channel: "restricted_instance", formal: false, issues: [] });
    expect(releaseDistribution("typo").issues).not.toEqual([]);
  });
  it("does not defer public account delivery, materials or operations for a free core app", () => {
    expect(releaseDeferredCapabilities("core_translation", "app_store"))
      .toEqual(["livekit_sip", "agent", "egress", "payment", "call_link", "web_guest"]);
    expect(releaseDeferredCapabilities("core_translation", "restricted_instance"))
      .toContain("release_materials");
  });
  it.each([
    "http://api.publisher.cn", "https://localhost", "https://127.1", "https://2130706433",
    "https://10.1.2.3", "https://100.110.127.117", "https://172.20.0.1", "https://192.168.1.2",
    "https://[::1]", "https://[fd00::1]", "https://[::ffff:127.0.0.1]", "https://api.example.cn",
    "https://api.invalid", "https://service.internal", "https://user:secret@api.publisher.cn",
    "https://api.publisher.cn?token=secret", "https://api.publisher.cn/#fragment",
  ])("rejects an unsafe or placeholder public edge %s", (url) => {
    expect(isPublicReleaseEndpoint(url, ["https:"])).toBe(false);
  });
  it("allows an explicit TLS public edge without exposing internal model endpoints", () => {
    expect(isPublicReleaseEndpoint("https://api.publisher.cn/v1", ["https:"])).toBe(true);
    expect(isPublicReleaseEndpoint("wss://stream.publisher.cn/realtime/stream", ["wss:"])).toBe(true);
    expect(isPublicReleaseEndpoint("https://stream.publisher.cn", ["wss:"])).toBe(false);
  });
});
