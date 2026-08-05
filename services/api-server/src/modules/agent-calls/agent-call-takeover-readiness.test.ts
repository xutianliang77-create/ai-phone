import { afterEach, describe, expect, it } from "vitest";
import type { TelephonyProvider } from "@translation/contracts";
import type { CallLinkRecord } from "../call-links/call-links.service.js";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import {
  isAgentCallCarrierConnected,
  setAgentCallTelephonyRuntimeForTests,
} from "./agent-call-telephony-runtime.js";

describe("agent call takeover carrier readiness", () => {
  afterEach(() => setAgentCallTelephonyRuntimeForTests(null));

  it("uses Air carrier state even while the dial operation is only accepted", async () => {
    setAirRuntime(true);

    await expect(isAgentCallCarrierConnected(call, operation({
      provider: "air780_volte",
      status: "accepted",
    }))).resolves.toBe(true);
  });

  it("does not promote an Air call from provider or LiveKit control state", async () => {
    setAirRuntime(false);

    await expect(isAgentCallCarrierConnected(call, operation({
      provider: "air780_volte",
      status: "active",
    }))).resolves.toBe(false);
  });

  it("keeps the legacy SIP compatibility rule isolated to SIP", async () => {
    await expect(isAgentCallCarrierConnected(call, operation({
      provider: "livekit_sip",
      status: "active",
    }))).resolves.toBe(true);
    await expect(isAgentCallCarrierConnected(call, operation({
      provider: "livekit_sip",
      status: "accepted",
    }))).resolves.toBe(false);
  });
});

function setAirRuntime(connected: boolean) {
  setAgentCallTelephonyRuntimeForTests({
    provider: "air780_volte",
    adapter: {} as TelephonyProvider,
    timeoutMs: 1_000,
    buildPayload: async () => { throw new Error("not used"); },
    resolveParticipantBinding: async () => { throw new Error("not used"); },
    resolveControlPayload: async () => { throw new Error("not used"); },
    isCarrierConnected: async () => connected,
  });
}

function operation(input: Pick<ProviderOperationRecord, "provider" | "status">) {
  return {
    id: "operation-1",
    sessionId: call.sessionId,
    operationType: "phone_outbound",
    idempotencyKey: "idem-1",
    requestHash: "hash-1",
    attempt: 1,
    version: 1,
    startedAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...input,
  } satisfies ProviderOperationRecord;
}

const call: CallLinkRecord = {
  callId: "call-1",
  userId: "user-1",
  sessionId: "session-1",
  roomName: "call_session-1",
  roomProvider: "livekit",
  joinUrl: "https://example.cn/join/call-1",
  hostUrl: "https://example.cn/host/call-1",
  status: "active",
  version: 1,
  mode: "call_link",
  purpose: "voice_agent",
  expiresAt: "2026-08-04T01:00:00.000Z",
  createdAt: "2026-08-04T00:00:00.000Z",
};
