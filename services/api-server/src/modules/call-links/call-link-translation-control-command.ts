import type { TranslationCallControlCommand } from "@translation/contracts";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import type { CallLinkTranslationControlState } from "./call-link-record.js";
import {
  translationControlDeliveryOutbox,
} from "./translation-call-control-outbox.js";

export function translationControlOperationIdempotencyKey(input: {
  type: "translation.type_to_speak" | "translation.uplink_pause";
  sessionId: string;
  idempotencyKey: string;
}) {
  const action = input.type === "translation.type_to_speak" ? "type" : "uplink";
  return `translation-${action}:${input.sessionId}:${input.idempotencyKey}`;
}

export function translationControlCommandWindow(startedAt: string) {
  const issuedAt = new Date(startedAt);
  return {
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 120_000).toISOString(),
  };
}

export function translationControlOutboxFactory(input: {
  sessionId: string;
  roomName: string;
  callId: string;
  dialOperationId: string;
  dispatchGeneration: number;
  controlGeneration: number;
  command: {
    type: "translation.type_to_speak";
    text: string;
    state: Pick<CallLinkTranslationControlState,
      "sourceLanguage" | "targetLanguage">;
  } | {
    type: "translation.uplink_pause";
    paused: boolean;
  };
}) {
  return (operation: ProviderOperationRecord) =>
    translationControlDeliveryOutbox({
      sessionId: input.sessionId,
      roomName: input.roomName,
      command: createTranslationControlCommand(operation, input),
    });
}

function createTranslationControlCommand(
  operation: ProviderOperationRecord,
  input: Parameters<typeof translationControlOutboxFactory>[0],
): TranslationCallControlCommand {
  const binding = {
    version: 1 as const,
    callId: input.callId,
    dialOperationId: input.dialOperationId,
    controlOperationId: operation.id,
    dispatchGeneration: input.dispatchGeneration,
    controlGeneration: input.controlGeneration,
    ...translationControlCommandWindow(operation.startedAt),
  };
  return input.command.type === "translation.type_to_speak"
    ? {
        ...binding,
        type: input.command.type,
        text: input.command.text,
        sourceLanguage: input.command.state.sourceLanguage,
        targetLanguage: input.command.state.targetLanguage,
      }
    : { ...binding, type: input.command.type, paused: input.command.paused };
}
