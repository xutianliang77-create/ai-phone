import type {
  SessionQualityProviderDto,
  SessionQualityReportResponse,
  SessionSegmentDto,
} from "@translation/contracts";
import type { SessionRecord } from "./session-record.js";

export function buildSessionQualityReport(
  session: SessionRecord,
  now = new Date(),
): SessionQualityReportResponse {
  const segments = session.segments.filter(hasSourceText);
  const translated = segments.filter(hasTranslation).length;
  const sourceOnly = segments.length - translated;
  const latencies = segments
    .map((segment) => segment.latencyMs ?? segment.providerUsage?.latencyMs)
    .filter((value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
    )
    .sort((left, right) => left - right);
  const diagnostics = session.diagnostics;
  const endpointReasons = endpointReasonCounts(segments);
  const speakerIds = new Set(
    segments
      .map((segment) => segment.speaker?.speakerId.trim())
      .filter((value): value is string => Boolean(value) && value !== "unknown"),
  );
  const report: SessionQualityReportResponse = {
    version: 1,
    sessionId: session.id,
    generatedAt: now.toISOString(),
    status: session.status,
    consumedSeconds: session.consumedSeconds,
    segments: {
      total: segments.length,
      translated,
      sourceOnly,
      translationCoverage: ratio(translated, segments.length),
      mixedLanguage: segments.filter((segment) => segment.mixedLanguage).length,
    },
    latency: latencySummary(latencies),
    ...(diagnostics
      ? {
          audio: {
            receivedFrames: diagnostics.audio.receivedFrameCount,
            droppedFrames: diagnostics.audio.droppedFrameCount,
            dropRate: ratio(
              diagnostics.audio.droppedFrameCount,
              diagnostics.audio.receivedFrameCount,
            ),
          },
        }
      : {}),
    ...(diagnostics?.vad
      ? {
          vad: {
            configuredProvider: diagnostics.vad.configuredProvider,
            activeProvider: diagnostics.vad.activeProvider,
            fallbackCount: diagnostics.vad.fallbackCount,
            ...(diagnostics.vad.fallbackReason
              ? { fallbackReason: diagnostics.vad.fallbackReason }
              : {}),
            speechFrameRatio: diagnostics.vad.speechFrameRatio,
            ...(diagnostics.vad.modelFingerprint
              ? { modelFingerprint: diagnostics.vad.modelFingerprint }
              : {}),
            endpointPolicyFingerprint:
              diagnostics.vad.endpointPolicy.fingerprint,
          },
        }
      : {}),
    endpoints: mergeEndpointReasons(
      endpointReasons,
      diagnostics?.speakerTurns?.endpointReasons,
    ),
    speakers: {
      identified: speakerIds.size,
      unknownSegments: segments.filter(isUnknownSpeaker).length,
      overlapSegments: segments.filter((segment) => segment.timing?.overlap).length,
    },
    providers: providerSummary(segments),
    ...playbackSummary(session),
    flags: [],
  };
  report.flags = qualityFlags(report);
  return report;
}

function playbackSummary(session: SessionRecord) {
  const playbacks = session.playbacks ?? [];
  if (playbacks.length === 0) return {};
  const stopLatencies = playbacks
    .map((playback) => playback.bargeIn?.stopLatencyMs)
    .filter((value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
    )
    .sort((left, right) => left - right);
  const latency = latencySummary(stopLatencies);
  return {
    playback: {
      total: playbacks.length,
      completed: playbacks.filter((item) => item.status === "completed").length,
      interrupted: playbacks.filter((item) => item.status === "interrupted").length,
      failed: playbacks.filter((item) => item.status === "failed").length,
      bargeInInterruptions: playbacks.filter((item) =>
        item.interruptReason === "barge_in"
      ).length,
    },
    bargeIn: {
      sampleCount: latency.sampleCount,
      averageStopLatencyMs: latency.averageMs,
      p95StopLatencyMs: latency.p95Ms,
      maxStopLatencyMs: latency.maxMs,
    },
  };
}

function hasSourceText(segment: SessionSegmentDto) {
  return segment.sourceText.trim().length > 0;
}

function hasTranslation(segment: SessionSegmentDto) {
  return segment.translatedText.trim().length > 0;
}

function isUnknownSpeaker(segment: SessionSegmentDto) {
  return !segment.speaker ||
    segment.speaker.role === "unknown" ||
    segment.speaker.speakerId === "unknown";
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function latencySummary(values: number[]) {
  if (values.length === 0) {
    return { sampleCount: 0, averageMs: 0, p95Ms: 0, maxMs: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.max(0, Math.ceil(values.length * 0.95) - 1);
  return {
    sampleCount: values.length,
    averageMs: Math.round(total / values.length),
    p95Ms: values[p95Index]!,
    maxMs: values[values.length - 1]!,
  };
}

function endpointReasonCounts(segments: SessionSegmentDto[]) {
  const counts: SessionQualityReportResponse["endpoints"] = {};
  for (const segment of segments) {
    const reason = segment.vadContext?.endpointReason;
    if (reason) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

function mergeEndpointReasons(
  segmentCounts: SessionQualityReportResponse["endpoints"],
  diagnosticCounts?: SessionQualityReportResponse["endpoints"],
) {
  return Object.keys(segmentCounts).length > 0
    ? segmentCounts
    : { ...(diagnosticCounts ?? {}) };
}

function providerSummary(segments: SessionSegmentDto[]) {
  const counts = new Map<string, SessionQualityProviderDto>();
  for (const segment of segments) {
    const provider = segment.provider ?? segment.providerUsage?.provider;
    if (!provider) continue;
    const stage = segment.stage ?? "unknown";
    const model = segment.model ?? segment.providerUsage?.model;
    const key = `${stage}\u0000${provider}\u0000${model ?? ""}`;
    const current = counts.get(key);
    if (current) {
      current.segmentCount += 1;
    } else {
      counts.set(key, {
        stage,
        provider,
        ...(model ? { model } : {}),
        segmentCount: 1,
      });
    }
  }
  return [...counts.values()].sort((left, right) =>
    `${left.stage}:${left.provider}:${left.model ?? ""}`.localeCompare(
      `${right.stage}:${right.provider}:${right.model ?? ""}`,
    )
  );
}

function qualityFlags(report: SessionQualityReportResponse) {
  const flags: string[] = [];
  if (report.segments.total === 0) flags.push("no_segments");
  if (report.segments.sourceOnly > 0) flags.push("source_without_translation");
  if (!report.audio) flags.push("missing_audio_diagnostics");
  if ((report.audio?.droppedFrames ?? 0) > 0) flags.push("audio_frames_dropped");
  if ((report.vad?.fallbackCount ?? 0) > 0) flags.push("vad_fallback");
  if (report.speakers.unknownSegments > 0) flags.push("unknown_speaker");
  if (report.latency.p95Ms > 2500) flags.push("high_translation_latency");
  if ((report.endpoints.max_duration ?? 0) > 0) flags.push("max_duration_endpoint");
  if ((report.playback?.failed ?? 0) > 0) flags.push("playback_failed");
  if ((report.bargeIn?.p95StopLatencyMs ?? 0) > 300) {
    flags.push("slow_barge_in_stop");
  }
  return flags;
}
