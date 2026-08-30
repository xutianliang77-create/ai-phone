export function recordSkippedParentDiagnostics(
  diagnostics: {
    splitSkippedParentCount: number;
    splitSkippedReasonCounts: Record<string, number>;
  },
  skippedParents: Array<{ reason: string }>,
) {
  diagnostics.splitSkippedParentCount += skippedParents.length;
  for (const item of skippedParents) {
    diagnostics.splitSkippedReasonCounts[item.reason] =
      (diagnostics.splitSkippedReasonCounts[item.reason] ?? 0) + 1;
  }
}
