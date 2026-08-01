#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  applySpeakerUpdates,
  buildAliasSegments,
  closeSpeakerSession,
  createSpeakerSession,
  encodePcm16Wav,
  pcmForIntervals,
  readJsonl,
  sha256,
  streamSpeakerAudio,
  writeJsonl,
} from "./lib/session_speaker_alias_pipeline.mjs";
import { filterPendingSpeakerSpans } from "./lib/pending_speaker_activation.mjs";
import {
  parseSafetyArgs,
  prepareSafetyOutput,
  summarizeSafetyGates,
} from "./lib/session_speaker_alias_safety_report.mjs";

const args = parseSafetyArgs(process.argv.slice(2));
prepareSafetyOutput(args.outputDir);
const manifestBytes = fs.readFileSync(args.manifest);
const manifest = readJsonl(args.manifest);
const manifestById = new Map(manifest.map((row) => [row.id, row]));
const pairGateBytes = fs.readFileSync(args.pairGate);
const pairGate = JSON.parse(pairGateBytes);
const meetingAuditBytes = fs.readFileSync(args.meetingAudit);
const meetingAudit = JSON.parse(meetingAuditBytes);
const resolverModule = await import(pathToFileURL(args.resolverModule).href);
const similarityModule = await import(pathToFileURL(args.similarityModule).href);
const similarity = new similarityModule.HttpSessionSpeakerSimilarityProvider({
  baseUrl: args.aliasUrl,
  apiKey: args.aliasApiKey,
  timeoutMs: 120_000,
});

const pairResults = [];
for (const [index, pair] of pairGate.pairs.entries()) {
  try {
    pairResults.push(await runPair(pair, index));
  } catch (error) {
    pairResults.push({ ...pair, error: message(error) });
  }
}

const meetingResults = [];
for (const row of meetingAudit.rows) {
  try {
    meetingResults.push(await runMeeting(row));
  } catch (error) {
    meetingResults.push({ session: row.session, error: message(error) });
  }
}

const summary = summarizeSafetyGates(pairResults, meetingResults);
const contract = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  input: {
    manifest: args.manifest,
    manifestSha256: sha256(manifestBytes),
    pairGate: args.pairGate,
    pairGateSha256: sha256(pairGateBytes),
    meetingAudit: args.meetingAudit,
    meetingAuditSha256: sha256(meetingAuditBytes),
  },
  policy: {
    threshold: args.threshold,
    minimumEvidenceMs: args.minimumEvidenceMs,
    minDurationOnMs: args.minDurationOnMs,
    overlapAutoAlias: false,
    mossRole: "single-speaker-collapse-veto_only",
    meetingAutoMergeAllowed: false,
  },
  measurement: {
    pairAudioTransport: "whole_clip",
    meetingAudioTransport: "accelerated_500ms_frames",
    meetingAudioDecode: "ffmpeg_first_90s_channel_0_pcm16le_16khz",
    productionWebSocketMeasured: false,
  },
  code: {
    runnerSha256: sha256(fs.readFileSync(process.argv[1])),
    pipelineHelperSha256: sha256(fs.readFileSync(
      new URL("./lib/session_speaker_alias_pipeline.mjs", import.meta.url),
    )),
    pendingActivationSha256: sha256(fs.readFileSync(
      new URL("./lib/pending_speaker_activation.mjs", import.meta.url),
    )),
    resolverSha256: sha256(fs.readFileSync(args.resolverModule)),
    similarityProviderSha256: sha256(
      fs.readFileSync(args.similarityModule),
    ),
  },
};
writeJsonl(path.join(args.outputDir, "pair-predictions.jsonl"), pairResults);
writeJsonl(
  path.join(args.outputDir, "meeting-predictions.jsonl"),
  meetingResults,
);
fs.writeFileSync(
  path.join(args.outputDir, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(args.outputDir, "run-contract.json"),
  `${JSON.stringify(contract, null, 2)}\n`,
);
console.log(JSON.stringify(summary, null, 2));

async function runPair(pair, index) {
  const sessionId = `alias-pair-${index + 1}`;
  const left = audioFor(pair.left);
  const right = audioFor(pair.right);
  await createSpeakerSession({
    baseUrl: args.aliasUrl,
    apiKey: args.aliasApiKey,
    sessionId,
  });
  try {
    const started = performance.now();
    await similarity.observe({
      sessionId,
      rawSpeakerId: "speaker_1",
      audioBase64: left.toString("base64"),
      overlap: false,
    });
    const observed = await similarity.observe({
      sessionId,
      rawSpeakerId: "speaker_2",
      audioBase64: right.toString("base64"),
      overlap: false,
    });
    return {
      ...pair,
      candidateScore: observed.similarities.speaker_1 ?? null,
      accepted: (observed.similarities.speaker_1 ?? -1) >= args.threshold,
      latencyMs: round(performance.now() - started),
      error: null,
    };
  } finally {
    await closeSpeakerSession({
      baseUrl: args.aliasUrl,
      apiKey: args.aliasApiKey,
      sessionId,
    }).catch(() => undefined);
  }
}

async function runMeeting(row) {
  const sessionId = `alias-meeting-${row.session}`;
  const wav = decodeMeetingAudio(row.audio);
  const resolver = new resolverModule.SessionSpeakerAliasResolver({
    enabled: true,
    minimumEvidenceMs: args.minimumEvidenceMs,
    similarityThreshold: args.threshold,
  });
  await createSpeakerSession({
    baseUrl: args.sortformerUrl,
    apiKey: args.sortformerApiKey,
    sessionId,
  });
  await createSpeakerSession({
    baseUrl: args.aliasUrl,
    apiKey: args.aliasApiKey,
    sessionId,
  });
  try {
    const diarization = await streamSpeakerAudio({
      baseUrl: args.sortformerUrl,
      apiKey: args.sortformerApiKey,
      sessionId,
      wav,
      frameMs: 500,
    });
    const inputSpans = filterPendingSpeakerSpans(
      diarization.spans,
      args.minDurationOnMs,
    );
    const segments = buildAliasSegments(
      row.session,
      inputSpans,
      1000,
      false,
    );
    const pending = new Map();
    const observations = [];
    for (const segment of segments) {
      const intervals = [
        ...(pending.get(segment.rawSpeakerId) ?? []),
        { startMs: segment.startMs, endMs: segment.endMs },
      ];
      pending.set(segment.rawSpeakerId, intervals);
      const evidenceMs = duration(intervals);
      let result = resolver.resolve({
        sessionId,
        rawSpeakerId: segment.rawSpeakerId,
        evidenceMs,
        overlap: segment.overlap,
        similarities: {},
        mossSpeakerCount: row.mossSpeakerCount,
      });
      if (evidenceMs >= args.minimumEvidenceMs) {
        const started = performance.now();
        const observed = await similarity.observe({
          sessionId,
          rawSpeakerId: segment.rawSpeakerId,
          audioBase64: encodePcm16Wav(
            pcmForIntervals(wav, intervals),
            wav.sampleRate,
          ).toString("base64"),
          overlap: segment.overlap,
        });
        result = resolver.resolve({
          sessionId,
          rawSpeakerId: segment.rawSpeakerId,
          evidenceMs: observed.evidenceMs,
          overlap: segment.overlap || !observed.eligible,
          similarities: observed.similarities,
          mossSpeakerCount: row.mossSpeakerCount,
        });
        observations.push({
          rawSpeakerId: segment.rawSpeakerId,
          decision: result.decision,
          similarities: observed.similarities,
          eligible: observed.eligible,
          latencyMs: round(performance.now() - started),
        });
        pending.set(segment.rawSpeakerId, []);
      }
      applySpeakerUpdates(segments, result.updates);
      segment.canonicalSpeakerId = result.canonicalSpeakerId;
      resolver.recordSegment({
        sessionId,
        rawSpeakerId: segment.rawSpeakerId,
        segmentId: segment.segmentId,
        revision: segment.revision,
        timing: { startMs: segment.startMs, endMs: segment.endMs },
      });
    }
    const observedRaw = unique(
      diarization.spans.map((item) => item.speakerId),
    );
    const raw = unique(segments.map((item) => item.rawSpeakerId));
    const canonical = unique(
      segments.map((item) => item.canonicalSpeakerId),
    );
    return {
      session: row.session,
      expectedSpeakerCount: row.expectedSpeakerCount,
      mossSpeakerCount: row.mossSpeakerCount,
      audioPcmSha256: sha256(wav.pcm),
      observedRawSpeakerCount: observedRaw.length,
      rawSpeakerCount: raw.length,
      pendingFilteredSpanCount:
        diarization.spans.length - inputSpans.length,
      canonicalSpeakerCount: canonical.length,
      mergeDecisionCount:
        observations.filter((item) => item.decision === "merged").length,
      mossVetoCount:
        observations.filter((item) => item.decision === "moss_veto").length,
      eligibleObservationCount:
        observations.filter((item) => item.eligible).length,
      observations,
      error: null,
    };
  } finally {
    resolver.clear(sessionId);
    await Promise.all([
      closeSpeakerSession({
        baseUrl: args.sortformerUrl,
        apiKey: args.sortformerApiKey,
        sessionId,
      }).catch(() => undefined),
      closeSpeakerSession({
        baseUrl: args.aliasUrl,
        apiKey: args.aliasApiKey,
        sessionId,
      }).catch(() => undefined),
    ]);
  }
}

function decodeMeetingAudio(audioPath) {
  const pcm = execFileSync("ffmpeg", [
    "-v", "error",
    "-t", "90",
    "-i", audioPath,
    "-af", "pan=mono|c0=c0",
    "-ar", "16000",
    "-c:a", "pcm_s16le",
    "-f", "s16le",
    "pipe:1",
  ], { maxBuffer: 4 * 1024 * 1024 });
  return {
    sampleRate: 16000,
    pcm,
    durationMs: Math.round(pcm.length / 2 / 16000 * 1000),
  };
}

function audioFor(id) {
  const row = manifestById.get(id);
  if (!row) throw new Error(`manifest row missing: ${id}`);
  const audio = fs.readFileSync(
    path.resolve(path.dirname(args.manifest), row.audio_path),
  );
  if (sha256(audio) !== row.sha256) {
    throw new Error(`audio hash mismatch: ${id}`);
  }
  return audio;
}

function duration(intervals) {
  return intervals.reduce(
    (total, item) => total + item.endMs - item.startMs,
    0,
  );
}

function unique(values) {
  return [...new Set(values)].sort();
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
