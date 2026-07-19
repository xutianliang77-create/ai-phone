import { createHash } from "node:crypto";
import type {
  EnterpriseCountryPolicyDto,
  EnterpriseCountryPolicyReadinessIssue,
  EnterpriseCountryPolicyVoicemail,
  PublishEnterpriseCountryPolicyRequest,
} from "@translation/contracts";

export interface EnterpriseCountryPolicyRecord extends
  Omit<PublishEnterpriseCountryPolicyRequest, "tenantId"> {
  id: string;
  tenantId: string;
  contentHash: string;
  publishedBy: string;
  publishedAt: string;
  creationRequestHash: string;
  version: number;
}

export type PreparedEnterpriseCountryPolicy = Omit<
  PublishEnterpriseCountryPolicyRequest,
  "tenantId"
>;

export function prepareEnterpriseCountryPolicy(
  input: Omit<PublishEnterpriseCountryPolicyRequest, "tenantId">,
  publishedAt: string,
): PreparedEnterpriseCountryPolicy {
  const countryCode = input.countryCode.trim().toUpperCase();
  const policyVersion = key(input.policyVersion, "policy version");
  const effectiveFrom = iso(input.effectiveFrom, "effective from");
  const expiresAt = iso(input.expiresAt, "expires at");
  const publication = iso(publishedAt, "published at");
  if (!/^[A-Z]{2}$/.test(countryCode) || effectiveFrom < publication - 300_000 ||
    expiresAt <= effectiveFrom) throw new Error("Invalid country policy window");
  const callingWindows = prepareWindows(input.callingWindows);
  const maxAttempts = integer(input.maxAttempts, 1, 20, "max attempts");
  const frequencyWindowHours = integer(input.frequencyWindowHours, 1, 720,
    "frequency window");
  const minRetryIntervalMinutes = integer(input.minRetryIntervalMinutes, 1,
    10_080, "retry interval");
  const disclosure = {
    version: key(input.disclosure.version, "disclosure version"),
    brand: text(input.disclosure.brand, 500, "brand disclosure"),
    aiIdentity: text(input.disclosure.aiIdentity, 500, "AI disclosure"),
    marketingPurpose: text(input.disclosure.marketingPurpose, 500,
      "purpose disclosure"),
  };
  const voicemail = prepareVoicemail(input.voicemail);
  return { countryCode, policyVersion, callingWindows, maxAttempts,
    frequencyWindowHours, minRetryIntervalMinutes, disclosure, voicemail,
    complianceReference: text(input.complianceReference, 500,
      "compliance reference"),
    effectiveFrom: new Date(effectiveFrom).toISOString(),
    expiresAt: new Date(expiresAt).toISOString() };
}

export function countryPolicyContentHash(policy: PreparedEnterpriseCountryPolicy) {
  return sha256(stableJson(policy));
}

export function countryPolicyCreationHash(input: {
  actorUserId: string;
  policy: PreparedEnterpriseCountryPolicy;
}) {
  return sha256(stableJson(input));
}

export function enterpriseCountryPolicyDto(
  record: EnterpriseCountryPolicyRecord,
  evaluatedAt: string,
): EnterpriseCountryPolicyDto {
  return { id: record.id, countryCode: record.countryCode,
    policyVersion: record.policyVersion, callingWindows: record.callingWindows,
    maxAttempts: record.maxAttempts,
    frequencyWindowHours: record.frequencyWindowHours,
    minRetryIntervalMinutes: record.minRetryIntervalMinutes,
    disclosure: record.disclosure, voicemail: record.voicemail,
    complianceReference: record.complianceReference,
    effectiveFrom: record.effectiveFrom, expiresAt: record.expiresAt,
    lifecycleStatus: countryPolicyLifecycle(record, evaluatedAt),
    contentHash: record.contentHash, publishedBy: record.publishedBy,
    publishedAt: record.publishedAt, version: record.version };
}

export function countryPolicyLifecycle(record: EnterpriseCountryPolicyRecord,
  evaluatedAt: string): EnterpriseCountryPolicyDto["lifecycleStatus"] {
  const at = iso(evaluatedAt, "evaluation time");
  if (at < Date.parse(record.effectiveFrom)) return "not_yet_effective";
  return at >= Date.parse(record.expiresAt) ? "expired" : "active";
}

export function resolveEnterpriseCountryPolicyReadiness(input: {
  policies: EnterpriseCountryPolicyRecord[];
  countryCodes: string[];
  targetAt: string;
}) {
  const target = iso(input.targetAt, "target time");
  const policies: EnterpriseCountryPolicyRecord[] = [];
  const issues: EnterpriseCountryPolicyReadinessIssue[] = [];
  for (const countryCode of input.countryCodes) {
    const versions = input.policies.filter((policy) =>
      policy.countryCode === countryCode);
    const active = versions.find((policy) => Date.parse(policy.effectiveFrom) <= target &&
      Date.parse(policy.expiresAt) > target);
    if (active) { policies.push(active); continue; }
    const reasonCode = versions.some((policy) => Date.parse(policy.effectiveFrom) > target)
      ? "country_policy_not_yet_effective" as const
      : versions.length > 0 ? "country_policy_expired" as const
        : "country_policy_missing" as const;
    issues.push({ countryCode, reasonCode });
  }
  return { status: issues.length === 0 ? "ready" as const : "blocked" as const,
    policies, issues };
}

function prepareWindows(value: PublishEnterpriseCountryPolicyRequest["callingWindows"]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 28) {
    throw new Error("Country policy requires 1 to 28 calling windows");
  }
  const windows = value.map((window) => ({
    weekday: integer(window.weekday, 1, 7, "weekday"),
    startMinute: integer(window.startMinute, 0, 1_439, "start minute"),
    endMinute: integer(window.endMinute, 1, 1_440, "end minute"),
  })).sort((left, right) => left.weekday - right.weekday ||
    left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  if (windows.some((window) => window.endMinute <= window.startMinute)) {
    throw new Error("Country policy calling window cannot cross midnight");
  }
  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1]!; const current = windows[index]!;
    if (previous.weekday === current.weekday &&
      current.startMinute < previous.endMinute) {
      throw new Error("Country policy calling windows overlap");
    }
  }
  return windows;
}

function prepareVoicemail(value: EnterpriseCountryPolicyVoicemail) {
  if (!value || !["disabled", "compliant_message", "human_only"]
    .includes(value.mode)) throw new Error("Invalid voicemail mode");
  if (value.mode !== "compliant_message") {
    if (value.version !== undefined || value.message !== undefined) {
      throw new Error("Voicemail content is forbidden for this mode");
    }
    return { mode: value.mode };
  }
  return { mode: value.mode, version: key(value.version, "voicemail version"),
    message: text(value.message, 1_000, "voicemail message") };
}
function integer(value: unknown, min: number, max: number, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`Invalid country policy ${field}`);
  }
  return Number(value);
}
function key(value: unknown, field: string) {
  if (typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`Invalid country policy ${field}`);
  }
  return value;
}
function text(value: unknown, max: number, field: string) {
  if (typeof value !== "string" || value !== value.trim() ||
    Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > max) {
    throw new Error(`Invalid country policy ${field}`);
  }
  return value;
}
function iso(value: unknown, field: string) {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`Invalid country policy ${field}`);
  }
  return timestamp;
}
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as
    Record<string, unknown>).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
