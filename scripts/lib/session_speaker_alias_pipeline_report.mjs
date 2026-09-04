import { percentile } from "./session_speaker_alias_pipeline.mjs";

export function summarizeAliasPipeline(results) {
  const completed = results.filter((row) => !row.error);
  const far = completed.filter((row) => !row.diagnosticOnly);
  const overlap = completed.filter((row) => row.diagnosticOnly);
  const split = far.filter((row) => inputSpeakerCount(row) > 1);
  const zeroError = far.filter((row) => inputSpeakerCount(row) === 1);
  const blank = far.filter((row) => row.sortformer.rawSpeakerCount === 0);
  const observations = completed.flatMap((row) => row.alias.observations);
  const revisions = completed.flatMap((row) => row.alias.revisions);
  const summary = {
    schemaVersion: 1,
    completedCount: completed.length,
    errorCount: results.length - completed.length,
    farField: {
      total: far.length,
      blankCases: blank.length,
      pendingFilteredCases: far.filter(
        (row) => row.sortformer.pendingFilteredSpanCount > 0
      ).length,
      pendingFilteredSpans: far.reduce(
        (total, row) =>
          total + (row.sortformer.pendingFilteredSpanCount ?? 0),
        0,
      ),
      observedRawSplitCases:
        far.filter((row) => row.sortformer.rawSpeakerCount > 1).length,
      rawSplitCases: split.length,
      repairedToOne: split.filter(
        (row) => row.alias.canonicalSpeakerCount === 1
      ).length,
      unresolvedSplit: split.filter(
        (row) => row.alias.canonicalSpeakerCount > 1
      ).length,
      zeroErrorCases: zeroError.length,
      zeroErrorPreserved: zeroError.filter(
        (row) => row.alias.canonicalSpeakerCount === 1
      ).length,
    },
    overlapDiagnosticOnly: {
      total: overlap.length,
      aliasAppliedCases: overlap.filter(
        (row) => row.alias.appliedSegmentCount > 0
      ).length,
      rawCountExact: overlap.filter(
        (row) => row.sortformer.rawSpeakerCount === row.expectedSpeakerCount
      ).length,
    },
    alias: {
      inputModes: [...new Set(
        completed.map((row) => row.alias.inputMode ?? "observed"),
      )],
      observationCount: observations.length,
      eligibleObservationCount:
        observations.filter((item) => item.eligible).length,
      mergeDecisionCount:
        observations.filter((item) => item.decision === "merged").length,
      mossVetoCount:
        observations.filter((item) => item.decision === "moss_veto").length,
      revisionCount: revisions.length,
      observationLatencyMs:
        latency(observations.map((item) => item.computeMs)),
      eligibleTitaNetLatencyMs:
        latency(
          observations
            .filter((item) => item.eligible)
            .map((item) => item.computeMs),
        ),
      computeLatencyMs:
        latency(revisions.map((item) => item.computeMs)),
      endToEndBackfillMs:
        latency(revisions.map((item) => item.endToEndBackfillMs)),
    },
    coverageBoundary: {
      sequentialDifferentSpeakerFalseMergeMeasured: false,
      retainedPairGate: "0/41 at cosine >= 0.60",
      overlapExcludedFromHardGate: true,
    },
  };
  summary.gates = {
    allCasesCompleted: summary.errorCount === 0,
    ordinarySpeechDetected: summary.farField.blankCases === 0,
    ordinarySplitsResolved: summary.farField.unresolvedSplit === 0,
    zeroErrorPreserved:
      summary.farField.zeroErrorCases ===
        summary.farField.zeroErrorPreserved,
    overlapAutoAliasBlocked:
      summary.overlapDiagnosticOnly.aliasAppliedCases === 0,
  };
  summary.passed = Object.values(summary.gates).every(Boolean);
  return summary;
}

function inputSpeakerCount(row) {
  return row.alias.inputRawSpeakerCount ?? row.sortformer.rawSpeakerCount;
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
