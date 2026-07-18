import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runPatroniHaProviderStep } from "./patroni_ha_provider.mjs";

function config() {
  return {
    sourceDatabase: "ai_phone_staging",
    writerPgService: "ai-phone-writer",
    stateDirectory: "outputs/postgres-resilience/patroni-state",
    failoverCandidateId: "db-b",
    nodes: [
      { id: "db-a", pgService: "db-a-direct" },
      { id: "db-b", pgService: "db-b-direct" },
    ],
    pollIntervalMs: 100,
    failoverTimeoutSeconds: 30,
    rebuildTimeoutSeconds: 60,
  };
}

function cluster(primary = "db-a", oldState = "running") {
  return {
    primary: { id: primary, role: "primary", state: "running", timeline: 8 },
    members: [
      { id: "db-a", role: primary === "db-a" ? "primary" : "standby",
        state: oldState, timeline: 8 },
      { id: "db-b", role: primary === "db-b" ? "primary" : "standby",
        state: "running", timeline: 8 },
    ],
  };
}

function runtime() {
  let failedOver = false;
  let recovered = false;
  return {
    verifyDcs: vi.fn(async () => ({ status: "passed", quorumHealthy: true,
      voterCount: 3, failureDomainCount: 3 })),
    cluster: vi.fn(async () => failedOver ?
      cluster("db-b", recovered ? "running" : "stopped") : cluster()),
    writeProbe: vi.fn(async () => ({
      database: "ai_phone_staging",
      inRecovery: false,
      readOnly: "off",
      probeExists: true,
      serverAddress: "10.0.0.2",
    })),
    probeExists: vi.fn(async () => ({ probeExists: true })),
    injectFailure: vi.fn(async () => {
      failedOver = true;
      return { status: "passed", injectionObserved: true,
        automaticRecoveryEnabled: true, operationId: "failure-1" };
    }),
    readOnlyProbe: vi.fn(async () => ({ reachable: false })),
    recoverNode: vi.fn(async () => {
      recovered = true;
      return { status: "passed", recoveryRequested: true };
    }),
    reinitialize: vi.fn(),
  };
}

async function step(input, name) {
  return runPatroniHaProviderStep({ ...input, step: name, delay: async () => {} });
}

describe("runPatroniHaProviderStep", () => {
  it("proves failover, fencing, endpoint switch and old-primary rejoin", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "patroni-provider-"));
    const input = { root, config: config(), runtime: runtime(), runId: "run-12345678" };
    const baseline = await step(input, "baseline");
    const failover = await step(input, "trigger-failover");
    const fencing = await step(input, "verify-fencing");
    const endpoint = await step(input, "verify-endpoint");
    const rebuild = await step(input, "rebuild-old-primary");
    expect(baseline.primaryId).toBe("db-a");
    expect(failover).toMatchObject({ oldPrimaryId: "db-a", newPrimaryId: "db-b" });
    expect(fencing.oldPrimaryWriteRejected).toBe(true);
    expect(endpoint.discoveredPrimaryId).toBe("db-b");
    expect(rebuild).toMatchObject({ oldPrimaryRejoined: true, role: "standby" });
    const state = path.join(root, config().stateDirectory, "run-12345678.json");
    expect((await import("node:fs")).statSync(state).mode & 0o777).toBe(0o600);
  });

  it("fails closed instead of replaying an indeterminate failure injection", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "patroni-provider-"));
    const providerRuntime = runtime();
    providerRuntime.injectFailure.mockRejectedValueOnce(new Error("controller lost"));
    const input = { root, config: config(), runtime: providerRuntime,
      runId: "run-12345678" };
    await step(input, "baseline");
    await expect(step(input, "trigger-failover")).rejects.toThrow("controller lost");
    await expect(step(input, "trigger-failover")).rejects.toThrow("indeterminate");
    expect(providerRuntime.injectFailure).toHaveBeenCalledTimes(1);
    const stateFile = path.join(root, config().stateDirectory, "run-12345678.json");
    expect(JSON.parse(readFileSync(stateFile, "utf8")).failoverIntentAt).toBeTruthy();
  });
});
