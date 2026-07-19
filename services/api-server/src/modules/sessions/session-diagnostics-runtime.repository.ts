import type { RealtimeNodeDiagnosticsDto } from "@translation/contracts";
import type { SessionRecord } from "./session-record.js";
import { mergeSessionNodeDiagnostics as mergeDiagnostics } from
  "./session-diagnostics-merge.js";
import {
  findSession,
  mutateSessionRecord,
  saveSessionDiagnostics,
} from "./sessions-runtime.repository.js";

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
  }, async () => {
    const current = await findSession(sessionId);
    if (!current) return null;
    return saveSessionDiagnostics(
      sessionId,
      mergeDiagnostics(current.diagnostics, node),
    );
  });
}
