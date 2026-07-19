import {
  loadEnterpriseSupportWritePayloadKeyring,
  sealEnterpriseSupportWritePayload,
  type EnterpriseSupportWritePayloadKeyring,
} from "./enterprise-support-write-payload.js";
import {
  normalizeEnterpriseSupportWriteArguments,
  supportWriteHash,
  type EnterpriseSupportWriteAdapter,
  type EnterpriseSupportWriteOutboxPayload,
  type EnterpriseSupportWriteToolName,
} from "./enterprise-support-write-tool.js";

export interface EnterpriseSupportWriteCommandService {
  readiness(tenantId: string): ReturnType<EnterpriseSupportWriteAdapter["readiness"]>;
  prepare(input: {
    tenantId: string;
    executionId: string;
    customerId: string;
    toolName: EnterpriseSupportWriteToolName;
    idempotencyKey: string;
    arguments: Record<string, unknown>;
    argumentsHash: string;
  }): EnterpriseSupportWriteOutboxPayload;
}

export function createEnterpriseSupportWriteCommandService(input: {
  adapter: EnterpriseSupportWriteAdapter;
  keyring?: EnterpriseSupportWritePayloadKeyring | null;
}): EnterpriseSupportWriteCommandService {
  const keyring = input.keyring === undefined ? environmentKeyring() : input.keyring;
  return {
    readiness(tenantId) {
      if (!keyring) return { status: "not_configured",
        reasonCode: "support_write_payload_encryption_not_configured" };
      try { return input.adapter.readiness(tenantId); }
      catch { return { status: "not_configured",
        reasonCode: "support_write_tool_adapter_unavailable" }; }
    },
    prepare(request) {
      const readiness = this.readiness(request.tenantId);
      if (readiness.status !== "ready") throw new Error(readiness.reasonCode);
      if (!keyring) throw new Error(
        "support_write_payload_encryption_not_configured",
      );
      const normalized = normalizeEnterpriseSupportWriteArguments(
        request.toolName, request.arguments,
      );
      if (!normalized || supportWriteHash(normalized.value) !== request.argumentsHash) {
        throw new Error("support_write_tool_arguments_invalid");
      }
      const sealed = sealEnterpriseSupportWritePayload({ v: 1,
        tenantId: request.tenantId, executionId: request.executionId,
        customerId: request.customerId, toolName: request.toolName,
        idempotencyKey: request.idempotencyKey,
        arguments: normalized.value }, keyring);
      return { v: 1, tenantId: request.tenantId,
        executionId: request.executionId, customerId: request.customerId,
        toolName: request.toolName, idempotencyKey: request.idempotencyKey,
        argumentsHash: request.argumentsHash,
        providerFingerprint: readiness.providerFingerprint,
        providerSimulated: readiness.simulated, ...sealed };
    },
  };
}

function environmentKeyring() {
  try { return loadEnterpriseSupportWritePayloadKeyring(); }
  catch { return null; }
}
