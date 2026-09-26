import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@livekit/agents", () => ({
  defineAgent: (definition: unknown) => definition,
  AutoSubscribe: { SUBSCRIBE_NONE: 0 },
}));
vi.mock("@livekit/rtc-node", () => ({ RoomEvent: { DataReceived: "data" } }));
vi.mock("../main.js", () => ({ buildDefaultSpeechPipeline: vi.fn() }));

import agent from "./translation-agent-definition.js";

const keys = ["API_RESULT_SYNC_DEPLOYMENT_ID", "PUBLIC_RUNTIME_ENABLED",
  "CALL_LINK_PUBLIC_TTS_ENABLED", "CALL_LINK_DEPLOYMENT_TEST_MODE",
  "CALL_LINK_1_0_COMPATIBILITY_ENABLED", "CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID",
  "CALL_LINK_1_0_COMPATIBILITY_PROFILE", "CALL_PROVIDER_POLICY"];
const compatibility = {
  API_RESULT_SYNC_DEPLOYMENT_ID: "isolated-11",
  CALL_LINK_1_0_COMPATIBILITY_ENABLED: "true",
  CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID: "isolated-11",
  CALL_LINK_1_0_COMPATIBILITY_PROFILE: "call_link_only",
  CALL_PROVIDER_POLICY: "call_link_only",
};
const permittedDeployments: Array<Record<string, string>> = [{}, compatibility];

describe("translation Agent deployment preflight", () => {
  beforeEach(() => { for (const key of keys) vi.stubEnv(key, undefined); });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { API_RESULT_SYNC_DEPLOYMENT_ID: "ordinary-public" },
    { CALL_LINK_1_0_COMPATIBILITY_ENABLED: "true" },
    { CALL_LINK_PUBLIC_TTS_ENABLED: "true" },
    { CALL_LINK_DEPLOYMENT_TEST_MODE: "true" },
    { ...compatibility, CALL_LINK_DEPLOYMENT_TEST_MODE: "true" },
  ])("rejects deployment before RTC connection: %j", async (env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const ctx = context();
    await expect(invoke(ctx)).rejects.toThrow("call_link_public_model_runtime_unavailable");
    expect(ctx.connect).not.toHaveBeenCalled();
  });

  it.each(permittedDeployments)("preserves the permitted private or isolated connection path: %j", async (env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const ctx = context();
    await expect(invoke(ctx)).rejects.toThrow("synthetic_connection_boundary");
    expect(ctx.connect).toHaveBeenCalledTimes(1);
  });
});

function context() {
  const ticket = { v: 1, callId: "call-1", sessionId: "call-1", roomName: "call_call-1",
    agentName: "translation-runtime", generation: 1, nonce: "nonce-1", iat: 1, exp: 2 };
  return {
    job: { metadata: Buffer.from(JSON.stringify(ticket)).toString("base64url") + ".synthetic",
      agentName: ticket.agentName, room: { name: ticket.roomName } },
    proc: { userData: { env: { apiBaseUrl: "https://api.synthetic.invalid", apiTimeoutMs: 1000 } } },
    // No network: permitted paths stop at this synthetic boundary.
    connect: vi.fn(async () => { throw new Error("synthetic_connection_boundary"); }),
  };
}

function invoke(ctx: ReturnType<typeof context>) {
  return (agent as unknown as { entry(context: unknown): Promise<void> }).entry(ctx);
}
