/**
 * Public 1.1 deletion policy approved for the first release.
 *
 * User content is erased as soon as any in-flight session can be safely
 * finalized. Only a pseudonymous deletion/audit and billing record remains
 * until this calendar boundary; it is not a rolling "about 90 days" value.
 */
export const publicAccountDeletionRetentionMonths = 3;

export function publicAccountDeletionRetentionUntil(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid deletion timestamp");
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + publicAccountDeletionRetentionMonths;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = month % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(now.getUTCDate(), lastDay),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds(),
  )).toISOString();
}

export function accountDeletionRetentionExpired(
  retentionUntil: string | undefined,
  now: Date,
) {
  const timestamp = retentionUntil ? Date.parse(retentionUntil) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}
