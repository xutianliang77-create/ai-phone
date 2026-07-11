import type { SmsOtpChallengeRecord } from "./account-record.js";

const resendCooldownMs = 60 * 1000;
const dailyWindowMs = 24 * 60 * 60 * 1000;
const dailyPhoneLimit = 10;
const maxFailedLoginAttempts = 5;

export function checkSmsRequestLimit(
  challenges: SmsOtpChallengeRecord[],
  phoneHash: string,
  now: Date,
) {
  const sent = challenges.filter((item) => item.phoneHash === phoneHash);
  const latest = [...sent]
    .reverse()
    .find((item) => Number.isFinite(Date.parse(item.createdAt)));
  if (latest) {
    const elapsedMs = now.getTime() - Date.parse(latest.createdAt);
    if (elapsedMs >= 0 && elapsedMs < resendCooldownMs) {
      return {
        ok: false as const,
        code: "sms_code_resend_too_soon",
        retryAfterSeconds: Math.ceil((resendCooldownMs - elapsedMs) / 1000),
      };
    }
  }

  const windowStart = now.getTime() - dailyWindowMs;
  const recentCount = sent.filter(
    (item) => Date.parse(item.createdAt) >= windowStart,
  ).length;
  if (recentCount >= dailyPhoneLimit) {
    return { ok: false as const, code: "sms_code_daily_limit_exceeded" };
  }
  return { ok: true as const };
}

export function supersedeActivePhoneChallenges(
  challenges: SmsOtpChallengeRecord[],
  phoneHash: string,
  now: Date,
) {
  const supersededAt = now.toISOString();
  for (const challenge of challenges) {
    if (challenge.phoneHash === phoneHash && isActive(challenge, now)) {
      challenge.supersededAt = supersededAt;
    }
  }
}

export function findActiveLoginChallenge(
  challenges: SmsOtpChallengeRecord[],
  phoneHash: string,
  requesterHash: string | undefined,
  now: Date,
) {
  return [...challenges]
    .reverse()
    .find(
      (item) =>
        item.phoneHash === phoneHash &&
        isActive(item, now) &&
        requesterMatches(item, requesterHash),
    );
}

export function recordFailedLoginAttempt(
  challenge: SmsOtpChallengeRecord,
  now: Date,
) {
  challenge.failedAttempts = (challenge.failedAttempts ?? 0) + 1;
  if (challenge.failedAttempts >= maxFailedLoginAttempts) {
    challenge.lockedAt = now.toISOString();
    return { ok: false as const, code: "too_many_login_attempts" };
  }
  return { ok: false as const, code: "invalid_code" };
}

export function isLoginChallengeLocked(challenge: SmsOtpChallengeRecord) {
  return Boolean(challenge.lockedAt);
}

function isActive(challenge: SmsOtpChallengeRecord, now: Date) {
  return (
    !challenge.consumedAt &&
    !challenge.supersededAt &&
    Date.parse(challenge.expiresAt) >= now.getTime()
  );
}

function requesterMatches(
  challenge: SmsOtpChallengeRecord,
  requesterHash: string | undefined,
) {
  return (
    !challenge.requesterHash ||
    !requesterHash ||
    challenge.requesterHash === requesterHash
  );
}
