import {
  normalizeEnterpriseSupportWriteArguments,
  supportWriteDeterministicId,
  supportWriteHash,
  type EnterpriseSupportWriteAdapter,
} from "./enterprise-support-write-tool.js";

export function createMockEnterpriseSupportWriteAdapter(input: {
  boundTenantId: string;
}): EnterpriseSupportWriteAdapter & {
  invocationCount(): number;
  effectCount(): number;
} {
  const tenantId = uuid(input.boundTenantId);
  const effects = new Map<string, {
    requestHash: string;
    result: Awaited<ReturnType<EnterpriseSupportWriteAdapter["execute"]>>;
  }>();
  let invocations = 0;
  const fingerprint = `mock:${supportWriteHash({ tenantId,
    tools: ["ticket.create", "callback.schedule", "note.add"] })}`;
  return {
    readiness: (requestedTenantId) => requestedTenantId === tenantId
      ? { status: "ready", providerFingerprint: fingerprint,
          simulated: true, idempotencyGuaranteed: true }
      : { status: "not_configured",
          reasonCode: "support_write_tool_adapter_tenant_not_configured" },
    async execute(request) {
      invocations += 1;
      if (request.signal.aborted || request.tenantId !== tenantId) return {
        status: "retry", reasonCode: "support_write_tool_adapter_unavailable",
      };
      const normalized = normalizeEnterpriseSupportWriteArguments(
        request.toolName, request.arguments,
      );
      if (!normalized) return { status: "failed",
        reasonCode: "support_write_tool_arguments_invalid",
        providerReference: `mock:rejected:${request.executionId}` };
      const requestHash = supportWriteHash({ tenantId: request.tenantId,
        customerId: request.customerId, executionId: request.executionId,
        toolName: request.toolName, arguments: normalized.value });
      const prior = effects.get(request.idempotencyKey);
      if (prior) return prior.requestHash === requestHash ? prior.result : {
        status: "failed", reasonCode: "support_write_tool_idempotency_conflict",
        providerReference: `mock:conflict:${request.executionId}` };
      const key = `${tenantId}:${request.customerId}:${request.idempotencyKey}`;
      const result = normalized.toolName === "ticket.create"
        ? { kind: "ticket" as const, ticketId: supportWriteDeterministicId(
            "ticket", key), status: "created" as const }
        : normalized.toolName === "callback.schedule"
          ? { kind: "callback" as const, callbackId: supportWriteDeterministicId(
              "callback", key), status: "scheduled" as const,
              scheduledAt: normalized.value.scheduledAt }
          : { kind: "note" as const, noteId: supportWriteDeterministicId(
              "note", key), status: "created" as const };
      const completed = { status: "completed" as const, result,
        providerReference: `mock:${result.kind}:${request.executionId}` };
      effects.set(request.idempotencyKey, { requestHash, result: completed });
      return completed;
    },
    invocationCount: () => invocations,
    effectCount: () => effects.size,
  };
}

function uuid(value: unknown) {
  if (typeof value !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Invalid support write mock tenant id");
  }
  return value;
}
