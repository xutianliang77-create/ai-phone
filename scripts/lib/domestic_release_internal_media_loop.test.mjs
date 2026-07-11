import { describe, expect, test } from "vitest";
import { appendPstnInternalMediaLoopReadiness } from "./domestic_release_pstn_checks.mjs";

describe("appendPstnInternalMediaLoopReadiness", () => {
  test("records ready PSTN internal media loop smoke", async () => {
    const context = baseContext({ checkFn: async () => readyResult() });

    await appendPstnInternalMediaLoopReadiness(context);

    expect(context.checks).toEqual([{
      name: "pstn_internal_media_loop_readiness",
      status: "pass",
      details: {
        status: "ready",
        asrFrameCount: 1,
        eventBatchCount: 2,
        upstreamAudioCount: 1,
        mediaWriteCount: 1,
        checks: [{ name: "loop_tts_written_to_media", status: "pass" }],
      },
    }]);
    expect(context.issues).toEqual([]);
  });

  test("aggregates failed internal media loop blockers", async () => {
    const context = baseContext({
      checkFn: async () => ({
        ...readyResult(),
        status: "not_ready",
        issues: ["PSTN internal media loop smoke failed."],
        actions: ["Check PSTN Bridge -> Translation Worker wiring."],
      }),
    });

    await appendPstnInternalMediaLoopReadiness(context);

    expect(context.checks[0]).toMatchObject({
      name: "pstn_internal_media_loop_readiness",
      status: "fail",
      details: { status: "not_ready" },
    });
    expect(context.issues).toContain("pstn_internal_media_loop_readiness is not ready.");
    expect(context.issues).toContain("PSTN internal media loop smoke failed.");
    expect(context.actions).toContain("Check PSTN Bridge -> Translation Worker wiring.");
  });

  test("records explicit skip", async () => {
    const context = baseContext({ enabled: false });

    await appendPstnInternalMediaLoopReadiness(context);

    expect(context.checks).toEqual([{
      name: "pstn_internal_media_loop_readiness",
      status: "pass",
      details: { skipped: true },
    }]);
  });
});

function readyResult() {
  return {
    status: "ready",
    asrFrameCount: 1,
    eventBatchCount: 2,
    upstreamAudioCount: 1,
    mediaWriteCount: 1,
    checks: [{ name: "loop_tts_written_to_media", status: "pass" }],
    issues: [],
    actions: [],
  };
}

function baseContext(overrides = {}) {
  return {
    enabled: true,
    root: "/repo",
    timeoutMs: 1000,
    checks: [],
    issues: [],
    actions: [],
    record: (checks, name, ok, details = {}) => {
      checks.push({ name, status: ok ? "pass" : "fail", details });
    },
    normalizeIssues: (issues) => issues ?? [],
    ...overrides,
  };
}
