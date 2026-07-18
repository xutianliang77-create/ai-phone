import type { RealtimeNodeDiagnosticsDto } from "@translation/contracts";
import * as legacy from "./sessions.repository.js";
import type { SessionRecord } from "./session-record.js";
import { mergeSessionNodeDiagnostics as mergeDiagnostics } from
  "./session-diagnostics-merge.js";
import { mutateSessionRecord } from "./sessions-runtime.repository.js";

export function mergeSessionNodeDiagnostics(
  sessionId: string,
  node: RealtimeNodeDiagnosticsDto,
) {
  return mutateSessionRecord(sessionId, "node-diagnostics-merge", node, (current) => {
    const diagnostics = mergeDiagnostics(current.diagnostics, node);
    if (JSON.stringify(diagnostics) === JSON.stringify(current.diagnostics)) {
      return { next: null, result: current };
    }
    const next = structuredClone(current);
    next.diagnostics = diagnostics;
    return { next, result: (saved: SessionRecord) => saved };
  }, () => {
    const current = legacy.findSession(sessionId);
    if (!current) return null;
    return legacy.saveSessionDiagnostics(
      sessionId,
      mergeDiagnostics(current.diagnostics, node),
    );
  });
}
