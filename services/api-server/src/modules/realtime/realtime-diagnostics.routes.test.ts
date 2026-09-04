import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

const internalSecret = "internal-secret-123";
const internalHeaders = { authorization: `Bearer ${internalSecret}` };

describe("realtime diagnostic persistence", () => {
  let previousSecret: string | undefined;

  beforeEach(() => {
    previousSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = internalSecret;
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.billingLedger = [];
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = previousSecret;
  });

  it("persists the first valid diagnostic snapshot idempotently", async () => {
    const app = await buildApp();
    const sessionId = await createRealtimeSession(app);
    const diagnostics = validDiagnostics();
    const ended = await app.inject({
      method: "POST",
      url: `/internal/realtime/sessions/${sessionId}/end`,
      headers: internalHeaders,
      payload: { billableSeconds: 10, diagnostics },
    });
    await app.inject({
      method: "POST",
      url: `/internal/realtime/sessions/${sessionId}/end`,
      headers: internalHeaders,
      payload: {
        diagnostics: {
          ...diagnostics,
          audio: { ...diagnostics.audio, droppedFrameCount: 99 },
        },
      },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    await app.close();

    expect(ended.statusCode).toBe(200);
    expect(detail.json().diagnostics).toEqual(diagnostics);
  });

  it("rejects invalid realtime diagnostics", async () => {
    const app = await buildApp();
    const sessionId = await createRealtimeSession(app);
    const response = await app.inject({
      method: "POST",
      url: `/internal/realtime/sessions/${sessionId}/end`,
      headers: internalHeaders,
      payload: {
        diagnostics: {
          version: 1,
          audio: {
            receivedFrameCount: -1,
            processedBatchCount: 0,
            droppedFrameCount: 0,
          },
        },
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_session_diagnostics");
  });

  it("persists ASR null latency sentinels without a diagnostics 400", async () => {
    const app = await buildApp();
    const sessionId = await createRealtimeSession(app);
    const response = await app.inject({
      method: "POST",
      url: `/internal/realtime/sessions/${sessionId}/end`,
      headers: internalHeaders,
      payload: {
        billableSeconds: 0,
        diagnostics: emptyPushLatencyDiagnostics(),
      },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(detail.json().diagnostics.vad.stablePartial).not.toHaveProperty(
      "averagePushLatencyMs",
    );
    expect(detail.json().diagnostics.vad.stablePartial).not.toHaveProperty(
      "maxPushLatencyMs",
    );
  });
});

async function createRealtimeSession(
  app: Awaited<ReturnType<typeof buildApp>>,
) {
  const created = await app.inject({
    method: "POST",
    url: "/realtime/sessions",
    payload: {
      mode: "conversation",
      sourceLanguage: "en",
      targetLanguage: "zh",
      voiceOutput: false,
    },
  });
  return created.json().sessionId as string;
}

function validDiagnostics() {
  return {
    version: 1,
    audio: {
      receivedFrameCount: 40,
      processedBatchCount: 5,
      droppedFrameCount: 1,
    },
    speakerTurns: {
      confirmedBoundaryCount: 1,
      commitHitCount: 1,
      commitMissCount: 0,
      commitErrorCount: 0,
      endpointRaceCount: 0,
      averageConfirmationLatencyMs: 720,
      maxConfirmationLatencyMs: 720,
      committedAudioMs: 2500,
      endpointReasons: { speaker_boundary: 1, flush: 1 },
      coordinatorDecisionCounts: {
        initial_speaker_confirmed: 1,
        current_speaker: 2,
        stable_window_pending: 1,
        boundary_confirmed: 1,
      },
      confirmedSpeakerCount: 2,
    },
    vad: {
      configuredProvider: "marblenet",
      activeProvider: "marblenet",
      threshold: 0.05,
      analyzedFrameCount: 40,
      speechFrameCount: 30,
      speechFrameRatio: 0.75,
      fallbackCount: 0,
      modelFingerprint: "a".repeat(64),
      endpointPolicy: {
        mode: "listening",
        minAudioMs: 500,
        endpointSilenceMs: 1400,
        maxAudioMs: 10000,
        prerollMs: 400,
        fingerprint: "b".repeat(64),
      },
      stablePartial: {
        enabled: true,
        policy: "qwen17_adjacent_prefix_zh_v1",
        eligibleSegmentCount: 3,
        activeSegment: false,
        decodeCount: 7,
        decisionCount: 7,
        emittedCount: 1,
        rejectionCounts: {
          insufficient_units: 4,
          language_gate: 2,
        },
        languageEvidenceSource: "qwen_streaming_state_label",
        languageEvidenceCounts: {
          empty: 1,
          zh: 2,
          en: 2,
          other: 2,
        },
        languageGateCounts: { en: 1, other: 1 },
      },
    },
  } as const;
}

function emptyPushLatencyDiagnostics() {
  const diagnostics = validDiagnostics();
  return {
    ...diagnostics,
    audio: {
      receivedFrameCount: 0,
      processedBatchCount: 0,
      droppedFrameCount: 0,
    },
    speakerTurns: {
      confirmedBoundaryCount: 0,
      commitHitCount: 0,
      commitMissCount: 0,
      commitErrorCount: 0,
      endpointRaceCount: 0,
      averageConfirmationLatencyMs: 0,
      maxConfirmationLatencyMs: 0,
      committedAudioMs: 0,
      endpointReasons: {},
    },
    vad: {
      ...diagnostics.vad,
      analyzedFrameCount: 0,
      speechFrameCount: 0,
      speechFrameRatio: 0,
      probabilityMin: null,
      probabilityMax: null,
      probabilityMean: null,
      stablePartial: {
        enabled: true,
        policy: "qwen17_chunk_aware_extension_survival_zh_v5",
        minimumPushAudioMs: 40,
        eligibleSegmentCount: 0,
        activeSegment: false,
        decodeCount: 0,
        decisionCount: 0,
        emittedCount: 0,
        rejectionCounts: {},
        languageEvidenceSource: "qwen_streaming_state_label",
        languageEvidenceCounts: {},
        languageGateCounts: {},
        scheduledPushCount: 0,
        completedPushCount: 0,
        coalescedObservationCount: 0,
        invalidatedPushCount: 0,
        inFlight: false,
        resultReady: false,
        pendingAudioMs: 0,
        maxPendingAudioMs: 0,
        averagePushLatencyMs: null,
        maxPushLatencyMs: null,
        firstStablePartialLatencyMs: null,
        lastStablePartialLatencyMs: null,
      },
    },
  };
}
