import { describe, expect, it, vi } from "vitest";
import { checkContainerHealth } from "./container-healthcheck.mjs";

const readyHttp = () => Response.json({
  status: "ok",
  dependencyReadiness: { sessionReady: true, releaseReady: true },
});

describe("single-container healthcheck", () => {
  const readyFile = vi.fn(async (path) => path.includes("supervisor")
    ? JSON.stringify({
        version: 1,
        components: {
          api: "running",
          realtime: "running",
          "translation-agent": "running",
          "agent-call-worker": "running",
          "voice-agent": "running",
          "air-device-gateway": "running",
          "srt-ingress": "running",
        },
      })
    : "ready\n");

  it("requires core services when optional runtimes are disabled", async () => {
    const fetchFn = vi.fn(async () => readyHttp());

    await checkContainerHealth({
      env: { WUJIE_AI_AIR_DEVICE_GATEWAY_ENABLED: "false" },
      fetchFn,
      readFileFn: readyFile,
    });

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:3110/health",
      "http://127.0.0.1:3111/health",
      "http://127.0.0.1:8081/worker",
    ]);
    expect(readyFile).toHaveBeenCalledWith(
      "/tmp/wujie-ai/supervisor-state.json",
      "utf8",
    );
    expect(readyFile).toHaveBeenCalledWith(
      "/tmp/wujie-ai/translation-agent-ready",
      "utf8",
    );
  });

  it("requires a healthy Air780 Gateway process when that runtime is enabled", async () => {
    const fetchFn = vi.fn(async () => readyHttp());

    await checkContainerHealth({
      env: {
        WUJIE_AI_AIR_DEVICE_GATEWAY_ENABLED: "true",
        API_HEALTH_URL: "http://127.0.0.1:3110/health",
        AIR_GATEWAY_HEALTH_URL: "http://127.0.0.1:8780/healthz",
      },
      fetchFn,
      readFileFn: readyFile,
    });

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:3110/health",
      "http://127.0.0.1:3111/health",
      "http://127.0.0.1:8081/worker",
      "http://127.0.0.1:8780/healthz",
    ]);
  });

  it("fails when an enabled Gateway process or persistence is unhealthy", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(readyHttp())
      .mockResolvedValueOnce(readyHttp())
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(checkContainerHealth({
      env: {
        WUJIE_AI_AIR_DEVICE_GATEWAY_ENABLED: "true",
        WUJIE_AI_TRANSLATION_AGENT_ENABLED: "false",
      },
      fetchFn,
    })).rejects.toThrow("air-device-gateway health returned HTTP 503");
  });

  it("does not include an endpoint response body in health errors", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("transport detail must not be surfaced");
    });

    await expect(checkContainerHealth({
      env: { WUJIE_AI_TRANSLATION_AGENT_ENABLED: "false" },
      fetchFn,
    })).rejects
      .toThrow("api health request failed");
  });

  it("requires enabled Voice, SRT, and Translation dependency readiness", async () => {
    const fetchFn = vi.fn(async () => readyHttp());
    const readFileFn = vi.fn(async (path) => path.includes("supervisor")
      ? await readyFile(path)
      : "not_ready\n");

    await expect(checkContainerHealth({
      env: {
        WUJIE_AI_VOICE_AGENT_ENABLED: "true",
        WUJIE_AI_SRT_INGRESS_ENABLED: "true",
      },
      fetchFn,
      readFileFn,
    })).rejects.toThrow("translation-agent dependencies are not ready");

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:3110/health",
      "http://127.0.0.1:3111/health",
      "http://127.0.0.1:8081/worker",
      "http://127.0.0.1:8082/",
      "http://127.0.0.1:3310/health",
    ]);
  });

  it("fails while an enabled in-container worker is restarting", async () => {
    const fetchFn = vi.fn(async () => readyHttp());
    const readFileFn = vi.fn(async (path) => path.includes("supervisor")
      ? JSON.stringify({
          version: 1,
          components: {
            api: "running",
            realtime: "running",
            "translation-agent": "running",
            "agent-call-worker": "restarting",
          },
        })
      : "ready\n");

    await expect(checkContainerHealth({
      env: { WUJIE_AI_AGENT_CALL_WORKER_ENABLED: "true" },
      fetchFn,
      readFileFn,
    })).rejects.toThrow("component agent-call-worker is not running");
  });

  it("rejects HTTP 200 when realtime model dependencies are unavailable", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(readyHttp())
      .mockResolvedValueOnce(Response.json({
        status: "unavailable",
        dependencyReadiness: { sessionReady: false, releaseReady: false },
      }));
    await expect(checkContainerHealth({ fetchFn, readFileFn: readyFile }))
      .rejects.toThrow("realtime core dependencies are not ready");
  });
});
