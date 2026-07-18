import { describe, expect, it } from "vitest";
import { validateRtmpTarget } from "./job-manager.js";

describe("validateRtmpTarget", () => {
  it("accepts only an exact configured RTMP target host", () => {
    expect(validateRtmpTarget(
      "rtmps://ingress.example.cn/live/stream_key_123",
      ["ingress.example.cn"],
    )?.hostname).toBe("ingress.example.cn");
    expect(validateRtmpTarget(
      "rtmp://evil.example.cn/live/stream_key_123",
      ["ingress.example.cn"],
    )).toBeNull();
  });

  it("rejects credentials, fragments, and empty target paths", () => {
    expect(validateRtmpTarget(
      "rtmp://user:secret@ingress.example.cn/live/key",
      ["ingress.example.cn"],
    )).toBeNull();
    expect(validateRtmpTarget(
      "rtmp://ingress.example.cn/",
      ["ingress.example.cn"],
    )).toBeNull();
    expect(validateRtmpTarget(
      "rtmp://ingress.example.cn/live/key#fragment",
      ["ingress.example.cn"],
    )).toBeNull();
  });
});
