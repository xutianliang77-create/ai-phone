import { createHmac } from "node:crypto";
import type {
  CreateSipOutboundCallRequest,
  TelephonyProvider,
} from "@translation/contracts";
import {
  beginProviderOperation,
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import type { CallLinkRecord } from "./call-links.service.js";
import { LiveKitSipProviderAdapter } from "./livekit-sip-provider-adapter.js";
import { liveKitSipParticipantIdentity } from "./livekit-sip-identity.js";
import type { LiveKitSipConfig } from "./livekit-sip-readiness.js";

type ProviderFactory = (config: LiveKitSipConfig) => TelephonyProvider;
let testProviderFactory: ProviderFactory | null = null;

export function setLiveKitSipOutboundProviderFactoryForTests(
  factory: ProviderFactory | null,
) {
  testProviderFactory = factory;
}

export function beginLiveKitSipOutbound(input: {
  record: CallLinkRecord;
  request: CreateSipOutboundCallRequest;
  operationKey?: string;
}) {
  return beginProviderOperation({
    sessionId: input.record.sessionId,
    provider: "livekit_sip",
    operationType: "sip_outbound",
    ...(input.operationKey ? { operationKey: input.operationKey } : {}),
    idempotencyKey: input.operationKey
      ? `sip-outbound:${input.record.sessionId}:${input.operationKey}`
      : `sip-outbound:${input.record.sessionId}`,
    requestHash: liveKitSipOutboundRequestHash(input.record, input.request),
  });
}

export async function executeLiveKitSipOutbound(input: {
  record: CallLinkRecord;
  request: CreateSipOutboundCallRequest;
  operation: ProviderOperationRecord;
  config: LiveKitSipConfig;
}) {
  if (["accepted", "active", "succeeded"].includes(input.operation.status)) {
    return success(input.operation, true);
  }
  if (["failed", "cancelled"].includes(input.operation.status)) {
    return failure(input.operation, false, input.operation.lastErrorClass ?? "failed");
  }
  if (input.operation.status === "unknown") {
    return failure(input.operation, true, input.operation.lastErrorClass ?? "unknown");
  }
  const provider = (testProviderFactory ??
    ((value) => new LiveKitSipProviderAdapter(value)))(input.config);
  const result = await provider.createParticipant({
    operationId: input.operation.id,
    sessionId: input.record.sessionId,
    expectedVersion: input.operation.version,
    idempotencyKey: input.operation.idempotencyKey,
    deadlineAt: new Date(
      Date.now() + input.config.requestTimeoutSeconds * 1000,
    ).toISOString(),
    payload: {
      roomName: input.record.roomName,
      phoneNumberReference: input.request.targetPhone,
      participantIdentity: liveKitSipParticipantIdentity(
        input.record.sessionId,
        input.operation.id,
      ),
      ...(input.request.initialDtmf
        ? { initialDtmf: input.request.initialDtmf }
        : {}),
    },
  });
  if (result.ok) {
    const updated = await updateProviderOperation({
      operationId: input.operation.id,
      status: "accepted",
      expectedVersion: input.operation.version,
      externalOperationId: result.externalOperationId,
      externalResourceId: result.externalResourceId,
    });
    return {
      ...success(await currentOperation(updated, input.operation), false),
      participantIdentity: result.result.participantIdentity,
    };
  }
  const reconciliationRequired = result.reconciliationRequired;
  const updated = await updateProviderOperation({
    operationId: input.operation.id,
    status: reconciliationRequired ? "unknown" : "failed",
    expectedVersion: input.operation.version,
    errorClass: result.errorClass,
    externalOperationId: result.externalOperationId,
  });
  return failure(
    await currentOperation(updated, input.operation),
    reconciliationRequired,
    result.errorClass,
  );
}

export function liveKitSipOutboundRequestHash(
  record: CallLinkRecord,
  body: CreateSipOutboundCallRequest,
) {
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  return createHmac("sha256", secret).update(JSON.stringify({
    sessionId: record.sessionId,
    targetPhone: body.targetPhone,
    sourceLanguage: body.sourceLanguage,
    targetLanguage: body.targetLanguage,
    disclosureConfirmed: body.disclosureConfirmed,
    initialDtmf: body.initialDtmf,
  })).digest("hex");
}

function success(operation: ProviderOperationRecord, replayed: boolean) {
  return {
    ok: true as const,
    operation,
    replayed,
    participantIdentity: liveKitSipParticipantIdentity(
      operation.sessionId,
      operation.id,
    ),
  };
}

function failure(
  operation: ProviderOperationRecord,
  reconciliationRequired: boolean,
  errorClass: string,
) {
  return {
    ok: false as const,
    operation,
    reconciliationRequired,
    errorClass,
  };
}

async function currentOperation(
  result: Awaited<ReturnType<typeof updateProviderOperation>>,
  fallback: ProviderOperationRecord,
) {
  return "operation" in result && result.operation
    ? result.operation
    : await findProviderOperation(fallback.id) ?? fallback;
}
