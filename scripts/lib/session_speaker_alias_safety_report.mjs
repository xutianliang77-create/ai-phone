import fs from "node:fs";
import { percentile } from "./session_speaker_alias_pipeline.mjs";

export function summarizeSafetyGates(pairs, meetings) {
  const validPairs = pairs.filter((row) => !row.error);
  const same = validPairs.filter((row) => row.sameSpeaker);
  const different = validPairs.filter((row) => !row.sameSpeaker);
  const validMeetings = meetings.filter((row) => !row.error);
  const latencies = validPairs.map((row) => row.latencyMs);
  const summary = {
    schemaVersion: 1,
    pairs: {
      completed: validPairs.length,
      errors: pairs.length - validPairs.length,
      sameAccepted: same.filter((row) => row.accepted).length,
      sameTotal: same.length,
      differentFalseMerges:
        different.filter((row) => row.accepted).length,
      differentTotal: different.length,
      latencyMs: latency(latencies),
    },
    meetings: {
      completed: validMeetings.length,
      errors: meetings.length - validMeetings.length,
      pendingFilteredSessions:
        validMeetings.filter((row) => row.pendingFilteredSpanCount > 0).length,
      pendingFilteredSpans: validMeetings.reduce(
        (total, row) => total + (row.pendingFilteredSpanCount ?? 0),
        0,
      ),
      autoMergeSessions:
        validMeetings.filter((row) => row.mergeDecisionCount > 0).length,
      rawCountExact:
        validMeetings.filter(
          (row) => row.rawSpeakerCount === row.expectedSpeakerCount,
        ).length,
      canonicalCountExact:
        validMeetings.filter(
          (row) => row.canonicalSpeakerCount === row.expectedSpeakerCount,
        ).length,
    },
  };
  summary.gates = {
    sameSpeakerRecallRetained:
      summary.pairs.sameAccepted >= 35 && summary.pairs.sameTotal === 42,
    zeroDifferentSpeakerFalseMerges:
      summary.pairs.differentFalseMerges === 0 &&
      summary.pairs.differentTotal === 41,
    allMeetingsCompleted:
      summary.meetings.completed === 8 && summary.meetings.errors === 0,
    zeroMeetingAutoMerges: summary.meetings.autoMergeSessions === 0,
  };
  summary.passed = Object.values(summary.gates).every(Boolean);
  return summary;
}

export function prepareSafetyOutput(outputDir) {
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0) {
    throw new Error(`output directory is not empty: ${outputDir}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
}

export function parseSafetyArgs(values) {
  const options = Object.fromEntries(values.flatMap((value, index) =>
    value.startsWith("--") && values[index + 1] &&
      !values[index + 1].startsWith("--")
      ? [[value.slice(2), values[index + 1]]]
      : []
  ));
  const required = (name) => {
    if (!options[name]) throw new Error(`--${name} is required`);
    return options[name];
  };
  return {
    manifest: required("manifest"),
    pairGate: required("pair-gate"),
    meetingAudit: required("meeting-audit"),
    sortformerUrl: required("sortformer-url"),
    aliasUrl: required("alias-url"),
    resolverModule: required("resolver-module"),
    similarityModule: required("similarity-module"),
    outputDir: required("output-dir"),
    sortformerApiKey: options["sortformer-api-key"],
    aliasApiKey: options["alias-api-key"],
    minimumEvidenceMs: Number(options["minimum-evidence-ms"] ?? 1500),
    minDurationOnMs: Number(options["min-duration-on-ms"] ?? 0),
    threshold: Number(options.threshold ?? 0.60),
  };
}

function latency(values) {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? round(Math.max(...values)) : null,
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
