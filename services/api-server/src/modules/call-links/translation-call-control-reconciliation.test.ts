import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";
import { findProviderOperation } from
  "../provider-operations/provider-operations.repository.js";
import {
  acceptTranslationControlForDelivery,
  reconcileTerminalTranslationControl,
} from "./translation-call-control-reconciliation.js";
import type { TranslationCallControlCommand } from
  "@translation/contracts";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";

describe("translation control delivery reconciliation", () => {
  beforeEach(() => {
    getStoreSnapshot().providerOperations = [];
    getStoreSnapshot().sessions = [];
  });

  it("persists accepted before a recovered command can reach the Worker", async () => {
    const operation = providerOperation("in_flight", 1);
    getStoreSnapshot().providerOperations.push(operation);

    expect(await acceptTranslationControlForDelivery(command())).toBe(true);
    expect(findProviderOperation(operation.id)).toMatchObject({
      status: "accepted",
      version: 2,
    });
  });

  it("replays accepted and refuses terminal operations", async () => {
    getStoreSnapshot().providerOperations.push(
      providerOperation("accepted", 2),
    );
    expect(await acceptTranslationControlForDelivery(command())).toBe(true);
    expect(findProviderOperation("control-1")?.version).toBe(2);

    getStoreSnapshot().providerOperations[0] = providerOperation("failed", 3);
    expect(await acceptTranslationControlForDelivery(command())).toBe(false);
    expect(findProviderOperation("control-1")?.version).toBe(3);
  });

  it("settles an operation that crashed before its state pending was created", async () => {
    getStoreSnapshot().sessions.push(sessionWithTranslationState());
    getStoreSnapshot().providerOperations.push(uplinkOperation());

    expect(await reconcileTerminalTranslationControl(uplinkCommand()))
      .toBe(true);
    expect(getStoreSnapshot().sessions[0]?.callLink?.translationControl)
      .toMatchObject({
        controlGeneration: 2,
        uplinkPaused: true,
        lastSettledOperationId: "control-1",
        lastSettledSucceeded: false,
      });
    expect(getStoreSnapshot().sessions[0]?.callLink?.translationControl)
      .not.toHaveProperty("pending");
  });
});

function providerOperation(
  status: "in_flight" | "accepted" | "failed",
  version: number,
) {
  return {
    id: "control-1",
    sessionId: "call-1",
    provider: "livekit" as const,
    operationType: "translation_type_to_speak" as const,
    operationKey: "c1:d7:typed-text-0001",
    idempotencyKey: "translation-type:call-1:typed-text-0001",
    requestHash: "hash-1",
    status,
    attempt: 1,
    version,
    startedAt: "2026-08-13T08:00:00.000Z",
    updatedAt: "2026-08-13T08:00:00.000Z",
    ...(status === "failed"
      ? { endedAt: "2026-08-13T08:00:01.000Z" } : {}),
  };
}

function command(): TranslationCallControlCommand {
  return {
    version: 1,
    type: "translation.type_to_speak",
    callId: "call-1",
    dialOperationId: "dial-1",
    controlOperationId: "control-1",
    dispatchGeneration: 7,
    controlGeneration: 1,
    issuedAt: "2026-08-13T08:00:00.000Z",
    expiresAt: "2026-08-13T08:02:00.000Z",
    text: "请稍等",
    sourceLanguage: "zh",
    targetLanguage: "en",
  };
}

function uplinkOperation(): ProviderOperationRecord {
  return {
    ...providerOperation("failed", 2),
    operationType: "translation_uplink_control",
    operationKey: "c2:d7:uplink-control",
    idempotencyKey: "translation-uplink:call-1:pause-key-0001",
  };
}

function uplinkCommand(): TranslationCallControlCommand {
  return {
    version: 1,
    type: "translation.uplink_pause",
    callId: "call-1",
    dialOperationId: "dial-1",
    controlOperationId: "control-1",
    dispatchGeneration: 7,
    controlGeneration: 2,
    issuedAt: "2026-08-13T08:00:00.000Z",
    expiresAt: "2026-08-13T08:02:00.000Z",
    paused: true,
  };
}

function sessionWithTranslationState() {
  return {
    id: "call-1",
    userId: "user-1",
    mode: "call_link" as const,
    status: "active" as const,
    consumedSeconds: 0,
    version: 1,
    createdAt: "2026-08-13T08:00:00.000Z",
    segments: [],
    callLink: {
      roomName: "call_call-1",
      roomProvider: "livekit" as const,
      joinUrl: "https://example.test/join/call-1",
      hostUrl: "https://example.test/host/call-1",
      expiresAt: "2026-08-13T09:00:00.000Z",
      purpose: "human_call" as const,
      translationControl: {
        sourceLanguage: "zh" as const,
        targetLanguage: "en" as const,
        uplinkPaused: false,
        controlGeneration: 1,
        updatedAt: "2026-08-13T08:00:00.000Z",
      },
    },
  };
}
