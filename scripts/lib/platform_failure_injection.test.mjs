import { describe, expect, it } from "vitest";
import { runPlatformFailureInjection } from "./platform_failure_injection.mjs";

describe("platform failure injection", () => {
  it("proves replay fencing and requires observed automatic recovery", async () => {
    const clock = new FakeClock();
    const requests = [];
    const result = await runPlatformFailureInjection({
      ...baseOptions(clock),
      fetchFn: successfulController(requests),
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      status: "passed",
      environment: "staging",
      realProviderTraffic: true,
      failureName: "translation_worker_sigkill",
      target: "translation-worker",
      fault: "sigkill",
      operationId: "fault-operation-1",
      injectionObserved: true,
      recovered: true,
      observedRecoverySeconds: 2,
      providerSideEffectDuplicates: 0,
    });
    expect(result.providerEvidence).toEqual([
      "operation:fault-operation-1",
      "terminated:translation-worker-pod-1:[REDACTED_PHONE]",
    ]);
    expect(result.recoveryEvidence).toEqual([
      "replacement:translation-worker-pod-2",
      "generation:8",
    ]);
    const posts = requests.filter((item) => item.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[0].body).toEqual(posts[1].body);
    expect(posts[1].headers["idempotency-key"])
      .toBe(posts[0].body.idempotencyKey);
    expect(JSON.stringify(result)).not.toContain("13800138000");
  });

  it("fails before polling when replay changes the provider operation", async () => {
    const clock = new FakeClock();
    let postCount = 0;
    await expect(runPlatformFailureInjection({
      ...baseOptions(clock),
      fetchFn: async (_url, init) => {
        postCount += 1;
        const request = JSON.parse(init.body);
        return json(operation(request, {
          operationId: `fault-operation-${postCount}`,
          replayed: postCount > 1,
        }));
      },
    })).rejects.toThrow("idempotency replay gate failed");
  });

  it("rejects recovered operations without fault evidence", async () => {
    const clock = new FakeClock();
    await expect(runPlatformFailureInjection({
      ...baseOptions(clock),
      fetchFn: successfulController([], { omitEvidence: true }),
    })).rejects.toThrow("recovery evidence is incomplete");
  });

  it("accepts an already recovered replay after a client restart", async () => {
    const clock = new FakeClock();
    clock.now = 180_000;
    let posts = 0;
    const result = await runPlatformFailureInjection({
      ...baseOptions(clock),
      fetchFn: async (_url, init) => {
        posts += 1;
        const request = JSON.parse(init.body);
        return json(operation(request, {
          status: "recovered",
          replayed: true,
          injectionObservedAt: "1970-01-01T00:00:00.000Z",
          recoveredAt: "1970-01-01T00:00:02.000Z",
          injectionEvidence: ["terminated:worker-1"],
          recoveryEvidence: ["replacement:worker-2"],
        }));
      },
    });

    expect(posts).toBe(2);
    expect(result).toMatchObject({ status: "passed", observedRecoverySeconds: 2 });
  });
});

class FakeClock {
  now = 0;
  async sleep(ms) { this.now += ms; }
}

function baseOptions(clock) {
  return {
    controllerUrl: "https://chaos.example.cn/control/",
    token: "private-controller-token",
    runId: "capacity-test-001",
    phase: "capacity-100",
    failureName: "translation_worker_sigkill",
    target: "translation-worker",
    fault: "sigkill",
    targetConcurrency: 100,
    recoveryTimeoutSeconds: 120,
    requestTimeoutMs: 1000,
    statusPollMs: 1000,
    nowMs: () => clock.now,
    sleep: (ms) => clock.sleep(ms),
  };
}

function successfulController(requests, options = {}) {
  let posts = 0;
  let polls = 0;
  return async (url, init) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({
      url: String(url),
      method,
      body,
      headers: init.headers,
    });
    if (method === "POST") {
      posts += 1;
      return json(operation(body, { replayed: posts > 1 }));
    }
    polls += 1;
    return json(operation(requests[0].body, polls === 1
      ? { status: "injecting" }
      : {
          status: "recovered",
          injectionObservedAt: "1970-01-01T00:00:00.000Z",
          recoveredAt: "1970-01-01T00:00:02.000Z",
          injectionEvidence: options.omitEvidence ? [] : [
            "terminated:translation-worker-pod-1:13800138000",
          ],
          recoveryEvidence: options.omitEvidence ? [] : [
            "replacement:translation-worker-pod-2",
            "generation:8",
          ],
        }));
  };
}

function operation(request, overrides = {}) {
  return {
    schemaVersion: 1,
    operationId: "fault-operation-1",
    idempotencyKey: request.idempotencyKey,
    runId: request.runId,
    phase: request.phase,
    failureName: request.failureName,
    target: request.target,
    fault: request.fault,
    targetConcurrency: request.targetConcurrency,
    scope: request.scope,
    maxAffectedResources: request.maxAffectedResources,
    recoveryTimeoutSeconds: request.recoveryTimeoutSeconds,
    recoveryPolicy: "automatic",
    recoveryDeadlineAt: "1970-01-01T00:02:00.000Z",
    status: "accepted",
    replayed: false,
    ...overrides,
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
