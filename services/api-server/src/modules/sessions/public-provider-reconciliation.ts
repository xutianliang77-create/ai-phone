import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionRecord } from "./session-record.js";
import { assertPublicSession, mutatePublicSession, publicDeploymentId } from "./session-result-sync.service.js";
import { canonicalSyncJson, ResultSyncError, resultSyncHash, syncKey } from "./session-result-sync-contract.js";

type Component = "asr" | "translation" | "tts";
type EvidenceScope = "attempt" | "isolated_candidate_day";

export interface PublicProviderReconciliationEvidence {
  schemaVersion: 1;
  reconciliationId: string;
  sessionId: string;
  ownerId: string;
  deploymentId: string;
  providerId: string;
  evidenceScope: EvidenceScope;
  providerUsageCount: number;
  providerUsageSeconds: number;
  providerEvidenceHash: string;
  providerRequestIdHash?: string;
  observedAt: string;
  attempts: Array<{ attemptId: string; component: Component; modelId: string }>;
  signature: string;
}

export interface PublicProviderReconciliationRecord {
  reconciliationId: string;
  evidenceHash: string;
  providerId: string;
  evidenceScope: EvidenceScope;
  providerUsageCount: number;
  providerUsageSeconds: number;
  providerEvidenceHash: string;
  providerRequestIdHash?: string;
  observedAt: string;
  reconciledAt: string;
  uncertainAttemptIds: string[];
}

const fields = [
  "schemaVersion", "reconciliationId", "sessionId", "ownerId", "deploymentId",
  "providerId", "evidenceScope", "providerUsageCount", "providerUsageSeconds",
  "providerEvidenceHash", "providerRequestIdHash", "observedAt", "attempts", "signature",
];
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const key = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,240}$/.test(value);
const enabled = () => process.env.PUBLIC_RUNTIME_RECONCILIATION_ENABLED === "true";

/** Signs a server-operator reconciliation receipt. The distinct key never
 * enters a mobile token, Gateway material route, or public response. */
export function signPublicProviderReconciliation(
  value: Omit<PublicProviderReconciliationEvidence, "signature">,
  signingKey: string,
) {
  if (!hash(signingKey)) throw Error("public_provider_reconciliation_key_invalid");
  return createHmac("sha256", signingKey).update(canonicalSyncJson(value)).digest("hex");
}

export function hasPublicProviderReconciliation(session: SessionRecord) {
  const record = session.publicProviderReconciliation;
  if (!record || !session.publicRuntime?.uncertain || !session.publicRuntime.stoppedAt ||
      !key(record.reconciliationId) || !hash(record.evidenceHash) || !key(record.providerId) ||
      !["attempt", "isolated_candidate_day"].includes(record.evidenceScope) ||
      !Number.isSafeInteger(record.providerUsageCount) || record.providerUsageCount < 1 ||
      !Number.isFinite(record.providerUsageSeconds) || record.providerUsageSeconds < 0 ||
      !hash(record.providerEvidenceHash) || record.providerRequestIdHash !== undefined && !hash(record.providerRequestIdHash) ||
      !validTime(record.observedAt) || !validTime(record.reconciledAt) ||
      !Array.isArray(record.uncertainAttemptIds) || record.uncertainAttemptIds.length < 1 ||
      new Set(record.uncertainAttemptIds).size !== record.uncertainAttemptIds.length ||
      record.uncertainAttemptIds.some((id) => !key(id))) return false;
  const attempts = session.publicModelAttempts?.filter((item) => item.event.state === "uncertain") ?? [];
  return attempts.length === record.uncertainAttemptIds.length &&
    attempts.every((item) => record.uncertainAttemptIds.includes(item.event.attemptId));
}

/** Reconciliation never modifies runtime watermarks or the original uncertain
 * attempts. It only records signed external evidence that permits existing
 * server-observed unique finalization. */
export function reconcilePublicProviderUsage(
  sessionId: string,
  value: unknown,
  now = new Date(),
) {
  const evidence = parse(value);
  const signingKey = reconciliationKey();
  const deploymentId = publicDeploymentId();
  if (!enabled()) throw new ResultSyncError("public_provider_reconciliation_disabled", 503);
  if (!Number.isFinite(now.getTime()) || evidence.sessionId !== sessionId ||
      evidence.deploymentId !== deploymentId || Date.parse(evidence.observedAt) > now.getTime()) {
    throw new ResultSyncError("public_provider_reconciliation_invalid", 400);
  }
  const { signature: _signature, ...body } = evidence;
  const expected = signPublicProviderReconciliation(body, signingKey);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(evidence.signature))) {
    throw new ResultSyncError("public_provider_reconciliation_signature_invalid", 403);
  }
  return mutatePublicSession<PublicProviderReconciliationRecord>(
    sessionId,
    "public-provider-reconciliation",
    body,
    (current) => {
      assertPublicSession(current, evidence.ownerId, deploymentId);
      const runtime = current.publicRuntime;
      const evidenceHash = resultSyncHash(body);
      if (current.publicProviderReconciliation) {
        if (current.publicProviderReconciliation.evidenceHash !== evidenceHash) {
          throw new ResultSyncError("public_provider_reconciliation_conflict", 409);
        }
        return { next: null, result: structuredClone(current.publicProviderReconciliation) };
      }
      if (!runtime?.stoppedAt || !runtime.uncertain || current.publicFinalization ||
          current.finalizationIdempotencyKey || current.status === "ended" || current.status === "failed") {
        throw new ResultSyncError("public_provider_reconciliation_not_required", 409);
      }
      if (Date.parse(evidence.observedAt) < Date.parse(runtime.stoppedAt) ||
          now.getTime() - Date.parse(evidence.observedAt) > 31 * 86_400_000) {
        throw new ResultSyncError("public_provider_reconciliation_before_stop", 409);
      }
      const uncertain = current.publicModelAttempts?.filter((item) => item.event.state === "uncertain") ?? [];
      if (uncertain.length === 0 || evidence.providerUsageCount !== uncertain.length || !sameUncertainAttempts(uncertain, evidence)) {
        throw new ResultSyncError("public_provider_reconciliation_attempt_mismatch", 409);
      }
      if (evidence.evidenceScope === "attempt" && !evidence.providerRequestIdHash) {
        throw new ResultSyncError("public_provider_reconciliation_request_id_required", 400);
      }
      if (evidence.evidenceScope === "isolated_candidate_day" &&
          (process.env.NODE_ENV === "production" || process.env.PUBLIC_RUNTIME_RECONCILIATION_ALLOW_ISOLATED_DAILY_AGGREGATE !== "true" ||
            evidence.providerUsageCount !== uncertain.length)) {
        throw new ResultSyncError("public_provider_reconciliation_scope_forbidden", 403);
      }
      const record: PublicProviderReconciliationRecord = {
        reconciliationId: evidence.reconciliationId,
        evidenceHash,
        providerId: evidence.providerId,
        evidenceScope: evidence.evidenceScope,
        providerUsageCount: evidence.providerUsageCount,
        providerUsageSeconds: evidence.providerUsageSeconds,
        providerEvidenceHash: evidence.providerEvidenceHash,
        ...(evidence.providerRequestIdHash ? { providerRequestIdHash: evidence.providerRequestIdHash } : {}),
        observedAt: evidence.observedAt,
        reconciledAt: now.toISOString(),
        uncertainAttemptIds: uncertain.map((item) => item.event.attemptId),
      };
      const next = structuredClone(current);
      next.publicProviderReconciliation = record;
      return { next, result: structuredClone(record) };
    },
  );
}

function reconciliationKey(): string {
  const value = process.env.PUBLIC_RUNTIME_RECONCILIATION_KEY;
  if (typeof value !== "string" || !hash(value) || [
    process.env.INTERNAL_API_SECRET,
    process.env.REALTIME_TOKEN_SECRET,
    process.env.PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET,
    process.env.PUBLIC_RUNTIME_ADMISSION_POLICY_KEY,
    process.env.PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY,
    process.env.PUBLIC_MODEL_CONFIG_KEY,
    process.env.PRIVATE_MODEL_CONFIG_KEY,
  ].some((other) => other && other === value)) {
    throw new ResultSyncError("public_provider_reconciliation_not_configured", 503);
  }
  return value;
}

function parse(value: unknown): PublicProviderReconciliationEvidence {
  const evidence = value as PublicProviderReconciliationEvidence | null;
  if (!evidence || Array.isArray(evidence) || Object.keys(evidence).some((field) => !fields.includes(field)) ||
      evidence.schemaVersion !== 1 || ![
        evidence.reconciliationId, evidence.sessionId, evidence.ownerId,
        evidence.deploymentId, evidence.providerId,
      ].every(key) || !["attempt", "isolated_candidate_day"].includes(evidence.evidenceScope) ||
      !Number.isSafeInteger(evidence.providerUsageCount) || evidence.providerUsageCount < 1 || evidence.providerUsageCount > 1024 ||
      !Number.isFinite(evidence.providerUsageSeconds) || evidence.providerUsageSeconds < 0 || evidence.providerUsageSeconds > 86_400 ||
      !hash(evidence.providerEvidenceHash) || evidence.providerRequestIdHash !== undefined && !hash(evidence.providerRequestIdHash) ||
      !validTime(evidence.observedAt) || !hash(evidence.signature) || !Array.isArray(evidence.attempts) ||
      evidence.attempts.length < 1 || evidence.attempts.length > 32 ||
      new Set(evidence.attempts.map((attempt) => attempt?.attemptId)).size !== evidence.attempts.length ||
      evidence.attempts.some((attempt) => !attempt || typeof attempt !== "object" || Array.isArray(attempt) ||
        Object.keys(attempt).some((field) => !["attemptId", "component", "modelId"].includes(field)) ||
        !key(attempt.attemptId) || !key(attempt.modelId) || !["asr", "translation", "tts"].includes(attempt.component))) {
    throw new ResultSyncError("public_provider_reconciliation_invalid", 400);
  }
  return structuredClone(evidence);
}

function sameUncertainAttempts(
  records: Array<{ event: { attemptId: string; component: string; providerId: string; modelId: string } }>,
  evidence: PublicProviderReconciliationEvidence,
) {
  if (records.some((record) => record.event.providerId !== evidence.providerId)) return false;
  return records.length === evidence.attempts.length && records.every((record) => evidence.attempts.some((attempt) =>
    attempt.attemptId === record.event.attemptId && attempt.component === record.event.component && attempt.modelId === record.event.modelId,
  ));
}

function validTime(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
