import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import {
  consumeCallGuestTicket as consumeLegacyCallGuestTicket,
  inspectCallGuestTicket,
  replaceCallGuestTicket as replaceLegacyCallGuestTicket,
} from "./call-guest-ticket.js";
import type { CallGuestTicketRecord } from "./call-link-record.js";
import type { SessionRecord } from "../sessions/session-record.js";

export async function consumeCallGuestTicket(options: {
  callId: string;
  sessionId: string;
  ticket: string;
  now?: Date;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return consumeLegacyCallGuestTicket(options);
  }
  return mutateGuestTicket(
    options.sessionId,
    "consume",
    options,
    { ok: false as const, code: "invalid_guest_ticket" as const },
    (current) => {
      const inspected = inspectCallGuestTicket({
        ...options,
        record: current.callLink?.guestTicket,
      });
      if (!inspected.ok || !current.callLink?.guestTicket) {
        return { result: inspected };
      }
      const consumedAt = (options.now ?? new Date()).toISOString();
      const next = structuredClone(current);
      next.callLink!.guestTicket!.consumedAt = consumedAt;
      next.lastActivityAt = consumedAt;
      return { next, result: { ok: true as const, consumedAt } };
    },
  );
}

export async function replaceCallGuestTicket(
  sessionId: string,
  record: CallGuestTicketRecord,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return replaceLegacyCallGuestTicket(sessionId, record);
  }
  return mutateGuestTicket(sessionId, "replace", record, false, (current) => {
    if (!current.callLink || current.status === "ended") {
      return { result: false };
    }
    const next = structuredClone(current);
    next.callLink!.guestTicket = record;
    next.lastActivityAt = record.issuedAt;
    return { next, result: true };
  });
}

function mutateGuestTicket<T>(
  sessionId: string,
  operation: string,
  payload: unknown,
  missingResult: T,
  plan: (current: SessionRecord) => { next?: SessionRecord; result: T },
) {
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: sessionId },
    async (fence) => {
      const runtime = getRepositoryRuntime();
      if (runtime.driver !== "postgres") {
        throw new Error("PostgreSQL guest ticket runtime changed");
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await runtime.postgres.sessions.find(sessionId);
        if (!current || current.mode !== "call_link") {
          return missingResult;
        }
        const mutation = plan(current);
        if (!mutation.next) return mutation.result;
        mutation.next.version = (current.version ?? 1) + 1;
        const requestHash = repositoryRequestHash({ operation, payload });
        const result = await runtime.postgres.sessions.update({
          sessionId,
          expectedVersion: current.version,
          mutate: () => mutation.next!,
          commandId: repositoryCommandId({
            aggregateId: sessionId,
            operation: `guest-ticket-${operation}`,
            version: current.version ?? 1,
            requestHash,
          }),
          commandType: `session.guest_ticket_${operation}`,
          requestHash,
          fence,
        });
        if (result.status === "version_conflict") continue;
        return result.status === "updated" || result.status === "noop"
          ? mutation.result : missingResult;
      }
      throw new Error(`Guest ticket version conflict: ${sessionId}`);
    },
  );
}
