import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  loadGatewayEvidence,
  loadSmokeEvidence,
} from "./ios_nemotron_report_evidence.mjs";

const readyAfterStart = '"availabilityAfterStart":{"decoderReady":true,"localModelReady":true,"preparedModelReady":true,"fluidAudio":{"runtimeAvailable":true,"prepared":true},"modelScan":{"selectedStatus":"ready","selectedLayout":"fluid_split_fused"}}';

describe("iOS Nemotron report evidence", () => {
  test("reports missing required final smoke markers as issues", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-smoke-evidence-"));
    try {
      const smokeLog = path.join(dir, "mvp-smoke.log");
      writeFileSync(smokeLog, "COREML_NEMOTRON_PREPARE_OK\n");

      const evidence = loadSmokeEvidence(smokeLog, 2);

      expect(evidence.issues).toContain(
        "required smoke marker is missing: COREML_NEMOTRON_SELF_TEST_SEGMENT",
      );
      expect(evidence.issues).toContain(
        "required smoke marker is missing: COREML_NEMOTRON_LOCAL_MVP_RESULT",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("reports missing Gateway text marker as an issue", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-gateway-evidence-"));
    try {
      const gatewayLog = path.join(dir, "realtime-gateway.log");
      writeFileSync(gatewayLog, '{"level":30,"msg":"health ok"}\n');

      const evidence = loadGatewayEvidence(gatewayLog, 2);

      expect(evidence.textSegmentLogFound).toBe(false);
      expect(evidence.issues).toContain(
        "Gateway text segment log marker is missing.",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("reports missing structured smoke results as issues", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-smoke-structured-"));
    try {
      const smokeLog = path.join(dir, "mvp-smoke.log");
      writeFileSync(smokeLog, [
        "COREML_NEMOTRON_PREPARE_OK",
        "COREML_NEMOTRON_SELF_TEST_SEGMENT",
        "COREML_NEMOTRON_LOCAL_MVP_HISTORY",
      ].join("\n"));

      const evidence = loadSmokeEvidence(smokeLog, 2);

      expect(evidence.issues).toContain(
        "structured smoke result is missing: COREML_NEMOTRON_SELF_TEST_RESULT",
      );
      expect(evidence.issues).toContain(
        "structured smoke result is missing: COREML_NEMOTRON_LOCAL_MVP_RESULT",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("reports final smoke error markers as issues", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-smoke-errors-"));
    try {
      const smokeLog = path.join(dir, "mvp-smoke.log");
      writeFileSync(smokeLog, [
        "COREML_NEMOTRON_SELF_TEST_STOP_ERROR {\"message\":\"stop failed\"}",
        "COREML_NEMOTRON_LOCAL_MVP_STOP_ERROR {\"message\":\"stop failed\"}",
        "COREML_NEMOTRON_LOCAL_MVP_HISTORY_ERROR {\"message\":\"history failed\"}",
      ].join("\n"));

      const evidence = loadSmokeEvidence(smokeLog, 2);

      expect(evidence.issues.join("\n")).toContain(
        "COREML_NEMOTRON_SELF_TEST_STOP_ERROR",
      );
      expect(evidence.issues.join("\n")).toContain(
        "COREML_NEMOTRON_LOCAL_MVP_STOP_ERROR",
      );
      expect(evidence.issues.join("\n")).toContain(
        "COREML_NEMOTRON_LOCAL_MVP_HISTORY_ERROR",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("reports failed local MVP structured result fields", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-smoke-e2e-"));
    try {
      const smokeLog = path.join(dir, "mvp-smoke.log");
      writeFileSync(smokeLog, [
        "COREML_NEMOTRON_PREPARE_OK",
        "COREML_NEMOTRON_SELF_TEST_SEGMENT",
        "COREML_NEMOTRON_LOCAL_MVP_HISTORY",
        'COREML_NEMOTRON_SELF_TEST_RESULT {"deviceAsrProvider":"coreml_nemotron","modelChunkMs":2240,"autoDownloadModel":false,"availability":{"canStart":true},"segmentCount":1,"receivedCharCounts":[4],"expectSegment":true}',
        'COREML_NEMOTRON_LOCAL_MVP_RESULT {"deviceAsrProvider":"coreml_nemotron","sourceLanguage":"auto","targetLanguage":"zh","modelChunkMs":2240,"autoDownloadModel":false,"useLocalSessions":true,"useOnDeviceTranslation":true,"onDeviceTranslationProvider":"ios_system","onDeviceTranslationRequired":true,"translationAvailability":{"available":true,"provider":"ios_system","status":"installed","reason":"ready","sourceLanguage":"en","targetLanguage":"zh"},"availability":{"canStart":true},"translationFinal":false,"expectTranslation":true,"historyDetailLoaded":true,"localHistorySaved":false,"localExportReady":false,"historyStatus":"created"}',
      ].join("\n"));

      const evidence = loadSmokeEvidence(smokeLog, 2);

      expect(evidence.issues).toContain(
        "local MVP on-device translation was not produced",
      );
      expect(evidence.issues).toContain("local MVP history was not saved");
      expect(evidence.issues).toContain("local MVP local history did not end");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("accepts complete structured smoke results and private Gateway log", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-smoke-clean-"));
    try {
      const smokeLog = path.join(dir, "mvp-smoke.log");
      const gatewayLog = path.join(dir, "realtime-gateway.log");
      writeFileSync(smokeLog, [
        "COREML_NEMOTRON_PREPARE_OK",
        "COREML_NEMOTRON_SELF_TEST_SEGMENT",
        "COREML_NEMOTRON_LOCAL_MVP_HISTORY",
        `COREML_NEMOTRON_SELF_TEST_RESULT {"deviceAsrProvider":"coreml_nemotron","modelChunkMs":2240,"autoDownloadModel":false,"availability":{"canStart":true},${readyAfterStart},"segmentCount":1,"receivedCharCounts":[4],"expectSegment":true}`,
        `COREML_NEMOTRON_LOCAL_MVP_RESULT {"deviceAsrProvider":"coreml_nemotron","sourceLanguage":"auto","targetLanguage":"zh","modelChunkMs":2240,"autoDownloadModel":false,"useLocalSessions":true,"useOnDeviceTranslation":true,"onDeviceTranslationProvider":"ios_system","onDeviceTranslationRequired":true,"translationAvailability":{"available":true,"provider":"ios_system","status":"installed","reason":"ready","sourceLanguage":"en","targetLanguage":"zh"},"availability":{"canStart":true},${readyAfterStart},"segmentCount":1,"sourceCharCounts":[4],"translatedCharCounts":[2],"translationFinal":true,"expectTranslation":true,"historyDetailLoaded":true,"localHistorySaved":true,"localExportReady":true,"historyStatus":"ended"}`,
      ].join("\n"));
      writeFileSync(
        gatewayLog,
        '{"msg":"Client text segment received","sessionId":"sess_1","charCount":4}\n',
      );

      const smokeEvidence = loadSmokeEvidence(smokeLog, 2);
      const gatewayEvidence = loadGatewayEvidence(gatewayLog, 2);

      expect(smokeEvidence.issues).toEqual([]);
      expect(smokeEvidence.privacyOk).toBe(true);
      expect(gatewayEvidence.issues).toEqual([]);
      expect(gatewayEvidence.privacyOk).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("summarizes audio session state from structured smoke results", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-smoke-audio-session-"));
    try {
      const smokeLog = path.join(dir, "mvp-smoke.log");
      writeFileSync(smokeLog, [
        "COREML_NEMOTRON_PREPARE_OK",
        "COREML_NEMOTRON_SELF_TEST_SEGMENT",
        "COREML_NEMOTRON_LOCAL_MVP_HISTORY",
        'COREML_NEMOTRON_SELF_TEST_RESULT {"availability":{"canStart":true},"availabilityAfterStop":{"fluidAudio":{"processingError":"FluidAudio process failed","audio":{"sessionActive":false,"sessionError":"AVAudioSession activation failed","inputBuffers":0}}},"segmentCount":0,"receivedCharCounts":[],"expectSegment":false}',
        'COREML_NEMOTRON_LOCAL_MVP_RESULT {"availability":{"canStart":true},"availabilityAfterStop":{"audio":{"sessionActive":false,"sessionError":"AVAudioSession activation failed","emittedChunks":0}},"translationFinal":false,"expectTranslation":false}',
      ].join("\n"));

      const evidence = loadSmokeEvidence(smokeLog, 2);
      const summaries = evidence.results.map((result) => result.summary);

      expect(summaries[0].audioSessionActive).toBe(false);
      expect(summaries[0].audioSessionError).toBe(
        "AVAudioSession activation failed",
      );
      expect(summaries[0].audioProcessingError).toBe(
        "FluidAudio process failed",
      );
      expect(summaries[1].audioSessionError).toBe(
        "AVAudioSession activation failed",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("summarizes local MVP provider and history result", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-smoke-provider-"));
    try {
      const smokeLog = path.join(dir, "mvp-smoke.log");
      writeFileSync(smokeLog, [
        "COREML_NEMOTRON_PREPARE_OK",
        "COREML_NEMOTRON_SELF_TEST_SEGMENT",
        "COREML_NEMOTRON_LOCAL_MVP_HISTORY",
        `COREML_NEMOTRON_SELF_TEST_RESULT {"deviceAsrProvider":"coreml_nemotron","modelChunkMs":2240,"autoDownloadModel":false,"availability":{"canStart":true},${readyAfterStart},"segmentCount":1,"receivedCharCounts":[4],"expectSegment":true}`,
        `COREML_NEMOTRON_LOCAL_MVP_RESULT {"deviceAsrProvider":"coreml_nemotron","sourceLanguage":"auto","targetLanguage":"zh","modelChunkMs":2240,"autoDownloadModel":false,"useLocalSessions":true,"useOnDeviceTranslation":true,"onDeviceTranslationProvider":"ios_system","onDeviceTranslationRequired":true,"translationAvailability":{"available":true,"provider":"ios_system","status":"installed","reason":"ready","sourceLanguage":"en","targetLanguage":"zh"},"availability":{"canStart":true},${readyAfterStart},"segmentCount":1,"sourceCharCounts":[4],"translatedCharCounts":[2],"translationFinal":true,"expectTranslation":true,"historyDetailLoaded":true,"localHistorySaved":true,"localExportReady":true,"historyStatus":"ended"}`,
      ].join("\n"));

      const evidence = loadSmokeEvidence(smokeLog, 2);
      const localSummary = evidence.results.find((result) =>
        result.marker === "COREML_NEMOTRON_LOCAL_MVP_RESULT"
      ).summary;

      expect(localSummary.deviceAsrProvider).toBe("coreml_nemotron");
      expect(localSummary.sourceLanguage).toBe("auto");
      expect(localSummary.targetLanguage).toBe("zh");
      expect(localSummary.modelChunkMs).toBe(2240);
      expect(localSummary.autoDownloadModel).toBe(false);
      expect(localSummary.decoderReadyAfterStart).toBe(true);
      expect(localSummary.modelScanStatusAfterStart).toBe("ready");
      expect(localSummary.useLocalSessions).toBe(true);
      expect(localSummary.onDeviceTranslationProvider).toBe("ios_system");
      expect(localSummary.translationAvailable).toBe(true);
      expect(localSummary.translationReason).toBe("ready");
      expect(evidence.issues).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("reports smoke log text privacy violations as issues", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-smoke-privacy-"));
    try {
      const smokeLog = path.join(dir, "mvp-smoke.log");
      writeFileSync(smokeLog, [
        'COREML_NEMOTRON_SELF_TEST_SEGMENT {"id":"seg_1","text":"secret"}',
        'COREML_NEMOTRON_SELF_TEST_RESULT {"receivedText":["secret"]}',
      ].join("\n"));

      const evidence = loadSmokeEvidence(smokeLog, 2);

      expect(evidence.privacyOk).toBe(false);
      expect(evidence.issues.join("\n")).toContain(
        "Smoke log text privacy issue",
      );
      expect(evidence.issues.join("\n")).toContain(
        "COREML_NEMOTRON_SELF_TEST_SEGMENT: forbidden field text",
      );
      expect(evidence.issues.join("\n")).toContain(
        "COREML_NEMOTRON_SELF_TEST_RESULT: forbidden field receivedText",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("reports Gateway ASR sent text privacy violations as issues", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-smoke-asr-sent-privacy-"));
    try {
      const smokeLog = path.join(dir, "mvp-smoke.log");
      writeFileSync(
        smokeLog,
        'COREML_NEMOTRON_GATEWAY_E2E_ASR_SENT {"id":"seg_1","text":"secret"}\n',
      );

      const evidence = loadSmokeEvidence(smokeLog, 2);

      expect(evidence.privacyOk).toBe(false);
      expect(evidence.issues.join("\n")).toContain(
        "COREML_NEMOTRON_GATEWAY_E2E_ASR_SENT: forbidden field text",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("reports text segment privacy violations as issues", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-gateway-privacy-"));
    try {
      const gatewayLog = path.join(dir, "realtime-gateway.log");
      writeFileSync(
        gatewayLog,
        '{"msg":"Client text segment received","text":"secret"}\n',
      );

      const evidence = loadGatewayEvidence(gatewayLog, 2);

      expect(evidence.textSegmentLogFound).toBe(true);
      expect(evidence.privacyOk).toBe(false);
      expect(evidence.issues.join("\n")).toContain(
        "Gateway text segment privacy issue: forbidden field text",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("reports nested text segment privacy violations as issues", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ios-gateway-privacy-nested-"));
    try {
      const gatewayLog = path.join(dir, "realtime-gateway.log");
      writeFileSync(
        gatewayLog,
        '{"msg":"Client text segment received","payload":{"source":{"text":"secret"},"segments":[{"translatedText":"secret"}]}}\n',
      );

      const evidence = loadGatewayEvidence(gatewayLog, 2);

      expect(evidence.textSegmentLogFound).toBe(true);
      expect(evidence.privacyOk).toBe(false);
      expect(evidence.issues.join("\n")).toContain(
        "forbidden field payload.source.text",
      );
      expect(evidence.issues.join("\n")).toContain(
        "forbidden field payload.segments[0].translatedText",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
