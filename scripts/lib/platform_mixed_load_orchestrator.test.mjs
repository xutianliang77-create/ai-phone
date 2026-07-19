import { describe, expect, it } from "vitest";
import { runPlatformMixedLoad } from "./platform_mixed_load_orchestrator.mjs";

describe("platform mixed-load orchestrator", () => {
  it("runs bounded mixed stages, failure recovery, soak, and overload rejection", async () => {
    const driver = new FakeDriver();
    const run = await runPlatformMixedLoad({
      config: config("mock"),
      driver,
      runId: "capacity-test-001",
      topologySha256: "a".repeat(64),
      environment: {},
    });

    expect(run.result.status).toBe("mock_passed");
    expect(run.result.stages.map((stage) => stage.concurrentSessions)).toEqual([25, 50, 100]);
    expect(run.result.soak).toMatchObject({
      status: "passed",
      durationMinutes: 120,
      realProviderTraffic: false,
    });
    expect(run.result.soak.trafficKinds).toEqual([
      "agent", "api", "asr", "egress", "livekit", "mt", "sip", "tts",
    ]);
    expect(run.result.admission).toMatchObject({
      status: "passed",
      rejectionObserved: true,
      oomCount: 0,
      unboundedQueueObserved: false,
    });
    expect(run.result.failureInjection.status).toBe("passed");
    expect(run.result.totals).toMatchObject({
      providerSideEffectDuplicates: 0,
      lostFinalEvents: 0,
      duplicateSettlements: 0,
      finalCoverageRatio: 1,
    });
    expect(driver.maximumActive).toBeLessThanOrEqual(100);
    expect(driver.shutdownCalled).toBe(true);
  });

  it("fails closed before a real run without staging and phone acknowledgements", async () => {
    await expect(runPlatformMixedLoad({
      config: config("real"),
      driver: new FakeDriver(),
      runId: "capacity-test-002",
      environment: {},
    })).rejects.toThrow("MIXED_LOAD_STAGING_ACK");
  });

  it("marks a phase failed when provider evidence is incomplete", async () => {
    const driver = new FakeDriver({ omitEvidence: true });
    const run = await runPlatformMixedLoad({
      config: config("real"),
      driver,
      runId: "capacity-test-003",
      topologySha256: "b".repeat(64),
      environment: {
        MIXED_LOAD_STAGING_ACK: "WUJIE_STAGING_LOAD_ONLY",
        MIXED_LOAD_PSTN_ALLOWLIST: "+8613800138000",
      },
    });

    expect(run.result.status).toBe("failed");
    expect(run.phases[0].sessions[0].issues).toContain("missing provider evidence: api");
  });

  it("fails a real run when the failure controller omits recovery evidence", async () => {
    const run = await runPlatformMixedLoad({
      config: config("real"),
      driver: new FakeDriver({ omitFailureEvidence: true }),
      runId: "capacity-test-004",
      topologySha256: "c".repeat(64),
      environment: {
        MIXED_LOAD_STAGING_ACK: "WUJIE_STAGING_LOAD_ONLY",
        MIXED_LOAD_PSTN_ALLOWLIST: "+8613800138000",
      },
    });

    expect(run.result.status).toBe("failed");
    expect(run.result.failureInjection.status).toBe("failed");
  });
});

class FakeDriver {
  active = 0;
  maximumActive = 0;
  shutdownCalled = false;

  constructor(options = {}) {
    this.options = options;
  }

  async runSession(context) {
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    this.active -= 1;
    const index = Number(context.sessionId.split("-").at(-1));
    if (context.phaseType === "admission" && index > 100) {
      return {
        schemaVersion: 1,
        status: "rejected",
        environment: "staging",
        realProviderTraffic: false,
        admissionEvidence: ["worker_capacity_exhausted"],
      };
    }
    const real = context.scenario.realProviderTraffic ?? false;
    return {
      schemaVersion: 1,
      status: "passed",
      environment: "staging",
      realProviderTraffic: real,
      observedDurationMs: context.durationMs,
      trafficKinds: context.scenario.trafficKinds,
      providerEvidence: this.options.omitEvidence
        ? {}
        : Object.fromEntries(context.scenario.trafficKinds.map((kind) => [kind, [`${kind}-1`]])),
      finalEventObserved: true,
      providerSideEffectDuplicates: 0,
      lostFinalEvents: 0,
      duplicateSettlements: 0,
      metrics: { sessionStartMs: 100, finalLatencyMs: 500 },
    };
  }

  async injectFailure(context) {
    return {
      schemaVersion: 1,
      status: "passed",
      environment: "staging",
      realProviderTraffic: context.failure.realProviderTraffic ?? false,
      failureName: context.failure.name,
      target: context.failure.target,
      fault: context.failure.fault,
      injectionObserved: true,
      providerEvidence: this.options.omitFailureEvidence ? [] : ["operation-1"],
      recovered: true,
      recoveryEvidence: this.options.omitFailureEvidence ? [] : ["replacement-1"],
      observedRecoverySeconds: 5,
      providerSideEffectDuplicates: 0,
    };
  }

  async sampleSystem(context) {
    return {
      observedUtilization: context.phase === "admission" ? 0.86 : 0.7,
      oomCount: 0,
      unboundedQueueObserved: false,
    };
  }

  async shutdown() {
    this.shutdownCalled = true;
  }
}

function config(mode) {
  const realProviderTraffic = mode === "real";
  return {
    environment: "staging",
    mode,
    topologyFile: "infra/platform-ha/topology.json",
    safety: {
      apiBaseUrl: mode === "real"
        ? "https://api-staging.qkxy.cn"
        : "http://127.0.0.1:3410",
      acknowledgement: "WUJIE_STAGING_LOAD_ONLY",
      gracefulDrainSeconds: 5,
      maxPendingStarts: 150,
      systemSampleDelaySeconds: 0,
    },
    stages: [
      { concurrentSessions: 25, durationMinutes: 30, rampUpSeconds: 0 },
      { concurrentSessions: 50, durationMinutes: 10, rampUpSeconds: 0 },
      { concurrentSessions: 100, durationMinutes: 30, rampUpSeconds: 0 },
    ],
    soak: { concurrentSessions: 70, durationMinutes: 120, targetUtilization: 0.7 },
    admission: {
      concurrentSessions: 120,
      durationMinutes: 10,
      minimumObservedUtilization: 0.85,
    },
    slo: {
      maxErrorRate: 0.01,
      p95SessionStartMs: 5000,
      p95FinalLatencyMs: 2000,
      minimumFinalCoverageRatio: 0.99,
    },
    scenarios: [
      {
        name: "translation_room",
        weight: 70,
        realProviderTraffic,
        trafficKinds: ["api", "livekit", "asr", "mt", "tts"],
      },
      {
        name: "telephony_agent",
        weight: 30,
        realProviderTraffic,
        trafficKinds: ["api", "livekit", "sip", "agent", "egress"],
      },
    ],
    failureInjections: [{
      name: "translation_worker_sigkill",
      target: "translation-worker",
      fault: "sigkill",
      realProviderTraffic,
      phase: "capacity-100",
      atSeconds: 0,
      recoveryTimeoutSeconds: 30,
    }],
  };
}
