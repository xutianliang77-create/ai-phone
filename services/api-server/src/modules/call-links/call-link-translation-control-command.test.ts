import { describe, expect, it } from "vitest";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import {
  translationControlOperationIdempotencyKey,
  translationControlOutboxFactory,
} from "./call-link-translation-control-command.js";
import { translationUplinkControlOperationKey } from
  "./call-link-translation-control-support.js";

describe("translation control command", () => {
  it("freezes the original generation, language, and command window", () => {
    const factory = translationControlOutboxFactory({
      sessionId: "call-1",
      roomName: "call_call-1",
      callId: "call-1",
      dialOperationId: "dial-1",
      dispatchGeneration: 7,
      controlGeneration: 3,
      command: {
        type: "translation.type_to_speak",
        text: "请稍等",
        state: { sourceLanguage: "zh", targetLanguage: "en" },
      },
    });

    const persisted = operation();
    const first = factory(persisted);
    expect(first).toMatchObject({
      idempotencyKey: "translation-control-delivery:control-1",
      sessionId: "call-1",
      eventType: "translation_call_control.delivery",
      payload: {
        roomName: "call_call-1",
        command: {
          controlOperationId: "control-1",
          dispatchGeneration: 7,
          controlGeneration: 3,
          issuedAt: "2026-08-13T08:00:00.000Z",
          expiresAt: "2026-08-13T08:02:00.000Z",
          sourceLanguage: "zh",
          targetLanguage: "en",
          text: "请稍等",
        },
      },
    });
    expect(factory({
      ...persisted,
      updatedAt: "2026-08-13T08:00:01.000Z",
    })).toEqual(first);
  });

  it("names provider idempotency independently of Air780 and SIP", () => {
    expect(translationControlOperationIdempotencyKey({
      type: "translation.type_to_speak",
      sessionId: "call-1",
      idempotencyKey: "typed-text-0001",
    })).toBe("translation-type:call-1:typed-text-0001");
  });

  it("uses one database slot for each uplink control generation", () => {
    expect(translationUplinkControlOperationKey(3, 7))
      .toBe("c3:d7:uplink-control");
  });
});

function operation(): ProviderOperationRecord {
  return {
    id: "control-1",
    sessionId: "call-1",
    provider: "livekit",
    operationType: "translation_type_to_speak",
    operationKey: "c3:d7:typed-text-0001",
    idempotencyKey: "translation-type:call-1:typed-text-0001",
    requestHash: "hash-1",
    status: "in_flight",
    attempt: 1,
    version: 1,
    startedAt: "2026-08-13T08:00:00.000Z",
    updatedAt: "2026-08-13T08:00:00.000Z",
  };
}
