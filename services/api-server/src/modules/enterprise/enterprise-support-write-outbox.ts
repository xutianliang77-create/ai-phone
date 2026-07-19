import type { EnterpriseOutboxEventRecord } from
  "./enterprise-event-record.js";
import type { EnterpriseOutboxPublisher } from
  "./enterprise-outbox-processor.js";
import {
  loadEnterpriseSupportWritePayloadKeyring,
  openEnterpriseSupportWritePayload,
  type EnterpriseSupportWritePayloadKeyring,
} from "./enterprise-support-write-payload.js";
import {
  normalizeEnterpriseSupportWriteArguments,
  normalizeEnterpriseSupportWriteResult,
  supportWriteHash,
  supportWriteToolName,
  type EnterpriseSupportWriteAdapter,
  type EnterpriseSupportWriteAdapterResult,
  type EnterpriseSupportWriteOutboxPayload,
} from "./enterprise-support-write-tool.js";

const adapterTimeoutMilliseconds = 10_000;

export function createEnterpriseSupportWriteOutboxPublisher(input: {
  adapter: EnterpriseSupportWriteAdapter;
  fallback: EnterpriseOutboxPublisher;
  keyring?: EnterpriseSupportWritePayloadKeyring | null;
}): EnterpriseOutboxPublisher {
  const keyring = input.keyring === undefined ? environmentKeyring() : input.keyring;
  return { publish(event) {
    if (event.eventType !== "support.tool.write.requested" &&
      event.eventType !== "support.followup.requested") {
      return input.fallback.publish(event);
    }
    return publishWrite(input.adapter, keyring, event);
  } };
}

async function publishWrite(
  adapter: EnterpriseSupportWriteAdapter,
  keyring: EnterpriseSupportWritePayloadKeyring | null,
  event: Readonly<EnterpriseOutboxEventRecord>,
) {
  const payload = writePayload(event.payload, event);
  if (!payload) return { status: "retry" as const,
    reason: "support_write_outbox_payload_rejected" };
  if (!keyring) return { status: "retry" as const,
    reason: "support_write_payload_encryption_not_configured" };
  let readiness: ReturnType<EnterpriseSupportWriteAdapter["readiness"]>;
  try { readiness = adapter.readiness(event.tenantId); }
  catch { return retry("support_write_tool_adapter_unavailable"); }
  if (readiness.status !== "ready") return retry(readiness.reasonCode);
  if (readiness.providerFingerprint !== payload.providerFingerprint ||
    readiness.simulated !== payload.providerSimulated ||
    readiness.idempotencyGuaranteed !== true) {
    return retry("support_write_tool_provider_fence_changed");
  }
  let request;
  try { request = openEnterpriseSupportWritePayload(payload, keyring); }
  catch { return retry("support_write_outbox_payload_rejected"); }
  const normalized = normalizeEnterpriseSupportWriteArguments(
    payload.toolName, request.arguments,
  );
  if (!normalized || supportWriteHash(normalized.value) !== payload.argumentsHash) {
    return retry("support_write_outbox_payload_rejected");
  }
  const outcome = await execute(adapter, { ...request,
    arguments: normalized.value });
  if (outcome.status === "retry") return retry(outcome.reasonCode);
  const providerReference = reference(outcome.providerReference);
  if (!providerReference) return retry("support_write_tool_receipt_invalid");
  if (outcome.status === "failed") return { status: "completed" as const,
    receipt: { kind: "support_write_tool" as const, outcome: "failed" as const,
      executionId: payload.executionId, toolName: payload.toolName,
      reasonCode: code(outcome.reasonCode), providerReference,
      providerFingerprint: readiness.providerFingerprint,
      simulated: readiness.simulated } };
  const result = normalizeEnterpriseSupportWriteResult(
    payload.toolName, outcome.result,
  );
  if (!result || result.kind === "callback" &&
    normalized.toolName === "callback.schedule" &&
    result.scheduledAt !== normalized.value.scheduledAt) {
    return retry("support_write_tool_receipt_invalid");
  }
  return { status: "completed" as const, receipt: {
    kind: "support_write_tool" as const, outcome: "completed" as const,
    executionId: payload.executionId, toolName: payload.toolName,
    result, resultHash: supportWriteHash(result), providerReference,
    providerFingerprint: readiness.providerFingerprint,
    simulated: readiness.simulated } };
}

async function execute(adapter: EnterpriseSupportWriteAdapter,
  request: Omit<Parameters<EnterpriseSupportWriteAdapter["execute"]>[0], "signal">):
  Promise<EnterpriseSupportWriteAdapterResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([
    adapter.execute({ ...request, signal: controller.signal }),
    new Promise<EnterpriseSupportWriteAdapterResult>((resolve) => {
      timeout = setTimeout(() => { controller.abort(); resolve({ status: "retry",
        reasonCode: "support_write_tool_timeout" }); }, adapterTimeoutMilliseconds);
    }),
  ]); } catch { return { status: "retry",
    reasonCode: controller.signal.aborted ? "support_write_tool_timeout" :
      "support_write_tool_adapter_unavailable" }; }
  finally { if (timeout) clearTimeout(timeout); }
}

function writePayload(value: unknown, event: Readonly<EnterpriseOutboxEventRecord>):
  EnterpriseSupportWriteOutboxPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const toolName = supportWriteToolName(item.toolName);
  const eventShape = event.eventType === "support.tool.write.requested"
    ? event.aggregateType === "support_tool_execution"
    : event.eventType === "support.followup.requested" &&
      event.aggregateType === "support_followup_command";
  return Object.keys(item).sort().join(",") === ["argumentsHash", "customerId",
    "executionId", "idempotencyKey", "payloadHash", "providerFingerprint",
    "providerSimulated", "sealedPayload", "tenantId", "toolName", "v"]
    .sort().join(",") && item.v === 1 && item.tenantId === event.tenantId &&
    item.executionId === event.aggregateId &&
    eventShape && toolName &&
    uuid(item.tenantId) && uuid(item.executionId) && uuid(item.customerId) &&
    key(item.idempotencyKey) && hash(item.argumentsHash) && hash(item.payloadHash) &&
    fingerprint(item.providerFingerprint) && typeof item.providerSimulated === "boolean" &&
    bounded(item.sealedPayload, 16_384)
    ? item as unknown as EnterpriseSupportWriteOutboxPayload : null;
}

function environmentKeyring() { try {
  return loadEnterpriseSupportWritePayloadKeyring();
} catch { return null; } }
function retry(reason: string) { return { status: "retry" as const,
  reason: code(reason) }; }
function code(value: unknown) { return typeof value === "string" &&
  /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "support_write_tool_failed"; }
function reference(value: unknown) { return typeof value === "string" && value.trim() &&
  Buffer.byteLength(value.trim()) <= 400 ? value.trim() : null; }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function key(value: unknown): value is string { return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value); }
function fingerprint(value: unknown): value is string { return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value); }
function bounded(value: unknown, max: number): value is string { return typeof value ===
  "string" && value.length > 0 && Buffer.byteLength(value) <= max; }
