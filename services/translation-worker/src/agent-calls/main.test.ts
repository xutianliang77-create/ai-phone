import { describe, expect, it } from "vitest";
import { isAgentCallWorkerEntrypoint } from "./main.js";

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
