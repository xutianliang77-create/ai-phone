import { afterEach, describe, expect, it } from "vitest";
import {
  buildDefaultAgentCallDispatcher,
  isAgentCallWorkerEntrypoint,
} from "./main.js";

describe("isAgentCallWorkerEntrypoint", () => {
  it("detects tsx source entrypoint", () => {
    expect(isAgentCallWorkerEntrypoint([
      "/usr/local/bin/node",
      "/repo/node_modules/.bin/tsx",
      "src/agent-calls/main.ts",
    ])).toBe(true);
  });

  it("detects compiled JavaScript entrypoint", () => {
    expect(isAgentCallWorkerEntrypoint([
      "/usr/local/bin/node",
      "/repo/services/translation-worker/dist/agent-calls/main.js",
    ])).toBe(true);
  });

  it("ignores Vitest imports", () => {
    expect(isAgentCallWorkerEntrypoint([
      "/usr/local/bin/node",
      "/repo/node_modules/.bin/vitest",
      "run",
    ])).toBe(false);
  });
});

describe("buildDefaultAgentCallDispatcher", () => {
  const original = {
    AGENT_CALL_WORKER_ID: process.env.AGENT_CALL_WORKER_ID,
    AGENT_CALL_PROVIDER_ADAPTER: process.env.AGENT_CALL_PROVIDER_ADAPTER,
    INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
    PSTN_BRIDGE_BASE_URL: process.env.PSTN_BRIDGE_BASE_URL,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses the API Voice Agent runtime entrypoint for Air780", () => {
    process.env.AGENT_CALL_WORKER_ID = "air-worker-1";
    process.env.AGENT_CALL_PROVIDER_ADAPTER = "air780_volte";
    process.env.INTERNAL_API_SECRET = "internal-secret-for-agent";
    delete process.env.PSTN_BRIDGE_BASE_URL;

    expect(buildDefaultAgentCallDispatcher()).not.toBeNull();
  });
});
