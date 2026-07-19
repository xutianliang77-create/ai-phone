import { describe, expect, it, vi } from "vitest";
import { samplePlatformSystemMetrics } from "./platform_system_probe.mjs";

describe("platform Prometheus system probe", () => {
  it("returns the bounded capacity metrics without exposing its token", async () => {
    const values = new Map([
      ["utilization-query", "0.7"],
      ["oom-query", "0"],
      ["queue-query", "1"],
    ]);
    const fetchFn = vi.fn(async (url) => prometheus(values.get(
      new URL(url).searchParams.get("query"),
    )));
    const result = await samplePlatformSystemMetrics({
      prometheusUrl: "https://metrics.staging.example.cn",
      token: "metrics-secret",
      timeoutMs: 1000,
      fetchFn,
      queries: {
        utilization: "utilization-query",
        oom: "oom-query",
        unboundedQueue: "queue-query",
      },
    });

    expect(result).toMatchObject({
      source: "prometheus",
      observedUtilization: 0.7,
      oomCount: 0,
      unboundedQueueObserved: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls[0][1].headers.authorization)
      .toBe("Bearer metrics-secret");
    expect(fetchFn.mock.calls[0][1].redirect).toBe("error");
    expect(JSON.stringify(result)).not.toContain("metrics-secret");
  });

  it("rejects ambiguous vector queries", async () => {
    await expect(samplePlatformSystemMetrics({
      prometheusUrl: "https://metrics.staging.example.cn",
      timeoutMs: 1000,
      fetchFn: async () => new Response(JSON.stringify({
        status: "success",
        data: {
          resultType: "vector",
          result: [
            { value: [100, "0.5"] },
            { value: [100, "0.6"] },
          ],
        },
      })),
      queries: { utilization: "a", oom: "b", unboundedQueue: "c" },
    })).rejects.toThrow("exactly one scalar");
  });
});

function prometheus(value) {
  return new Response(JSON.stringify({
    status: "success",
    data: { resultType: "vector", result: [{ value: [100, value] }] },
  }), { status: 200, headers: { "content-type": "application/json" } });
}
