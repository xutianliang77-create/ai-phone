import { describe, expect, test } from "vitest";
import { smokeStructuredResultIssues } from "./ios_nemotron_smoke_result_requirements.mjs";

describe("smokeStructuredResultIssues", () => {
  test("reports local MVP route mismatches from structured result", () => {
    const issues = smokeStructuredResultIssues([{
      marker: "COREML_NEMOTRON_LOCAL_MVP_RESULT",
      found: true,
      summary: {
        canStart: true,
        deviceAsrProvider: "coreml_nemotron",
        sourceLanguage: "en",
        targetLanguage: "en",
        modelChunkMs: 2240,
        autoDownloadModel: false,
        useLocalSessions: false,
        useOnDeviceTranslation: false,
        onDeviceTranslationProvider: "mock",
        onDeviceTranslationRequired: false,
        translationFinal: true,
        expectTranslation: true,
        historyDetailLoaded: true,
        localHistorySaved: true,
        localExportReady: true,
        historyStatus: "ended",
      },
    }]);

    expect(issues).toContain("local MVP source language was not auto: en");
    expect(issues).toContain("local MVP target language was not zh: en");
    expect(issues).toContain("local MVP did not use local sessions");
    expect(issues).toContain(
      "local MVP translation provider was not ios_system: mock",
    );
  });

  test("reports device ASR config mismatches from structured result", () => {
    const issues = smokeStructuredResultIssues([{
      marker: "COREML_NEMOTRON_SELF_TEST_RESULT",
      found: true,
      summary: {
        canStart: true,
        deviceAsrProvider: "system",
        modelChunkMs: 1120,
        autoDownloadModel: true,
        segmentCount: 1,
        receivedCharCounts: [4],
        expectSegment: true,
      },
    }]);

    expect(issues).toContain(
      "self-test device ASR provider was not coreml_nemotron: system",
    );
    expect(issues).toContain(
      "self-test Nemotron model chunk was not 2240ms: 1120",
    );
    expect(issues).toContain(
      "self-test did not use staged Nemotron model: autoDownloadModel=true",
    );
  });

  test("reports unavailable local MVP on-device translation", () => {
    const issues = smokeStructuredResultIssues([{
      marker: "COREML_NEMOTRON_LOCAL_MVP_RESULT",
      found: true,
      summary: {
        canStart: true,
        deviceAsrProvider: "coreml_nemotron",
        sourceLanguage: "auto",
        targetLanguage: "zh",
        modelChunkMs: 2240,
        autoDownloadModel: false,
        useLocalSessions: true,
        useOnDeviceTranslation: true,
        onDeviceTranslationProvider: "ios_system",
        onDeviceTranslationRequired: true,
        translationProvider: "ios_system",
        translationAvailable: false,
        translationReason: "language_pair_not_installed",
        translationFinal: false,
        expectTranslation: true,
        historyDetailLoaded: true,
        localHistorySaved: true,
        localExportReady: true,
        historyStatus: "ended",
      },
    }]);

    expect(issues).toContain(
      "local MVP on-device translation was not available: language_pair_not_installed",
    );
  });

  test("reports unknown structured smoke result markers", () => {
    const issues = smokeStructuredResultIssues([
      { marker: "COREML_NEMOTRON_UNKNOWN_RESULT", found: true, summary: {} },
    ]);

    expect(issues).toEqual([
      "unknown structured smoke result marker: COREML_NEMOTRON_UNKNOWN_RESULT",
    ]);
  });

  test("reports ASR processing errors from structured results", () => {
    const issues = smokeStructuredResultIssues([{
      marker: "COREML_NEMOTRON_SELF_TEST_RESULT",
      found: true,
      summary: {
        canStart: true,
        deviceAsrProvider: "coreml_nemotron",
        modelChunkMs: 2240,
        autoDownloadModel: false,
        segmentCount: 1,
        receivedCharCounts: [4],
        expectSegment: true,
        audioProcessingError: "FluidAudio process failed",
      },
    }]);

    expect(issues).toContain(
      "self-test reported audioProcessingError: FluidAudio process failed",
    );
  });

  test("requires Core ML runtime readiness after start", () => {
    const issues = smokeStructuredResultIssues([{
      marker: "COREML_NEMOTRON_SELF_TEST_RESULT",
      found: true,
      summary: {
        canStart: true,
        deviceAsrProvider: "coreml_nemotron",
        modelChunkMs: 2240,
        autoDownloadModel: false,
        segmentCount: 1,
        receivedCharCounts: [4],
        expectSegment: true,
        fluidAudioRuntimeAvailableAfterStart: false,
        decoderReadyAfterStart: false,
        modelScanStatusAfterStart: "model_incomplete",
        modelScanLayoutAfterStart: "missing",
      },
    }]);

    expect(issues).toContain(
      "self-test FluidAudio runtime was not available after start",
    );
    expect(issues).toContain(
      "self-test Core ML decoder was not ready after start",
    );
    expect(issues).toContain(
      "self-test Nemotron model was not prepared after start",
    );
    expect(issues).toContain(
      "self-test staged Nemotron model was not ready after start: model_incomplete",
    );
  });
});
