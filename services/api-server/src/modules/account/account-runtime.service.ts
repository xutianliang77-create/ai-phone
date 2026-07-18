import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { stableDomainId } from
  "../../infrastructure/storage/postgres-domain-record-uow.js";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type {
  AccountRecord,
  SmsOtpChallengeRecord,
} from "./account-record.js";
import {
  checkSmsRequestLimit,
  findActiveLoginChallenge,
  isLoginChallengeLocked,
} from "./sms-otp-limits.js";
import { sendPhoneLoginCode, shouldExposeDebugCode } from "./sms-provider.js";
import * as legacy from "./account.service.js";

const otpTtlMs = 5 * 60 * 1_000;
const sessionTtlMs = 30 * 24 * 60 * 60 * 1_000;

interface AuthSessionPrimary {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export async function requestPhoneLoginCode(
  phoneInput: string,
  options: { now?: Date; clientKey?: string } = {},
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.requestPhoneLoginCode(phoneInput, options);
  const now = options.now ?? new Date();
  const phone = normalizePhone(phoneInput);
  if (!phone) return { ok: false as const, code: "invalid_phone" };
  const phoneHash = hashPhone(phone);
  const challenges = await runtime.postgres.productRecords
    .query<SmsOtpChallengeRecord>({
      namespace: "smsOtpChallenges", ownerId: phoneHash, limit: 500,
    });
  const limited = checkSmsRequestLimit([...challenges].reverse(), phoneHash, now);
  if (!limited.ok) return limited;
  const code = randomInt(100000, 1000000).toString();
  const delivery = await sendPhoneLoginCode({
    phone,
    phoneMasked: maskPhone(phone),
    code,
    expiresInSeconds: otpTtlMs / 1_000,
  });
  if (!delivery.ok) return delivery;
  await supersedeChallenges(phoneHash, challenges, now);
  const challenge: SmsOtpChallengeRecord = {
    id: randomUUID(),
    phoneHash,
    phoneMasked: maskPhone(phone),
    codeHash: hashCode(phone, code),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + otpTtlMs).toISOString(),
    deliveryProvider: delivery.delivery.provider,
    deliveryId: delivery.delivery.messageId,
    requesterHash: hashClientKey(options.clientKey),
    failedAttempts: 0,
  };
  await mutateProduct("smsOtpChallenges", challenge.id, "sms_challenge", phoneHash,
    "create", challenge, (current) => current ?? challenge);
  return {
    ok: true as const,
    challengeId: challenge.id,
    phoneMasked: challenge.phoneMasked,
    expiresAt: challenge.expiresAt,
    debugCode: shouldExposeDebugCode() ? code : undefined,
  };
}

export async function loginWithPhoneCode(
  phoneInput: string,
  codeInput: string,
  options: { now?: Date; clientKey?: string } = {},
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.loginWithPhoneCode(
    phoneInput, codeInput, options,
  );
  const now = options.now ?? new Date();
  const phone = normalizePhone(phoneInput);
  const code = normalizeCode(codeInput);
  if (!phone) return { ok: false as const, code: "invalid_phone" };
  if (!code) return { ok: false as const, code: "invalid_code" };
  if (!configuredTestLoginMatches(phone, code)) {
    const phoneHash = hashPhone(phone);
    const challenges = await runtime.postgres.productRecords
      .query<SmsOtpChallengeRecord>({
        namespace: "smsOtpChallenges", ownerId: phoneHash, limit: 500,
      });
    const challenge = findActiveLoginChallenge(
      [...challenges].reverse(),
      phoneHash,
      hashClientKey(options.clientKey),
      now,
    );
    if (!challenge) return { ok: false as const, code: "invalid_code" };
    if (isLoginChallengeLocked(challenge)) {
      return { ok: false as const, code: "too_many_login_attempts" };
    }
    if (challenge.codeHash !== hashCode(phone, code)) {
      const failedAttempts = (challenge.failedAttempts ?? 0) + 1;
      await mutateProduct("smsOtpChallenges", challenge.id, "sms_challenge",
        phoneHash, "attempt", { failedAttempts }, (current) => current ? {
          ...current,
          failedAttempts,
          ...(failedAttempts >= 5 ? { lockedAt: now.toISOString() } : {}),
        } : null);
      return { ok: false as const,
        code: failedAttempts >= 5 ? "too_many_login_attempts" : "invalid_code" };
    }
    await mutateProduct("smsOtpChallenges", challenge.id, "sms_challenge",
      phoneHash, "consume", {}, (current) => current ? {
        ...current, consumedAt: now.toISOString(),
      } : null);
  }
  const account = await upsertAccount(phone, now);
  if (account.status !== "active") {
    return { ok: false as const, code: "account_unavailable" };
  }
  const session = await createAuthSession(account.id, now);
  return {
    ok: true as const,
    token: session.token,
    expiresAt: session.expiresAt,
    account: toAccountDto(account),
  };
}

export async function accountFromAuthorization(authorization: string | undefined) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.accountFromAuthorization(authorization);
  const token = parseBearerToken(authorization);
  if (!token) return null;
  const session = await runtime.postgres.productRecords.findByLookup<AuthSessionPrimary>(
    "authSessions", tokenHash(token),
  );
  if (!session || session.revokedAt || Date.parse(session.expiresAt) < Date.now()) return null;
  const account = await runtime.postgres.productRecords.find<AccountRecord>(
    "accounts", session.userId,
  );
  return account?.status === "active" ? account : null;
}

export async function logout(authorization: string | undefined) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.logout(authorization);
  const token = parseBearerToken(authorization);
  if (!token) return false;
  const hash = tokenHash(token);
  const session = await runtime.postgres.productRecords.findByLookup<AuthSessionPrimary>(
    "authSessions", hash,
  );
  if (!session || session.revokedAt) return false;
  const result = await mutateProduct("authSessions", hash, "auth_session", hash,
    "revoke", {}, (current: AuthSessionPrimary | null) => current ? {
      ...current, revokedAt: new Date().toISOString(),
    } : null);
  return Boolean(result.record);
}

export async function requestAccountDeletion(account: AccountRecord) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.requestAccountDeletion(account);
  const now = new Date().toISOString();
  const result = await mutateProduct("accounts", account.id, "account", account.id,
    "delete-request", {}, (current: AccountRecord | null) => current ? {
      ...current, status: "deletion_requested" as const,
      deletionRequestedAt: now, updatedAt: now,
    } : null);
  const sessions = await runtime.postgres.productRecords.query<AuthSessionPrimary>({
    namespace: "authSessions", ownerId: account.id, status: "active", limit: 500,
  });
  for (const session of sessions) {
    await mutateProduct("authSessions", session.tokenHash, "auth_session",
      session.tokenHash, "revoke", {}, (current: AuthSessionPrimary | null) =>
        current ? { ...current, revokedAt: now } : null);
  }
  return toAccountDto((result.record as AccountRecord | null) ?? account);
}

export async function ensureTestAccount() {
  const now = new Date();
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.accountFromAuthorization(undefined);
  }
  const account: AccountRecord = {
    id: "guest-user", phoneHash: "test-phone-guest-user",
    phoneMasked: "138****0000", status: "active",
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
    lastLoginAt: now.toISOString(),
  };
  const result = await mutateProduct("accounts", account.id, "account", account.id,
    "test-upsert", {}, (current: AccountRecord | null) => current ?? account);
  return result.record as AccountRecord | null;
}

export const toAccountDto = legacy.toAccountDto;

async function upsertAccount(phone: string, now: Date) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") throw new Error("PostgreSQL account required");
  const phoneHash = hashPhone(phone);
  const existing = await runtime.postgres.productRecords.findByLookup<AccountRecord>(
    "accounts", phoneHash,
  );
  const id = existing?.id ?? stableDomainId("user", phoneHash);
  const result = await mutateProduct("accounts", id, "account", id, "login", {},
    (current: AccountRecord | null) => current ? {
      ...current, lastLoginAt: now.toISOString(), updatedAt: now.toISOString(),
    } : {
      id, phoneHash, phoneMasked: maskPhone(phone), status: "active" as const,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
      lastLoginAt: now.toISOString(),
    });
  if (!result.record) throw new Error("Account could not be stored");
  return result.record as AccountRecord;
}

async function createAuthSession(userId: string, now: Date) {
  const token = `acct_${randomBytes(24).toString("base64url")}`;
  const hash = tokenHash(token);
  const session: AuthSessionPrimary = {
    tokenHash: hash,
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionTtlMs).toISOString(),
  };
  await mutateProduct("authSessions", hash, "auth_session", hash,
    "create", session, (current) => current ?? session);
  return { token, expiresAt: session.expiresAt };
}

async function supersedeChallenges(
  phoneHash: string,
  challenges: SmsOtpChallengeRecord[],
  now: Date,
) {
  for (const challenge of challenges.filter((item) =>
    !item.consumedAt && !item.supersededAt && Date.parse(item.expiresAt) >= now.getTime())) {
    await mutateProduct("smsOtpChallenges", challenge.id, "sms_challenge", phoneHash,
      "supersede", {}, (current: SmsOtpChallengeRecord | null) => current ? {
        ...current, supersededAt: now.toISOString(),
      } : null);
  }
}

async function mutateProduct<T>(
  namespace: string,
  recordKey: string,
  aggregateType: string,
  aggregateId: string,
  operation: string,
  payload: unknown,
  mutate: (current: T | null) => T | null,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") throw new Error("PostgreSQL product record required");
  const requestHash = repositoryRequestHash({ recordKey, operation, payload });
  return withPostgresRepositoryFence({ aggregateType, aggregateId },
    (fence) => runtime.postgres.productRecords.mutate<T>({
      namespace, recordKey,
      commandId: repositoryCommandId({ aggregateId,
        operation: `${namespace}-${operation}`, version: 1, requestHash }),
      commandType: `${namespace}.${operation}`, requestHash,
      eventType: `${namespace}.${operation}`, fence, mutate,
    }));
}

function normalizePhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  const withoutCountry = digits.startsWith("+86") ? digits.slice(3) : digits;
  return /^1[3-9]\d{9}$/.test(withoutCountry) ? withoutCountry : null;
}
function normalizeCode(value: string) {
  const code = value.trim();
  return /^\d{6}$/.test(code) ? code : null;
}
function configuredTestLoginMatches(phone: string, code: string) {
  if (process.env.NODE_ENV === "production") return false;
  return normalizePhone(process.env.AUTH_TEST_PHONE ?? "") === phone &&
    normalizeCode(process.env.AUTH_TEST_CODE ?? "") === code;
}
function maskPhone(phone: string) { return `${phone.slice(0, 3)}****${phone.slice(7)}`; }
function hashPhone(phone: string) {
  return createHash("sha256").update(`phone:${phone}`).digest("hex");
}
function hashCode(phone: string, code: string) {
  const secret = process.env.AUTH_OTP_SECRET ?? "local-dev-otp-secret";
  return createHash("sha256").update(`${secret}:${hashPhone(phone)}:${code}`).digest("hex");
}
function hashClientKey(value: string | undefined) {
  return value?.trim()
    ? createHash("sha256").update(`client:${value.trim()}`).digest("hex") : undefined;
}
function tokenHash(token: string) {
  return createHash("sha256").update(`auth-token:${token}`).digest("hex");
}
function parseBearerToken(authorization: string | undefined) {
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim() || null : null;
}
