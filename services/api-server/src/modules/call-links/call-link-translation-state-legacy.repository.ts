import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import type { SessionRecord } from "../sessions/session-record.js";

interface MutationPlan<T> {
  next: SessionRecord | null;
  result: T | ((saved: SessionRecord) => T);
}

export function mutateLegacyCallLinkTranslationState<T>(
  sessionId: string,
  plan: (current: SessionRecord) => MutationPlan<T>,
) {
  const session = getStoreSnapshot().sessions.find(
    (item) => item.id === sessionId,
  );
  if (!session) return null;
  const mutation = plan(session);
  if (!mutation.next) return resolveResult(mutation.result, session);
  mutation.next.version = (session.version ?? 1) + 1;
  const store = getStoreSnapshot();
  store.sessions = store.sessions.map((item) =>
    item.id === sessionId ? mutation.next! : item);
  persistStoreSnapshot();
  return resolveResult(mutation.result, mutation.next);
}

function resolveResult<T>(
  value: T | ((saved: SessionRecord) => T),
  saved: SessionRecord,
) {
  return typeof value === "function"
    ? (value as (record: SessionRecord) => T)(saved)
    : value;
}
