import type {
  RealtimeSessionDiagnosticsDto,
  SpeakerTurnCoordinatorDecisionReason,
} from "@translation/contracts";

type SpeakerTurnDiagnostics = NonNullable<
  RealtimeSessionDiagnosticsDto["speakerTurns"]
>;

export function sanitizedSpeakerTurns(value: SpeakerTurnDiagnostics) {
  return {
    confirmedBoundaryCount: value.confirmedBoundaryCount,
    commitHitCount: value.commitHitCount,
    commitMissCount: value.commitMissCount,
    commitErrorCount: value.commitErrorCount,
    endpointRaceCount: value.endpointRaceCount,
    averageConfirmationLatencyMs: value.averageConfirmationLatencyMs,
    maxConfirmationLatencyMs: value.maxConfirmationLatencyMs,
    committedAudioMs: value.committedAudioMs,
    endpointReasons: { ...value.endpointReasons },
    ...(value.boundaryRevisionAttemptCount !== undefined
      ? { boundaryRevisionAttemptCount: value.boundaryRevisionAttemptCount }
      : {}),
    ...(value.boundaryRevisionSuccessCount !== undefined
      ? { boundaryRevisionSuccessCount: value.boundaryRevisionSuccessCount }
      : {}),
    ...(value.boundaryRevisionFailureCount !== undefined
      ? { boundaryRevisionFailureCount: value.boundaryRevisionFailureCount }
      : {}),
    ...(value.boundaryReassignedCharacterCount !== undefined
      ? {
          boundaryReassignedCharacterCount:
            value.boundaryReassignedCharacterCount,
        }
      : {}),
    ...(value.unresolvedCommitMissCount !== undefined
      ? { unresolvedCommitMissCount: value.unresolvedCommitMissCount }
      : {}),
    ...(value.boundaryOutcomeCounts
      ? { boundaryOutcomeCounts: { ...value.boundaryOutcomeCounts } }
      : {}),
    ...(value.coordinatorDecisionCounts
      ? {
          coordinatorDecisionCounts: {
            ...value.coordinatorDecisionCounts,
          },
        }
      : {}),
    ...(value.confirmedSpeakerCount !== undefined
      ? { confirmedSpeakerCount: value.confirmedSpeakerCount }
      : {}),
  };
}

export function isSpeakerTurnDiagnostics(value: unknown) {
  if (!isRecord(value)) return false;
  const counts = [
    value.confirmedBoundaryCount,
    value.commitHitCount,
    value.commitMissCount,
    value.commitErrorCount,
    value.endpointRaceCount,
    value.averageConfirmationLatencyMs,
    value.maxConfirmationLatencyMs,
    value.committedAudioMs,
  ];
  return counts.every(isNonNegativeInteger) &&
    isBoundaryRevisionDiagnostics(value) &&
    isSpeakerBoundaryOutcomeDiagnostics(value) &&
    isCoordinatorDecisionDiagnostics(value) &&
    isEndpointReasonCounts(value.endpointReasons);
}

function isCoordinatorDecisionDiagnostics(value: Record<string, unknown>) {
  const confirmedSpeakerCount = value.confirmedSpeakerCount;
  if (
    confirmedSpeakerCount !== undefined &&
    (!isNonNegativeInteger(confirmedSpeakerCount) || confirmedSpeakerCount > 4)
  ) return false;
  const counts = value.coordinatorDecisionCounts;
  if (counts === undefined) return true;
  if (!isRecord(counts) || confirmedSpeakerCount === undefined) return false;
  if (!Object.entries(counts).every(([key, count]) =>
    coordinatorDecisionReasons.has(key) && isNonNegativeInteger(count)
  )) return false;
  const initialCount = Number(counts.initial_speaker_confirmed ?? 0);
  const boundaryCount = Number(counts.boundary_confirmed ?? 0);
  return initialCount <= 1 &&
    boundaryCount === value.confirmedBoundaryCount &&
    (confirmedSpeakerCount === 0 ? initialCount === 0 : initialCount === 1);
}

const coordinatorDecisionReasonValues = [
  "no_span",
  "overlap_only",
  "missing_confidence",
  "evidence_too_short",
  "dominance_too_low",
  "novel_confidence_too_low",
  "known_confidence_too_low",
  "current_speaker",
  "candidate_reset_label",
  "candidate_reset_start_drift",
  "stable_window_pending",
  "initial_speaker_confirmed",
  "boundary_confirmed",
] as const satisfies readonly SpeakerTurnCoordinatorDecisionReason[];
const coordinatorDecisionReasons = new Set<string>(
  coordinatorDecisionReasonValues,
);

function isSpeakerBoundaryOutcomeDiagnostics(
  value: Record<string, unknown>,
) {
  const unresolved = value.unresolvedCommitMissCount;
  const outcomes = value.boundaryOutcomeCounts;
  if (unresolved === undefined && outcomes === undefined) return true;
  if (!isNonNegativeInteger(unresolved) || !isRecord(outcomes)) return false;
  const allowed = new Set([
    "commit_hit",
    "commit_error",
    "witness_reassignment",
    "token_timing_split",
    "noop_after_endpoint",
    "unresolved",
  ]);
  if (Object.entries(outcomes).some(([key, count]) =>
    !allowed.has(key) || !isNonNegativeInteger(count)
  )) return false;
  const count = (key: string) => Number(outcomes[key] ?? 0);
  const total = [...allowed].reduce((sum, key) => sum + count(key), 0);
  const resolvedMisses = count("witness_reassignment") +
    count("token_timing_split") + count("noop_after_endpoint");
  return total === value.confirmedBoundaryCount &&
    count("commit_hit") === value.commitHitCount &&
    count("commit_error") === value.commitErrorCount &&
    resolvedMisses + count("unresolved") === value.commitMissCount &&
    count("unresolved") === unresolved &&
    (value.boundaryRevisionSuccessCount === undefined ||
      count("witness_reassignment") === value.boundaryRevisionSuccessCount);
}

function isBoundaryRevisionDiagnostics(value: Record<string, unknown>) {
  const counts = [
    value.boundaryRevisionAttemptCount,
    value.boundaryRevisionSuccessCount,
    value.boundaryRevisionFailureCount,
    value.boundaryReassignedCharacterCount,
  ];
  if (counts.every((item) => item === undefined)) return true;
  if (!counts.every(isNonNegativeInteger)) return false;
  const [attempts, successes, failures] = counts as number[];
  return successes + failures <= attempts;
}

function isEndpointReasonCounts(value: unknown) {
  if (!isRecord(value)) return false;
  const allowed = new Set([
    "silence",
    "max_duration",
    "flush",
    "speaker_boundary",
  ]);
  return Object.entries(value).every(
    ([key, count]) => allowed.has(key) && isNonNegativeInteger(count),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
