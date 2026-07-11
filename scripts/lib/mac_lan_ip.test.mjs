import { describe, expect, test } from "vitest";
import { detectMacLanIp, isUsableIpv4 } from "./mac_lan_ip.mjs";

describe("detectMacLanIp", () => {
  test("prefers the requested interface when it has a usable IPv4 address", () => {
    const result = detectMacLanIp({
      preferredInterface: "en7",
      interfaces: {
        en0: [ipv4("192.168.2.10")],
        en7: [ipv4("10.0.0.8")],
      },
    });

    expect(result).toMatchObject({
      address: "10.0.0.8",
      interfaceName: "en7",
    });
  });

  test("uses en0 before other external interfaces by default", () => {
    const result = detectMacLanIp({
      interfaces: {
        en5: [ipv4("10.0.0.8")],
        en0: [ipv4("192.168.2.10")],
      },
    });

    expect(result).toMatchObject({
      address: "192.168.2.10",
      interfaceName: "en0",
    });
  });

  test("skips loopback, link-local, internal, and virtual interfaces", () => {
    const result = detectMacLanIp({
      interfaces: {
        lo0: [ipv4("127.0.0.1")],
        awdl0: [ipv4("192.168.99.9")],
        en0: [ipv4("169.254.1.20"), ipv4("0.0.0.0")],
        en1: [ipv4("172.16.0.5", true), ipv4("172.16.0.6")],
      },
    });

    expect(result).toMatchObject({
      address: "172.16.0.6",
      interfaceName: "en1",
    });
  });

  test("returns null when no usable IPv4 address exists", () => {
    expect(detectMacLanIp({
      interfaces: {
        lo0: [ipv4("127.0.0.1")],
        en0: [ipv6("fe80::1")],
      },
    })).toBeNull();
  });
});

describe("isUsableIpv4", () => {
  test("accepts only external non-link-local IPv4 addresses", () => {
    expect(isUsableIpv4(ipv4("192.168.2.10"))).toBe(true);
    expect(isUsableIpv4(ipv4("127.0.0.1"))).toBe(false);
    expect(isUsableIpv4(ipv4("169.254.1.1"))).toBe(false);
    expect(isUsableIpv4(ipv4("192.168.2.10", true))).toBe(false);
    expect(isUsableIpv4(ipv6("fe80::1"))).toBe(false);
  });
});

function ipv4(address, internal = false) {
  return { address, family: "IPv4", internal };
}

function ipv6(address, internal = false) {
  return { address, family: "IPv6", internal };
}
