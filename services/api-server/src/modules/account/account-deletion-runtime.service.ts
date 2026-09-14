import { isTerminalRealtimeSessionState } from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import {
  findAccountById,
  markAccountContentErased,
} from "./account-runtime.service.js";
import type { AccountRecord, SmsOtpChallengeRecord } from
  "./account-record.js";
import {
  deleteSession,
  listSessions,
  markSessionForAccountDeletion,
  type SessionRecord,
} from "../sessions/sessions-runtime.repository.js";

/**
 * No provider work is invoked here. A request revokes access immediately,
 * fails closed at the public admission boundary, and lets the established
 * runtime finalizer perform the only valid settlement before content removal.
 */
export async function processPublicAccountDeletion(
  accountId: string,
  options: { now?: Date } = {},
): Promise<AccountDeletionProgress> {
  const now = options.now ?? new Date();
  const account = await findAccountById(accountId);
  if (!account) return { status: "not_found" };
  if (account.status === "active") return { status: "not_requested", account };
  if (account.status === "deleted") return { status: "content_erased", account };

  await removeRevokedCredentialsAndChallenges(account);
  const sessions = await listSessions(account.id);
  const pending = sessions.filter((session) => !safeToErase(session));
  for (const session of pending) {
    await markSessionForAccountDeletion(session.id, account.deletionRequestedAt ?? now.toISOString());
  }
  if (pending.length > 0) {
    return {
      status: "awaiting_safe_terminal",
      account,
      pendingSessionIds: pending.map((session) => session.id),
    };
  }

  for (const session of sessions) await deleteSession(session.id);
  await removeOwnedTermbaseTerms(account.id);
  const erased = await markAccountContentErased(account.id, now);
  return erased
    ? { status: "content_erased", account: erased }
    : { status: "not_found" };
}

export async function recoverPendingPublicAccountDeletions() {
  const accounts = await deletionRequestedAccounts();
  const results = await Promise.all(accounts.map((account) =>
    processPublicAccountDeletion(account.id),
  ));
  return {
    inspectedCount: accounts.length,
    contentErasedCount: results.filter((result) => result.status === "content_erased").length,
    pendingSessionCount: results.reduce((count, result) => count +
      (result.status === "awaiting_safe_terminal" ? result.pendingSessionIds.length : 0), 0),
  };
}

export function startPublicAccountDeletionRecovery(options: {
  intervalMs?: number;
  onResult?: (result: Awaited<ReturnType<typeof recoverPendingPublicAccountDeletions>>) => void;
  onError?: (error: unknown) => void;
} = {}) {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void recoverPendingPublicAccountDeletions()
      .then((result) => options.onResult?.(result))
      .catch((error) => options.onError?.(error))
      .finally(() => { running = false; });
  };
  const timer = setInterval(run, Math.max(1_000, options.intervalMs ?? 60_000));
  timer.unref();
  return () => clearInterval(timer);
}

function safeToErase(session: SessionRecord) {
  if (!isTerminalRealtimeSessionState(session.status)) return false;
  return !session.processingAuthorization || Boolean(
    session.publicFinalization && session.finalizationIdempotencyKey && session.finalizedAt,
  );
}

async function deletionRequestedAccounts() {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return getStoreSnapshot().accounts.filter((account) =>
      account.status === "deletion_requested",
    );
  }
  return runtime.postgres.productRecords.query<AccountRecord>({
    namespace: "accounts", status: "deletion_requested", limit: 500,
  });
}

async function removeRevokedCredentialsAndChallenges(account: AccountRecord) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    const store = getStoreSnapshot();
    store.authSessions = store.authSessions.filter((session) => session.userId !== account.id);
    store.smsOtpChallenges = store.smsOtpChallenges.filter((challenge) =>
      challenge.phoneHash !== account.phoneHash,
    );
    persistStoreSnapshot();
    return;
  }
  const [sessions, challenges] = await Promise.all([
    runtime.postgres.productRecords.query<{ tokenHash: string }>({
      namespace: "authSessions", ownerId: account.id, limit: 500,
    }),
    runtime.postgres.productRecords.query<SmsOtpChallengeRecord>({
      namespace: "smsOtpChallenges", ownerId: account.phoneHash, limit: 500,
    }),
  ]);
  for (const session of sessions) {
    await removeOwnedProductRecord("authSessions", session.tokenHash, account.id);
  }
  for (const challenge of challenges) {
    await removeOwnedProductRecord("smsOtpChallenges", challenge.id, account.id);
  }
}

async function removeOwnedTermbaseTerms(accountId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    const store = getStoreSnapshot();
    store.termbaseTerms = store.termbaseTerms.filter((term) => term.userId !== accountId);
    persistStoreSnapshot();
    return;
  }
  const terms = await runtime.postgres.productRecords.query<{ id: string }>({
    namespace: "termbaseTerms", ownerId: accountId, limit: 500,
  });
  for (const term of terms) {
    await removeOwnedProductRecord("termbaseTerms", term.id, accountId);
  }
}

async function removeOwnedProductRecord(
  namespace: string,
  recordKey: string,
  accountId: string,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") throw new Error("PostgreSQL record removal required");
  const requestHash = repositoryRequestHash({ namespace, recordKey, accountId });
  return withPostgresRepositoryFence({ aggregateType: "account", aggregateId: accountId },
    (fence) => runtime.postgres.productRecords.remove({
      namespace,
      recordKey,
      commandId: repositoryCommandId({
        aggregateId: accountId,
        operation: `account-delete-${namespace}`,
        version: 1,
        requestHash,
      }),
      commandType: `account.delete.${namespace}`.slice(0, 100),
      requestHash,
      eventType: "account.content.erased",
      fence,
    }));
}

export type AccountDeletionProgress =
  | { status: "not_found" }
  | { status: "not_requested"; account: AccountRecord }
  | { status: "awaiting_safe_terminal"; account: AccountRecord; pendingSessionIds: string[] }
  | { status: "content_erased"; account: AccountRecord };
