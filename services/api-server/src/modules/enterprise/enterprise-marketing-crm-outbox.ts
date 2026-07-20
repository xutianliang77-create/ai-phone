import type { EnterpriseOutboxEventRecord } from "./enterprise-event-record.js";
import type { EnterpriseMarketingCrmProviderAdapter } from
  "./enterprise-marketing-crm-provider.js";
import { loadEnterpriseMarketingCrmPayloadKeyring,
  openEnterpriseMarketingCrmPayload,
  type EnterpriseMarketingCrmPayloadKeyring } from
  "./enterprise-marketing-crm-payload.js";
import type { EnterpriseMarketingCrmOutboxPayload } from
  "./enterprise-marketing-crm.js";
import type { EnterpriseOutboxPublisher } from "./enterprise-outbox-processor.js";

export function createEnterpriseMarketingCrmOutboxPublisher(input: {
  provider: EnterpriseMarketingCrmProviderAdapter; fallback: EnterpriseOutboxPublisher;
  keyring?: EnterpriseMarketingCrmPayloadKeyring | null;
}): EnterpriseOutboxPublisher {
  const keyring = input.keyring === undefined ? environmentKeyring() : input.keyring;
  return { publish(event) { return event.eventType === "marketing.crm.sync.requested"
    ? publish(input.provider, keyring, event) : input.fallback.publish(event); } };
}
async function publish(provider: EnterpriseMarketingCrmProviderAdapter,
  keyring: EnterpriseMarketingCrmPayloadKeyring | null,
  event: Readonly<EnterpriseOutboxEventRecord>) {
  const payload = outboxPayload(event.payload, event);
  if (!payload) return terminal(event.aggregateId, "crm_payload_rejected");
  if (!keyring) return { status: "retry" as const,
    reason: "crm_payload_encryption_not_configured" };
  if (provider.boundTenantId !== payload.tenantId ||
    provider.objectApiName !== payload.objectApiName ||
    provider.fingerprint !== payload.providerFingerprint) return { status: "retry" as const,
      reason: "crm_provider_binding_mismatch" };
  let request;
  try { request = openEnterpriseMarketingCrmPayload(payload, keyring); }
  catch { return terminal(payload.syncId, "crm_payload_rejected"); }
  const result = await provider.upsert(request);
  if (result.status === "retry") return { status: "retry" as const,
    reason: code(result.reasonCode) };
  if (result.status === "failed") return terminal(payload.syncId,
    code(result.reasonCode));
  if (!result.providerRecordId || !result.providerRecordUrl ||
    !result.providerResponseHash) return { status: "retry" as const,
      reason: "crm_provider_receipt_invalid" };
  return { status: "completed" as const, receipt: { kind: "marketing_crm" as const,
    outcome: "synced" as const, syncId: payload.syncId,
    providerRecordId: result.providerRecordId,
    providerRecordUrl: result.providerRecordUrl,
    providerResponseHash: result.providerResponseHash } };
}
function outboxPayload(value: unknown, event: Readonly<EnterpriseOutboxEventRecord>):
  EnterpriseMarketingCrmOutboxPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const allowed = ["v", "tenantId", "syncId", "campaignId", "outcomeId", "provider",
    "externalRecordKey", "objectApiName", "providerFingerprint", "payloadHash",
    "sealedPayload"];
  return Object.keys(item).every((key) => allowed.includes(key)) && item.v === 1 &&
    item.provider === "salesforce" && item.tenantId === event.tenantId &&
    item.syncId === event.aggregateId && event.aggregateType === "marketing_crm_sync" &&
    uuid(item.tenantId) && uuid(item.syncId) && uuid(item.campaignId) &&
    uuid(item.outcomeId) && externalKey(item.externalRecordKey) &&
    apiName(item.objectApiName) && hash(item.providerFingerprint) &&
    hash(item.payloadHash) && bounded(item.sealedPayload, 16_384)
    ? item as unknown as EnterpriseMarketingCrmOutboxPayload : null;
}
function terminal(syncId: string, reasonCode: string) { return { status: "completed" as const,
  receipt: { kind: "marketing_crm" as const, outcome: "failed" as const,
    syncId, reasonCode: code(reasonCode) } }; }
function environmentKeyring() { try { return loadEnterpriseMarketingCrmPayloadKeyring(); }
  catch { return null; } }
function code(value: unknown) { return typeof value === "string" &&
  /^[a-z][a-z0-9_]{1,63}$/.test(value) ? value : "crm_provider_failed"; }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value); }
function externalKey(value: unknown): value is string { return typeof value === "string" &&
  /^wujie_[a-f0-9]{48}$/.test(value); }
function apiName(value: unknown): value is string { return typeof value === "string" &&
  /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value); }
function bounded(value: unknown, max: number): value is string { return typeof value ===
  "string" && value.length > 0 && Buffer.byteLength(value) <= max; }
