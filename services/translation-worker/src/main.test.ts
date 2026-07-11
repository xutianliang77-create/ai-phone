import { describe, expect, it } from "vitest";
import { isTranslationWorkerEntrypoint } from "./main.js";

describe("isTranslationWorkerEntrypoint", () => {
  it("detects tsx source entrypoint", () => {
    expect(isTranslationWorkerEntrypoint([
      "/usr/local/bin/node",
      "/repo/node_modules/.bin/tsx",
      "src/main.ts",
    ])).toBe(true);
  });

  it("detects compiled JavaScript entrypoint", () => {
    expect(isTranslationWorkerEntrypoint([
      "/usr/local/bin/node",
      "/repo/services/translation-worker/dist/main.js",
    ])).toBe(true);
  });

  it("ignores Vitest imports", () => {
    expect(isTranslationWorkerEntrypoint([
      "/usr/local/bin/node",
      "/repo/node_modules/.bin/vitest",
      "run",
    ])).toBe(false);
  });
});
