import { afterEach, describe, expect, it } from "vitest";
import { buildDefaultWorker, isTranslationWorkerEntrypoint } from "./main.js";

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

describe("public Call Link TTS provider selection", () => {
  const previous = process.env.CALL_LINK_PUBLIC_TTS_ENABLED;

  afterEach(() => {
    if (previous === undefined) delete process.env.CALL_LINK_PUBLIC_TTS_ENABLED;
    else process.env.CALL_LINK_PUBLIC_TTS_ENABLED = previous;
  });

  it("fails closed rather than falling back to a global private TTS provider", () => {
    process.env.CALL_LINK_PUBLIC_TTS_ENABLED = "true";
    expect(() => buildDefaultWorker()).toThrow(
      "requires session-bound Worker material",
    );
  });
});
