import { createHmac, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export type PublicRuntimeComponent = "asr" | "translation" | "tts";

export interface PublicRuntimeLiveQualification {
  schemaVersion: 1;
  evidenceId: string;
  deploymentId: string;
  configurationHash: string;
  modelPolicyRevision: string;
  components: PublicRuntimeComponent[];
  providers: Array<{
    component: PublicRuntimeComponent;
    providerId: string;
    modelId: string;
  }>;
  qualifiedLanguagePairs: Array<{ source: string; target: string }>;
  /** Optional for existing schema-1 evidence. An omitted value is false. */
  automaticLanguage?: boolean;
  /** May only be asserted together with automaticLanguage. */
  automaticReverse?: boolean;
  observedAt: string;
  expiresAt: string;
  sessionHash: string;
  attemptHash: string;
  finalizationHash: string;
  revokedAt?: string;
  signature: string;
}

/** A bounded collection of independently signed observations. It permits an
 * enabled ASR+MT configuration and its ASR+MT+TTS variant to coexist without
 * weakening the exact configuration binding of either entry. */
export interface PublicRuntimeLiveQualificationBundle {
  schemaVersion: 2;
  qualifications: PublicRuntimeLiveQualification[];
}

export interface PublicRuntimeLiveQualificationExpectation {
  deploymentId: string;
  configurationHash: string;
  modelPolicyRevision: string;
  components: readonly PublicRuntimeComponent[];
}

export type PublicRuntimeLiveQualificationResult =
  | {
    status: "ready";
    evidence: Pick<PublicRuntimeLiveQualification,
      "evidenceId" | "components" | "providers" | "qualifiedLanguagePairs" |
      "automaticLanguage" | "automaticReverse" |
      "observedAt" | "expiresAt">;
  }
  | { status: "not_ready"; issue: string };

const components = new Set<PublicRuntimeComponent>(["asr", "translation", "tts"]);
const fields = [
  "schemaVersion", "evidenceId", "deploymentId", "configurationHash",
  "modelPolicyRevision", "components", "providers", "qualifiedLanguagePairs",
  "automaticLanguage", "automaticReverse",
  "observedAt", "expiresAt", "sessionHash", "attemptHash", "finalizationHash",
  "revokedAt", "signature",
];
const bundleFields = ["schemaVersion", "qualifications"];
const safeKey = (value: unknown) => typeof value === "string" &&
  /^[A-Za-z0-9._:-]{1,240}$/.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const key = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const language = (value: unknown) => typeof value === "string" && /^[a-z]{2,3}(?:-Hant)?$/.test(value);

/** Operator-side signing only. The HMAC key is never sent to a client. */
export function signPublicRuntimeLiveQualification(
  value: Omit<PublicRuntimeLiveQualification, "signature">,
  signingKey: string,
) {
  if (!key(signingKey)) throw Error("public_runtime_live_qualification_key_invalid");
  return createHmac("sha256", signingKey)
    .update(canonicalJson(value))
    .digest("hex");
}

/** Reads an independently signed, time-bounded observation without opening a
 * network connection or reading public model credentials. */
export function inspectPublicRuntimeLiveQualification(input: {
  file: string | undefined;
  signingKey: string | undefined;
  expectation: PublicRuntimeLiveQualificationExpectation;
  now?: Date;
}): PublicRuntimeLiveQualificationResult {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || !isAbsolute(input.file ?? "") || !key(input.signingKey)) {
    return { status: "not_ready", issue: "public_runtime_live_qualification_not_configured" };
  }
  let raw: string;
  try {
    const info = lstatSync(input.file!);
    if (!info.isFile() || info.size < 2 || info.size > 65_536) throw Error();
    raw = readFileSync(input.file!, "utf8");
  } catch {
    return { status: "not_ready", issue: "public_runtime_live_qualification_unavailable" };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { status: "not_ready", issue: "public_runtime_live_qualification_invalid" };
  }
  const qualifications = qualificationsFrom(value);
  if (!qualifications) return { status: "not_ready", issue: "public_runtime_live_qualification_invalid" };
  for (const evidence of qualifications) {
    const invalid = validate(evidence, now);
    if (invalid) return { status: "not_ready", issue: invalid };
    const expected = signPublicRuntimeLiveQualification(withoutSignature(evidence), input.signingKey!);
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(evidence.signature))) {
      return { status: "not_ready", issue: "public_runtime_live_qualification_signature_invalid" };
    }
  }
  const matches = qualifications.filter((evidence) =>
    evidence.deploymentId === input.expectation.deploymentId &&
    evidence.configurationHash === input.expectation.configurationHash &&
    evidence.modelPolicyRevision === input.expectation.modelPolicyRevision &&
    sameComponents(evidence.components, input.expectation.components));
  if (matches.length !== 1) {
    return { status: "not_ready", issue: "public_runtime_live_qualification_scope_mismatch" };
  }
  const evidence = matches[0]!;
  return {
    status: "ready",
    evidence: {
      evidenceId: evidence.evidenceId,
      components: [...evidence.components],
      providers: evidence.providers.map((provider) => ({ ...provider })),
      qualifiedLanguagePairs: evidence.qualifiedLanguagePairs.map((pair) => ({ ...pair })),
      ...(evidence.automaticLanguage === true ? { automaticLanguage: true } : {}),
      ...(evidence.automaticReverse === true ? { automaticReverse: true } : {}),
      observedAt: evidence.observedAt,
      expiresAt: evidence.expiresAt,
    },
  };
}

function qualificationsFrom(value: unknown): PublicRuntimeLiveQualification[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if ((value as { schemaVersion?: unknown }).schemaVersion === 1) {
    return [value as PublicRuntimeLiveQualification];
  }
  const bundle = value as Partial<PublicRuntimeLiveQualificationBundle>;
  if (bundle.schemaVersion !== 2 || Object.keys(bundle).some((field) => !bundleFields.includes(field)) ||
      !Array.isArray(bundle.qualifications) || bundle.qualifications.length < 1 || bundle.qualifications.length > 8) {
    return undefined;
  }
  const identities = bundle.qualifications.map((evidence) => evidence && typeof evidence === "object"
    ? `${(evidence as PublicRuntimeLiveQualification).deploymentId}\u0000${(evidence as PublicRuntimeLiveQualification).configurationHash}` : "");
  if (identities.some((identity) => identity.length === 0) || new Set(identities).size !== identities.length) return undefined;
  return bundle.qualifications as PublicRuntimeLiveQualification[];
}

function validate(evidence: PublicRuntimeLiveQualification, now: Date) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) ||
      Object.keys(evidence).some((field) => !fields.includes(field)) ||
      evidence.schemaVersion !== 1 || ![evidence.evidenceId, evidence.deploymentId,
        evidence.modelPolicyRevision].every(safeKey) || !hash(evidence.configurationHash) ||
      !hash(evidence.sessionHash) || !hash(evidence.attemptHash) ||
      !hash(evidence.finalizationHash) || !hash(evidence.signature) ||
      (evidence.automaticLanguage !== undefined && typeof evidence.automaticLanguage !== "boolean") ||
      (evidence.automaticReverse !== undefined && typeof evidence.automaticReverse !== "boolean") ||
      (evidence.automaticReverse === true && evidence.automaticLanguage !== true) ||
      !time(evidence.observedAt) || !time(evidence.expiresAt) ||
      !Array.isArray(evidence.components) || !sameComponents(evidence.components, evidence.components) ||
      evidence.components.length < 2 || !evidence.components.includes("asr") ||
      !evidence.components.includes("translation") || !Array.isArray(evidence.providers) ||
      evidence.providers.length !== evidence.components.length || !Array.isArray(evidence.qualifiedLanguagePairs) ||
      evidence.qualifiedLanguagePairs.length < 1) {
    return "public_runtime_live_qualification_invalid";
  }
  if (new Set(evidence.providers.map((provider) => provider?.component)).size !== evidence.components.length ||
      evidence.providers.some((provider) => !provider || typeof provider !== "object" || Array.isArray(provider) ||
        Object.keys(provider).some((field) => !["component", "providerId", "modelId"].includes(field)) ||
        !components.has(provider.component) || !evidence.components.includes(provider.component) ||
        !safeKey(provider.providerId) || !safeKey(provider.modelId)) ||
      new Set(evidence.qualifiedLanguagePairs.map((pair) => pair && `${pair.source}\u0000${pair.target}`)).size !== evidence.qualifiedLanguagePairs.length ||
      evidence.qualifiedLanguagePairs.some((pair) => !pair || typeof pair !== "object" || Array.isArray(pair) ||
        Object.keys(pair).some((field) => !["source", "target"].includes(field)) || !language(pair.source) ||
        !language(pair.target) || pair.source === "auto" || pair.source === pair.target)) {
    return "public_runtime_live_qualification_invalid";
  }
  const observed = Date.parse(evidence.observedAt), expires = Date.parse(evidence.expiresAt);
  if (observed > now.getTime() || expires <= now.getTime() || expires - observed > 86_400_000) {
    return "public_runtime_live_qualification_expired";
  }
  if (evidence.revokedAt !== undefined) {
    return time(evidence.revokedAt)
      ? "public_runtime_live_qualification_revoked"
      : "public_runtime_live_qualification_invalid";
  }
  return undefined;
}

function sameComponents(actual: unknown, expected: unknown) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length ||
      new Set(actual).size !== actual.length || actual.some((component) => !components.has(component))) {
    return false;
  }
  return actual.every((component) => expected.includes(component));
}

function withoutSignature(evidence: PublicRuntimeLiveQualification) {
  const { signature: _signature, ...value } = evidence;
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
