import { afterEach, describe, expect, it } from "vitest";
import { isEnabledEnvironmentValue, loadEnv } from "./env.js";

describe("API server env", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("configures the server bind address", () => {
    process.env = { API_BIND_HOST: "10.20.30.40" };

    expect(loadEnv().apiHost).toBe("10.20.30.40");
  });

  it("uses the same normalized boolean semantics in config and repositories", () => {
    process.env = {
      VOICE_AGENT_BACKGROUND_WORK_ENABLED: " TRUE ",
      VOICE_AGENT_WORK_RUNNER_ENABLED: "true",
      VOICE_AGENT_DELIVERY_COORDINATOR_ENABLED: "False",
    };

    expect(loadEnv()).toMatchObject({
      voiceAgentBackgroundWorkEnabled: true,
      voiceAgentWorkRunnerEnabled: true,
      voiceAgentDeliveryCoordinatorEnabled: false,
    });
    expect(isEnabledEnvironmentValue(" TRUE ")).toBe(true);
  });
});
