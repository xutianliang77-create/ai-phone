import { describe, expect, it } from "vitest";
import type { ApiEnv } from "../../config/env.js";
import { startAgentWorkRunner } from "./agent-work-runner.js";

describe("Agent Work runner", () => {
  it("rejects a claim lease that can expire before the tool timeout", () => {
    const env = {
      voiceAgentWorkRunnerEnabled: true,
      voiceAgentBackgroundWorkEnabled: true,
      agentWorkToolGatewayUrl: "https://tool-gateway.example",
      agentWorkToolGatewaySecret: "0123456789abcdef",
      agentWorkToolGatewayTimeoutMs: 20_000,
      agentWorkRunnerLeaseSeconds: 20,
    } as ApiEnv;

    expect(() => startAgentWorkRunner({ env, onError: () => {} }))
      .toThrow("claim lease must exceed the tool timeout");
  });
});
