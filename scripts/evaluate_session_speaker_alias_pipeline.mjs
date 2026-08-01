#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  applySpeakerUpdates,
  buildAliasInputSegments,
  closeSpeakerSession,
  createSpeakerSession,
  encodePcm16Wav,
  parsePcm16Wav,
  pcmForIntervals,
  readJsonl,
  sha256,
  streamSpeakerAudio,
  writeJsonl,
} from "./lib/session_speaker_alias_pipeline.mjs";
import { filterPendingSpeakerSpans } from "./lib/pending_speaker_activation.mjs";
import {
  parseAliasPipelineArgs, prepareAliasPipelineOutput, smokeRows,
} from "./lib/session_speaker_alias_pipeline_args.mjs";
import { summarizeAliasPipeline } from "./lib/session_speaker_alias_pipeline_report.mjs";

const args = parseAliasPipelineArgs(process.argv.slice(2));
const manifestBytes = fs.readFileSync(args.manifest);
const manifestSha256 = sha256(manifestBytes);
const auditBytes = fs.readFileSync(args.mossAudit);
const audit = JSON.parse(auditBytes);
if (manifestSha256 !== audit.manifestSha256) {
  throw new Error("manifest hash does not match the frozen MOSS audit");
}

const allRows = readJsonl(args.manifest);
const rows = args.mode === "smoke" ? smokeRows(allRows) : allRows;
const auditById = new Map(audit.rows.map((row) => [row.id, row]));
if (rows.some((row) => !auditById.has(row.id))) {
  throw new Error("MOSS audit does not cover every selected manifest row");
}
prepareAliasPipelineOutput(args.outputDir);

const resolverModule = await import(pathToFileURL(args.resolverModule).href);
const similarityModule = await import(pathToFileURL(args.similarityModule).href);
const resolver = new resolverModule.SessionSpeakerAliasResolver({
  enabled: true,
  minimumEvidenceMs: args.minimumEvidenceMs,
  similarityThreshold: args.threshold,
});
const similarity = new similarityModule.HttpSessionSpeakerSimilarityProvider({
  baseUrl: args.aliasUrl,
  apiKey: args.aliasApiKey,
  timeoutMs: 120_000,
});

const results = [];
for (const [index, row] of rows.entries()) {
  const moss = auditById.get(row.id);
  try {
    results.push(await runCase(row, moss));
  } catch (error) {
    results.push({
      id: row.id,
      diagnosticOnly: row.score_mode === "diagnostic_only",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  process.stderr.write(`[${index + 1}/${rows.length}] ${row.id}\n`);
}

const summary = summarizeAliasPipeline(results);
const contract = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  mode: args.mode,
  input: {
    manifest: args.manifest,
    manifestSha256,
    mossAudit: args.mossAudit,
    mossAuditSha256: sha256(auditBytes),
    selectedRows: rows.length,
    farFieldRows: rows.filter((row) => row.score_mode === "cer").length,
    overlapDiagnosticRows:
      rows.filter((row) => row.score_mode === "diagnostic_only").length,
  },
  policy: {
    threshold: args.threshold,
    minimumEvidenceMs: args.minimumEvidenceMs,
    segmentMs: args.segmentMs,
    minDurationOnMs: args.minDurationOnMs,
    frameMs: args.frameMs,
    overlapAutoAlias: false,
    mossRole: "single-speaker-collapse-veto_only",
    aliasInputMode: args.aliasInputMode,
  },
  services: {
    sortformerUrl: args.sortformerUrl,
    aliasUrl: args.aliasUrl,
  },
  measurement: {
    audioTransport: "accelerated",
    backfillLatency: "audio_timeline_wait_plus_http_titanet_resolver_wall_time",
    productionWebSocketMeasured: false,
  },
  code: {
    runnerSha256: sha256(fs.readFileSync(process.argv[1])),
    helperSha256: sha256(fs.readFileSync(
      new URL("./lib/session_speaker_alias_pipeline.mjs", import.meta.url),
    )),
    pendingActivationSha256: sha256(fs.readFileSync(
      new URL("./lib/pending_speaker_activation.mjs", import.meta.url),
    )),
    reportSha256: sha256(fs.readFileSync(
      new URL("./lib/session_speaker_alias_pipeline_report.mjs", import.meta.url),
    )),
    argsSha256: sha256(fs.readFileSync(
      new URL("./lib/session_speaker_alias_pipeline_args.mjs", import.meta.url),
    )),
    resolverSha256: sha256(fs.readFileSync(args.resolverModule)),
    similarityProviderSha256:
      sha256(fs.readFileSync(args.similarityModule)),
  },
};
writeJsonl(path.join(args.outputDir, "predictions.jsonl"), results);
fs.writeFileSync(
  path.join(args.outputDir, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(args.outputDir, "run-contract.json"),
  `${JSON.stringify(contract, null, 2)}\n`,
);
console.log(JSON.stringify(summary, null, 2));

async function runCase(row, moss) {
  const audioPath = path.resolve(path.dirname(args.manifest), row.audio_path);
  const audioBytes = fs.readFileSync(audioPath);
  if (sha256(audioBytes) !== row.sha256) {
    throw new Error("audio hash does not match manifest");
  }
  const wav = parsePcm16Wav(audioBytes);
  const sessionId = `alias-eval-${args.mode}-${row.id}`;
  const session = {
    sessionId,
    sortformerCreated: false,
    aliasCreated: false,
  };
  try {
    await createSpeakerSession({
      baseUrl: args.sortformerUrl,
      apiKey: args.sortformerApiKey,
      sessionId,
    });
    session.sortformerCreated = true;
    await createSpeakerSession({
      baseUrl: args.aliasUrl,
      apiKey: args.aliasApiKey,
      sessionId,
    });
    session.aliasCreated = true;
    const diarization = await streamSpeakerAudio({
      baseUrl: args.sortformerUrl,
      apiKey: args.sortformerApiKey,
      sessionId,
      wav,
      frameMs: args.frameMs,
    });
    return await aliasCase(row, moss, wav, diarization, sessionId);
  } finally {
    resolver.clear(sessionId);
    if (session.sortformerCreated) {
      await closeSpeakerSession({
        baseUrl: args.sortformerUrl,
        apiKey: args.sortformerApiKey,
        sessionId,
      }).catch(() => undefined);
    }
    if (session.aliasCreated) {
      await closeSpeakerSession({
        baseUrl: args.aliasUrl,
        apiKey: args.aliasApiKey,
        sessionId,
      }).catch(() => undefined);
    }
  }
}

async function aliasCase(row, moss, wav, diarization, sessionId) {
  const diagnosticOnly = row.score_mode === "diagnostic_only";
  const inputSpans = filterPendingSpeakerSpans(
    diarization.spans,
    args.minDurationOnMs,
  );
  const segments = buildAliasInputSegments({
    caseId: row.id,
    spans: inputSpans,
    durationMs: wav.durationMs,
    segmentMs: args.segmentMs,
    minimumEvidenceMs: args.minimumEvidenceMs,
    diagnosticOnly,
    inputMode: args.aliasInputMode,
  });
  const pending = new Map();
  const observations = [];
  const revisions = [];
  for (const segment of segments) {
    const intervals = [
      ...(pending.get(segment.rawSpeakerId) ?? []),
      { startMs: segment.startMs, endMs: segment.endMs },
    ];
    pending.set(segment.rawSpeakerId, intervals);
    const evidenceMs = intervalDuration(intervals);
    let aliasResult = resolver.resolve({
      sessionId,
      rawSpeakerId: segment.rawSpeakerId,
      evidenceMs,
      overlap: segment.overlap,
      similarities: {},
      mossSpeakerCount: moss.mossSpeakerCount,
    });
    if (evidenceMs >= args.minimumEvidenceMs) {
      const evidence = encodePcm16Wav(
        pcmForIntervals(wav, intervals),
        wav.sampleRate,
      );
      const started = performance.now();
      const observed = await similarity.observe({
        sessionId,
        rawSpeakerId: segment.rawSpeakerId,
        audioBase64: evidence.toString("base64"),
        overlap: segment.overlap,
      });
      aliasResult = resolver.resolve({
        sessionId,
        rawSpeakerId: segment.rawSpeakerId,
        evidenceMs: observed.evidenceMs,
        overlap: segment.overlap || !observed.eligible,
        similarities: observed.similarities,
        mossSpeakerCount: moss.mossSpeakerCount,
      });
      const computeMs = round(performance.now() - started);
      observations.push({
        rawSpeakerId: segment.rawSpeakerId,
        atAudioMs: segment.endMs,
        computeMs,
        eligible: observed.eligible,
        similarities: observed.similarities,
        decision: aliasResult.decision,
      });
      for (const update of aliasResult.updates) {
        revisions.push({
          ...update,
          computeMs,
          audioBackfillDelayMs: Math.max(
            0,
            segment.endMs - (update.timing?.endMs ?? segment.endMs),
          ),
          endToEndBackfillMs: round(
            Math.max(
              0,
              segment.endMs - (update.timing?.endMs ?? segment.endMs),
            ) + computeMs,
          ),
        });
      }
      pending.set(segment.rawSpeakerId, []);
    }
    applySpeakerUpdates(segments, aliasResult.updates);
    segment.canonicalSpeakerId = aliasResult.canonicalSpeakerId;
    resolver.recordSegment({
      sessionId,
      rawSpeakerId: segment.rawSpeakerId,
      segmentId: segment.segmentId,
      turnId: segment.turnId,
      revision: segment.revision,
      timing: {
        startMs: segment.startMs,
        endMs: segment.endMs,
        source: "client",
      },
    });
  }
  const rawSpeakers = unique(
    diarization.spans.map((item) => item.speakerId),
  );
  const inputRawSpeakers = unique(
    segments.map((item) => item.rawSpeakerId),
  );
  const canonicalSpeakers = unique(
    segments.map((item) => item.canonicalSpeakerId),
  );
  return {
    schemaVersion: 1,
    id: row.id,
    diagnosticOnly,
    expectedSpeakerCount: moss.expectedSpeakerCount,
    mossSpeakerCount: moss.mossSpeakerCount,
    durationMs: wav.durationMs,
    sortformer: {
      firstEvidenceAudioMs: diarization.firstEvidenceAudioMs,
      rawSpeakerCount: rawSpeakers.length,
      rawSpeakers,
      pendingFilteredSpanCount:
        diarization.spans.length - inputSpans.length,
      spans: diarization.spans,
    },
    alias: {
      inputMode: args.aliasInputMode,
      inputRawSpeakerCount: inputRawSpeakers.length,
      inputRawSpeakers,
      canonicalSpeakerCount: canonicalSpeakers.length,
      canonicalSpeakers,
      appliedSegmentCount:
        segments.filter((item) =>
          item.rawSpeakerId !== item.canonicalSpeakerId
        ).length,
      observationCount: observations.length,
      eligibleObservationCount:
        observations.filter((item) => item.eligible).length,
      mergeDecisionCount:
        observations.filter((item) => item.decision === "merged").length,
      mossVetoCount:
        observations.filter((item) => item.decision === "moss_veto").length,
      observations,
      revisions,
      segments,
    },
    error: null,
  };
}

function intervalDuration(intervals) {
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
