import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { checkModelSelectionReadiness } from "./model_selection_readiness.mjs";

describe("checkModelSelectionReadiness", () => {
  test("blocks release when the model selection report is missing", () => {
    const result = checkModelSelectionReadiness("/tmp/missing-model-selection-report.json");

    expect(result.status).toBe("not_ready");
    expect(result.checks).toContainEqual(expect.objectContaining({
      name: "model_selection_report_exists",
      status: "fail",
    }));
    expect(result.issues).toContain("Model selection report is required before domestic release.");
  });

  test("passes a complete model selection report", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "model-selection-ready-"));
    try {
      const filePath = path.join(dir, "report.json");
      writeFileSync(filePath, `${JSON.stringify(readyReport(), null, 2)}\n`);

      const result = checkModelSelectionReadiness(filePath);

      expect(result.status).toBe("ready");
      expect(result.issues).toEqual([]);
      expect(result.checks.map((check) => [check.name, check.status])).toEqual([
        ["model_selection_report_exists", "pass"],
        ["model_selection_status", "pass"],
        ["model_selection_asr_choices", "pass"],
        ["model_selection_translation_choices", "pass"],
        ["model_selection_tts_choices", "pass"],
        ["model_selection_model_eval_evidence", "pass"],
        ["model_selection_risk_reviews", "pass"],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails incomplete choices and missing reviews", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "model-selection-bad-"));
    try {
      const filePath = path.join(dir, "report.json");
      writeFileSync(filePath, JSON.stringify({
        status: "selected",
        decidedAt: "2026-07-03T00:00:00.000Z",
        asr: { default: { provider: "ios_coreml", model: "nemotron" } },
        modelEval: { status: "ready", fixture: "model-eval/fixtures/cn-en-smoke.json" },
        risks: { licensingReviewed: true },
      }));

      const result = checkModelSelectionReadiness(filePath);

      expect(result.status).toBe("not_ready");
      expect(result.issues.join("\n")).toContain("translation default, gray, and fallback");
      expect(result.issues.join("\n")).toContain("all required groups");
      expect(result.issues.join("\n")).toContain("licensing, cost, and deployment reviews");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function readyReport() {
  const modelEval = {
    status: "ready",
    fixture: "model-eval/fixtures/cn-en-smoke.json",
    requiredGroups: ["zh_meeting", "en_short", "code_switch", "terms_numbers", "tts_phone"],
  };
  const risks = {
    licensingReviewed: true,
    costReviewed: true,
    deploymentReviewed: true,
  };
  return {
    schemaVersion: 1,
    status: "selected",
    decidedAt: "2026-07-03T00:00:00.000Z",
    asr: domain("ios_coreml", "nemotron-3.5-asr-streaming-0.6b"),
    translation: domain("hymt2_self_hosted", "tencent/Hy-MT2-1.8B"),
    tts: domain("system_tts", "ios-system-tts"),
    modelEval,
    risks,
  };
}

function domain(provider, model) {
  return {
    default: { provider, model },
    gray: { provider, model },
    fallback: { provider: "fallback", model: "fallback-model" },
  };
}
