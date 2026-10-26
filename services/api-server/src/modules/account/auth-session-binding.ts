import { createHash } from "node:crypto";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { getRepositoryRuntime } from "../../infrastructure/storage/repository-runtime.js";
import type { AccountRecord } from "./account-record.js";

export function authorizationSessionHash(authorization: string | undefined) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  return token ? hashToken(token) : undefined;
}

export async function authSessionHashIsActive(hash: string, userId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver === "postgres") {
    const session = await runtime.postgres.productRecords.findByLookup<{
      userId: string; expiresAt: string; revokedAt?: string;
    }>("authSessions", hash);
    if (!session || session.userId !== userId || session.revokedAt ||
        !(Date.parse(session.expiresAt) > Date.now())) return false;
    const account = await runtime.postgres.productRecords.find<AccountRecord>("accounts", userId);
    return account?.status === "active";
  }
  const store = getStoreSnapshot();
  const session = store.authSessions.find((item) => hashToken(item.token) === hash);
  return !!session && session.userId === userId && !session.revokedAt &&
    Date.parse(session.expiresAt) > Date.now() &&
    store.accounts.some((item) => item.id === userId && item.status === "active");
}

function hashToken(token: string) {
  return createHash("sha256").update(`auth-token:${token}`).digest("hex");
}
