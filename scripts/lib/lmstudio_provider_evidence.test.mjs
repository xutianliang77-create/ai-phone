import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadLmStudioProviderEvidence } from "./lmstudio_provider_evidence.mjs";

describe("loadLmStudioProviderEvidence", () => {
  test("reports missing evidence with a runnable action", () => {
    const evidence = loadLmStudioProviderEvidence("/tmp/missing-lmstudio.json", 2);

    expect(evidence).toMatchObject({
      exists: false,
      pass: false,
      status: "missing",
    });
    expect(evidence.actions.join(" ")).toContain("check-lmstudio");
  });

  test("passes fresh ready evidence with a non-empty translation", () => {
    const file = writeEvidence({
      status: "ready",
      model: "qwen/qwen3.5-9b",
      translation: "你好",
      reasoningTokens: 0,
      issues: [],
      actions: [],
    });

    const evidence = loadLmStudioProviderEvidence(file, 2, Date.now() + 1000);

    expect(evidence).toMatchObject({
      exists: true,
      pass: true,
      status: "ready",
      model: "qwen/qwen3.5-9b",
      reasoningTokens: 0,
    });
  });

  test("fails stale ready evidence", () => {
    const file = writeEvidence({
      status: "ready",
      translation: "你好",
      issues: [],
      actions: [],
    });

    const evidence = loadLmStudioProviderEvidence(
      file,
      0,
      Date.now() + 60_000,
    );

    expect(evidence.pass).toBe(false);
    expect(evidence.freshness).toBe("stale");
  });
});

function writeEvidence(payload) {
  const dir = mkdtempSync(path.join(tmpdir(), "lmstudio-provider-"));
  const file = path.join(dir, "lmstudio-provider.json");
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}
