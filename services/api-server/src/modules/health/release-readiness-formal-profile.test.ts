import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { captureEnv, clearEnv, configureAccountEnv, configureCallRoomEnv, restoreEnv } from "./health-readiness-test-helpers.js";
import type { PublicEntryRateLimiter } from "../../infrastructure/security/public-entry-protection.js";

const gates = vi.hoisted(() => ({ sms: true, materials: true, diagnostics: true }));
vi.mock("../account/sms-provider.js", async (original) => ({
  ...await original<typeof import("../account/sms-provider.js")>(),
  getSmsDeploymentReadiness: () => ({ status: gates.sms ? "ready" : "not_ready", issues: gates.sms ? [] : ["formal sms missing"] }),
}));
vi.mock("./release-materials-readiness.js", async (original) => ({
  ...await original<typeof import("./release-materials-readiness.js")>(),
  getReleaseMaterialsReadiness: () => ({ status: gates.materials ? "ready" : "not_ready", issues: gates.materials ? [] : ["formal materials missing"] }),
}));
vi.mock("../diagnostics/diagnostics-alerting.js", async (original) => ({
  ...await original<typeof import("../diagnostics/diagnostics-alerting.js")>(),
  getDiagnosticsDeploymentReadiness: async () => ({ status: gates.diagnostics ? "ready" : "not_ready", issues: gates.diagnostics ? [] : ["formal diagnostics missing"] }),
}));

describe("formal core release production route", () => {
  let saved: Record<string, string | undefined>;
  let extra: Record<string, string | undefined>;
  const keys = ["DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL", "API_BASE_URL", "REALTIME_WS_ENDPOINT", "REALTIME_TOKEN_SECRET"];
  beforeEach(() => {
    saved = captureEnv(); extra = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    clearEnv(); configureAccountEnv(); configureCallRoomEnv();
    process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL = "app_store";
    process.env.API_BASE_URL = "https://api.publisher.cn";
    process.env.REALTIME_WS_ENDPOINT = "wss://stream.publisher.cn/realtime/stream";
    process.env.REALTIME_TOKEN_SECRET = "fixture-only-32-byte-gateway-key-material";
    process.env.PUBLIC_RATE_LIMIT_PROVIDER = "redis";
    process.env.PUBLIC_RATE_LIMIT_REDIS_URL = "redis://redis.test:6379/1";
    process.env.PUBLIC_RATE_LIMIT_KEY_SECRET = "test-rate-limit-secret";
    Object.assign(gates, { sms: true, materials: true, diagnostics: true });
  });
  afterEach(() => {
    restoreEnv(saved);
    for (const k of keys) { if (extra[k] === undefined) delete process.env[k]; else process.env[k] = extra[k]; }
  });

  it("accepts configured free core without requiring payment or PSTN", async () => {
    const response = await readiness();
    expect(response.statusCode).toBe(200);
    expect(response.json().capabilityProfileReadiness.deferredCapabilities)
      .toEqual(["livekit_sip", "agent", "egress", "payment", "call_link", "web_guest"]);
  });
  it.each(["sms", "materials", "diagnostics"] as const)("rejects a missing mandatory %s gate", async (key) => {
    gates[key] = false;
    const response = await readiness();
    expect(response.statusCode).toBe(503);
    expect(response.json().issues).toContain(`formal ${key} missing`);
  });
  it("does not accept a tailnet-only endpoint for an App Store release", async () => {
    process.env.API_BASE_URL = "https://100.110.127.117";
    expect((await readiness()).statusCode).toBe(503);
  });
  it("fails closed on an unknown channel", async () => {
    process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL = "app_stroe";
    expect((await readiness()).statusCode).toBe(503);
  });
  it("does not issue a call link or guest room token in the deferred formal scope", async () => {
    const app = await buildApp({ publicEntryRateLimiter: readyRateLimiter() });
    try {
      for (const url of ["/call-links", "/call-links/fixture/guest-ticket", "/call-links/fixture/room-token"]) {
        const response = await app.inject({ method: "POST", url, payload: {} });
        expect(response.statusCode).toBe(503);
        expect(response.json().error.code).toBe("call_link_not_in_release");
      }
    } finally { await app.close(); }
  });
  it("keeps purchase and voice-enrollment POSTs closed without executing them", async () => {
    const app = await buildApp({ publicEntryRateLimiter: readyRateLimiter() });
    try {
      for (const [url, code] of [["/billing/orders", "purchases_not_in_release"],
        ["/billing/orders/fixture/confirm", "purchases_not_in_release"],
        ["/voice-profiles/me/reference-audio", "voice_cloning_not_in_release"]]) {
        const response = await app.inject({ method: "POST", url, payload: {} });
        expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe(code);
      }
    } finally { await app.close(); }
  });
});

async function readiness() {
  const app = await buildApp({ publicEntryRateLimiter: readyRateLimiter() });
  try { return await app.inject({ method: "GET", url: "/health/release-ready" }); }
  finally { await app.close(); }
}
function readyRateLimiter(): PublicEntryRateLimiter {
  return {
    start: async () => true, close: async () => undefined,
    readiness: () => ({ status: "ready", provider: "redis", configured: true, connected: true }),
    consume: async ({ limit }) => ({ status: "allowed", provider: "redis", limit, remaining: limit - 1, retryAfterMs: 60000 }),
  };
}
