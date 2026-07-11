import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import { getUsageBalance } from "../usage/usage.service.js";
import type { AccountRecord, AuthSessionRecord } from "./account-record.js";
import { listAccountConsents } from "./account-consent.service.js";
import {
  checkSmsRequestLimit,
  findActiveLoginChallenge,
  isLoginChallengeLocked,
  recordFailedLoginAttempt,
  supersedeActivePhoneChallenges,
} from "./sms-otp-limits.js";
import { sendPhoneLoginCode, shouldExposeDebugCode } from "./sms-provider.js";

const otpTtlMs = 5 * 60 * 1000;
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;

export async function requestPhoneLoginCode(
  phoneInput: string,
  options: { now?: Date; clientKey?: string } = {},
) {
  const now = options.now ?? new Date();
  const phone = normalizePhone(phoneInput);
  if (!phone) return { ok: false as const, code: "invalid_phone" };

  const store = getStoreSnapshot();
  const phoneHash = hashPhone(phone);
  const limited = checkSmsRequestLimit(store.smsOtpChallenges, phoneHash, now);
  if (!limited.ok) return limited;

  const code = randomInt(100000, 1000000).toString();
  const expiresAt = new Date(now.getTime() + otpTtlMs).toISOString();
  const delivery = await sendPhoneLoginCode({
    phone,
    phoneMasked: maskPhone(phone),
    code,
    expiresInSeconds: otpTtlMs / 1000,
  });
  if (!delivery.ok) return delivery;
  supersedeActivePhoneChallenges(store.smsOtpChallenges, phoneHash, now);
  const challenge = {
    id: randomUUID(),
    phoneHash,
    phoneMasked: maskPhone(phone),
    codeHash: hashCode(phone, code),
    createdAt: now.toISOString(),
    expiresAt,
    deliveryProvider: delivery.delivery.provider,
    deliveryId: delivery.delivery.messageId,
    requesterHash: hashClientKey(options.clientKey),
    failedAttempts: 0,
  };
  store.smsOtpChallenges = [...store.smsOtpChallenges, challenge];
  persistStoreSnapshot();

  return {
    ok: true as const,
    challengeId: challenge.id,
    phoneMasked: challenge.phoneMasked,
    expiresAt: challenge.expiresAt,
    debugCode: shouldExposeDebugCode() ? code : undefined,
  };
}

export function loginWithPhoneCode(
  phoneInput: string,
  codeInput: string,
  options: { now?: Date; clientKey?: string } = {},
) {
  const now = options.now ?? new Date();
  const phone = normalizePhone(phoneInput);
  const code = normalizeCode(codeInput);
  if (!phone) return { ok: false as const, code: "invalid_phone" };
  if (!code) return { ok: false as const, code: "invalid_code" };

  if (configuredTestLoginMatches(phone, code)) {
    const account = upsertAccount(phone, now);
    if (account.status !== "active") {
      persistStoreSnapshot();
      return { ok: false as const, code: "account_unavailable" };
    }
    const session = createAuthSession(account.id, now);
    persistStoreSnapshot();

    return {
      ok: true as const,
      token: session.token,
      expiresAt: session.expiresAt,
      account: toAccountDto(account),
    };
  }

  const store = getStoreSnapshot();
  const phoneHash = hashPhone(phone);
  const requesterHash = hashClientKey(options.clientKey);
  const codeHash = hashCode(phone, code);
  const challenge = findActiveLoginChallenge(
    store.smsOtpChallenges,
    phoneHash,
    requesterHash,
    now,
  );
  if (!challenge) return { ok: false as const, code: "invalid_code" };
  if (isLoginChallengeLocked(challenge)) {
    return { ok: false as const, code: "too_many_login_attempts" };
  }
  if (challenge.codeHash !== codeHash) {
    const failed = recordFailedLoginAttempt(challenge, now);
    persistStoreSnapshot();
    return failed;
  }
  challenge.consumedAt = now.toISOString();

  const account = upsertAccount(phone, now);
  if (account.status !== "active") {
    persistStoreSnapshot();
    return { ok: false as const, code: "account_unavailable" };
  }
  const session = createAuthSession(account.id, now);
  persistStoreSnapshot();

  return {
    ok: true as const,
    token: session.token,
    expiresAt: session.expiresAt,
    account: toAccountDto(account),
  };
}

export function accountFromAuthorization(authorization: string | undefined) {
  const token = parseBearerToken(authorization);
  if (!token) return null;
  const store = getStoreSnapshot();
  const session = store.authSessions.find((item) => item.token === token);
  if (
    !session ||
    session.revokedAt ||
    Date.parse(session.expiresAt) < Date.now()
  ) {
    return null;
  }
  const account = store.accounts.find((item) => item.id === session.userId);
  if (!account || account.status !== "active") return null;
  return account;
}

export function logout(authorization: string | undefined) {
  const token = parseBearerToken(authorization);
  if (!token) return false;
  const session = getStoreSnapshot().authSessions.find(
    (item) => item.token === token && !item.revokedAt,
  );
  if (!session) return false;
  session.revokedAt = new Date().toISOString();
  persistStoreSnapshot();
  return true;
}

export function exportAccountData(account: AccountRecord) {
  const store = getStoreSnapshot();
  return {
    exportedAt: new Date().toISOString(),
    account: toAccountDto(account),
    usage: getUsageBalance(account.id),
    sessions: store.sessions
      .filter((session) => session.userId === account.id)
      .map((session) => ({
        id: session.id,
        mode: session.mode,
        status: session.status,
        consumedSeconds: session.consumedSeconds,
        createdAt: session.createdAt,
        endedAt: session.endedAt,
        segmentCount: session.segments.length,
      })),
    billingLedger: store.billingLedger.filter(
      (entry) => entry.userId === account.id,
    ),
    termbaseTerms: store.termbaseTerms.filter(
      (term) => term.userId === account.id,
    ),
    consents: listAccountConsents(account),
    agentCalls: store.agentCallDrafts
      .filter((draft) => draft.userId === account.id)
      .map((draft) => ({
        id: draft.id,
        scenario: draft.scenario,
        status: draft.status,
        riskLevel: draft.riskLevel,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      })),
    voiceProfiles: store.voiceProfiles
      .filter((profile) => profile.userId === account.id)
      .map((profile) => ({
        id: profile.id,
        displayName: profile.displayName,
        status: profile.status,
        voiceMode: profile.voiceMode,
        consentVersion: profile.consentVersion,
        consentAcceptedAt: profile.consentAcceptedAt,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        deletedAt: profile.deletedAt,
      })),
  };
}

export function requestAccountDeletion(account: AccountRecord) {
  const now = new Date().toISOString();
  account.status = "deletion_requested";
  account.deletionRequestedAt = now;
  account.updatedAt = now;
  for (const session of getStoreSnapshot().authSessions) {
    if (session.userId === account.id && !session.revokedAt) {
      session.revokedAt = now;
    }
  }
  persistStoreSnapshot();
  return toAccountDto(account);
}

export function toAccountDto(account: AccountRecord) {
  return {
    id: account.id,
    phoneMasked: account.phoneMasked,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastLoginAt: account.lastLoginAt,
    deletionRequestedAt: account.deletionRequestedAt,
  };
}

function upsertAccount(phone: string, now: Date) {
  const store = getStoreSnapshot();
  const phoneHash = hashPhone(phone);
  const existing = store.accounts.find(
    (account) => account.phoneHash === phoneHash,
  );
  if (existing) {
    existing.lastLoginAt = now.toISOString();
    existing.updatedAt = now.toISOString();
    return existing;
  }
  const account: AccountRecord = {
    id: `user_${randomUUID()}`,
    phoneHash,
    phoneMasked: maskPhone(phone),
    status: "active",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lastLoginAt: now.toISOString(),
  };
  store.accounts = [...store.accounts, account];
  return account;
}

function createAuthSession(userId: string, now: Date): AuthSessionRecord {
  const session = {
    token: `acct_${randomBytes(24).toString("base64url")}`,
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionTtlMs).toISOString(),
  };
  const store = getStoreSnapshot();
  store.authSessions = [...store.authSessions, session];
  return session;
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
  const configuredPhone = normalizePhone(process.env.AUTH_TEST_PHONE ?? "");
  const configuredCode = normalizeCode(process.env.AUTH_TEST_CODE ?? "");
  return Boolean(
    configuredPhone &&
      configuredCode &&
      phone === configuredPhone &&
      code === configuredCode,
  );
}

function maskPhone(phone: string) {
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}

function hashPhone(phone: string) {
  return createHash("sha256").update(`phone:${phone}`).digest("hex");
}

function hashCode(phone: string, code: string) {
  const secret = process.env.AUTH_OTP_SECRET ?? "local-dev-otp-secret";
  return createHash("sha256")
    .update(`${secret}:${hashPhone(phone)}:${code}`)
    .digest("hex");
}

function hashClientKey(value: string | undefined) {
  const key = value?.trim();
  if (!key) return undefined;
  return createHash("sha256").update(`client:${key}`).digest("hex");
}

function parseBearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
