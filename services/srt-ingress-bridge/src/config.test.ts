import { describe, expect, it } from "vitest";
import { loadSrtIngressBridgeConfig } from "./config.js";

describe("loadSrtIngressBridgeConfig", () => {
  it("loads an isolated bounded bridge configuration", () => {
    const config = loadSrtIngressBridgeConfig({
      SRT_INGRESS_BRIDGE_API_KEY: "0123456789abcdef",
      SRT_INGRESS_PUBLIC_HOST: "srt.example.cn",
      SRT_INGRESS_RTMP_ALLOWED_HOSTS: "ingress.example.cn",
      SRT_INGRESS_PORT_MIN: "10080",
      SRT_INGRESS_PORT_MAX: "10083",
      SRT_INGRESS_MAX_JOBS: "4",
    });
    expect(config.publicHost).toBe("srt.example.cn");
    expect(config.rtmpAllowedHosts).toEqual(["ingress.example.cn"]);
    expect(config.maxJobs).toBe(4);
  });

  it("rejects a port pool smaller than the job cap", () => {
    expect(() => loadSrtIngressBridgeConfig({
      SRT_INGRESS_BRIDGE_API_KEY: "0123456789abcdef",
      SRT_INGRESS_PUBLIC_HOST: "srt.example.cn",
      SRT_INGRESS_RTMP_ALLOWED_HOSTS: "ingress.example.cn",
      SRT_INGRESS_PORT_MIN: "10080",
      SRT_INGRESS_PORT_MAX: "10080",
      SRT_INGRESS_MAX_JOBS: "2",
    })).toThrow(/port range/);
  });
});
