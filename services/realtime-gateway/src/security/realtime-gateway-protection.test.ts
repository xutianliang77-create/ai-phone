import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import type { RealtimeEnv } from "../config/env.js";
import {
  RealtimeGatewayProtection,
  RealtimeMessageRateGuard,
  clientIpFromRequest,
} from "./realtime-gateway-protection.js";

describe("realtime gateway public entry protection", () => {
  it("enforces origin and per-IP connection capacity", async () => {
    const protection = new RealtimeGatewayProtection(env());
    await protection.start();

    expect(await protection.reserve(request("https://evil.example"))).toMatchObject({
      ok: false,
      statusCode: 403,
    });
    const first = await protection.reserve(request("https://call.example.cn"));
    expect(first).toMatchObject({ ok: true, clientIp: "203.0.113.9" });
    expect(await protection.reserve(request("https://call.example.cn"))).toMatchObject({
      ok: false,
      statusCode: 503,
    });
    if (first.ok) protection.release(first.clientIp);
    expect(await protection.reserve(request("https://call.example.cn"))).toMatchObject({
      ok: true,
    });
    await protection.close();
  });

  it("trusts forwarded addresses only from configured proxies", () => {
    expect(clientIpFromRequest(request(undefined, "127.0.0.1"), ["127.0.0.1"]))
      .toBe("203.0.113.9");
    expect(clientIpFromRequest(request(undefined, "192.0.2.5"), ["127.0.0.1"]))
      .toBe("192.0.2.5");
  });

  it("bounds total and audio message rates independently", () => {
    const guard = new RealtimeMessageRateGuard(2, 1);

    expect(guard.consume("message", 1000)).toBe(true);
    expect(guard.consume("message", 1000)).toBe(true);
    expect(guard.consume("message", 1000)).toBe(false);
    expect(guard.consume("audio", 1000)).toBe(true);
    expect(guard.consume("audio", 1000)).toBe(false);
    expect(guard.consume("message", 2000)).toBe(true);
  });
});

function env() {
  return {
    allowedOrigins: ["https://call.example.cn"],
    trustProxyAddresses: ["127.0.0.1"],
    maxPayloadBytes: 65_536,
    maxConnections: 2,
    maxConnectionsPerIp: 1,
    maxSessions: 1,
    maxMessagesPerSecond: 2,
    maxAudioFramesPerSecond: 1,
    maxPendingAudioMs: 6000,
    maxPendingControlEvents: 2,
    maxPendingTtsOutputs: 2,
    handshakeRateLimitPerMinute: 10,
    publicRateLimitProvider: "memory",
    publicRateLimitKeyPrefix: "test:gateway",
    publicRateLimitKeySecret: "test-only",
    publicRateLimitConnectTimeoutMs: 250,
  } as RealtimeEnv;
}

function request(origin?: string, remoteAddress = "127.0.0.1") {
  return {
    headers: {
      ...(origin ? { origin } : {}),
      "x-forwarded-for": "203.0.113.9",
    },
    socket: { remoteAddress },
  } as IncomingMessage;
}
