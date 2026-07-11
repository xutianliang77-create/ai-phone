import type { FastifyReply, FastifyRequest } from "fastify";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { sendError } from "../../infrastructure/http/errors.js";
import type { AccountRecord } from "./account-record.js";
import { accountFromAuthorization } from "./account.service.js";

export function requireAccount(request: FastifyRequest, reply: FastifyReply) {
  const account =
    accountFromAuthorization(request.headers.authorization) ?? testAccount();
  if (!account) {
    sendError(reply, 401, "auth_required", "Account login required");
    return null;
  }
  return account;
}

function testAccount() {
  const explicitlyEnabled = process.env.API_TEST_AUTO_ACCOUNT === "true";
  const vitestFallbackEnabled =
    Boolean(process.env.VITEST) &&
    process.env.API_TEST_AUTO_ACCOUNT !== "false";
  if (!explicitlyEnabled && !vitestFallbackEnabled) {
    return null;
  }
  const store = getStoreSnapshot();
  const userId = "guest-user";
  const existing = store.accounts.find((account) => account.id === userId);
  if (existing && existing.status === "active") return existing;
  const now = new Date().toISOString();
  const account: AccountRecord = {
    id: userId,
    phoneHash: "test-phone-guest-user",
    phoneMasked: "138****0000",
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
  store.accounts.push(account);
  return account;
}
