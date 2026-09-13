import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectPublicRuntimeLiveQualification, signPublicRuntimeLiveQualification,
  type PublicRuntimeLiveQualification } from "./public-runtime-live-qualification.js";

let directory = "";
const signingKey = "a".repeat(64), now = new Date("2026-09-13T15:15:00.000Z");
const expectation = { deploymentId: "public-test", configurationHash: "b".repeat(64),
  modelPolicyRevision: "models-v1:test", components: ["asr", "translation"] as const };
function evidence(patch: Partial<PublicRuntimeLiveQualification> = {}) {
  const value: Omit<PublicRuntimeLiveQualification, "signature"> = {
    schemaVersion: 1, evidenceId: "live-test", deploymentId: expectation.deploymentId,
    configurationHash: expectation.configurationHash, modelPolicyRevision: expectation.modelPolicyRevision,
    components: [...expectation.components], providers: [
      { component: "asr", providerId: "tencent", modelId: "16k_en" },
      { component: "translation", providerId: "tencent", modelId: "service:tencent_tmt" },
    ], qualifiedLanguagePairs: [{ source: "en", target: "zh" }],
    observedAt: new Date(now.getTime() - 1_000).toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    sessionHash: "c".repeat(64), attemptHash: "d".repeat(64), finalizationHash: "e".repeat(64), ...patch,
  };
  return { ...value, signature: signPublicRuntimeLiveQualification(value, signingKey) };
}
function inspect(value: unknown) {
  directory = mkdtempSync(join(tmpdir(), "wujie-live-qualification-"));
  const file = join(directory, "evidence.json"); writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  return inspectPublicRuntimeLiveQualification({ file, signingKey, expectation, now });
}
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = ""; });
describe("signed public runtime live qualification", () => {
  it("accepts an exact, fresh provider observation", () => {
    expect(inspect(evidence())).toMatchObject({ status: "ready", evidence: { evidenceId: "live-test" } });
  });
  it("fails closed for mismatched, expired, revoked, or incomplete evidence", () => {
    const invalid: Array<Partial<PublicRuntimeLiveQualification>> = [
      { configurationHash: "f".repeat(64) },
      { expiresAt: new Date(now.getTime() - 1).toISOString() },
      { revokedAt: now.toISOString() },
      { providers: [{ component: "asr", providerId: "tencent", modelId: "16k_en" }] },
    ];
    for (const patch of invalid) {
      expect(inspect(evidence(patch))).toMatchObject({ status: "not_ready" });
    }
  });
  it("rejects a tampered signed document", () => {
    const value = evidence(); value.providers[0].modelId = "other";
    expect(inspect(value)).toMatchObject({ status: "not_ready", issue: "public_runtime_live_qualification_signature_invalid" });
  });
});
