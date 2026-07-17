import { isTerminalRealtimeSessionState } from "@translation/contracts";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";

export async function listStaleSessionCandidates(
  before: Date,
  limit = 500,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver === "postgres") {
    return runtime.postgres.sessions.listStaleCandidates(before, limit);
  }
  return getStoreSnapshot().sessions
    .filter((session) => !isTerminalRealtimeSessionState(session.status))
    .filter((session) => {
      const lastActivity = Date.parse(
        session.lastActivityAt ?? session.createdAt,
      );
      return Number.isFinite(lastActivity) && lastActivity < before.getTime();
    })
    .slice(0, limit);
}
