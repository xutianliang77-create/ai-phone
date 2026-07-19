import type { FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import type { AccountRecord } from "./account-record.js";
import { accountFromAuthorization, ensureTestAccount } from "./account-runtime.service.js";

export async function requireAccount(request: FastifyRequest, reply: FastifyReply) {
  const account =
    await accountFromAuthorization(request.headers.authorization) ?? await testAccount();
  if (!account) {
    sendError(reply, 401, "auth_required", "Account login required");
    return null;
  }
  return account;
}

async function testAccount() {
  const explicitlyEnabled = process.env.API_TEST_AUTO_ACCOUNT === "true";
  const vitestFallbackEnabled =
    Boolean(process.env.VITEST) &&
    process.env.API_TEST_AUTO_ACCOUNT !== "false";
  if (!explicitlyEnabled && !vitestFallbackEnabled) {
    return null;
  }
  const stored = await ensureTestAccount();
  if (stored) return stored;
  const now = new Date().toISOString();
  return {
    id: "guest-user", phoneHash: "test-phone-guest-user",
    phoneMasked: "138****0000", status: "active",
    createdAt: now, updatedAt: now, lastLoginAt: now,
  } satisfies AccountRecord;
}
