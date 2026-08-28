import { describe, expect, it, vi } from "vitest";
import {
  createAirDeviceUplinkSourceAuthorizer,
  DeviceCallMediaAdmissionConflict,
} from "./device-call-uplink-source-authorizer.js";

describe("Air device uplink source authorization", () => {
  it("allows translation TTS only from the active bound Worker", async () => {
    const fixture = setup({ purpose: "human_call", mediaPolicy: "translation_isolated" });
    const authorizer = fixture.authorizer();

    await expect(authorizer.assertAuthorized({
      ...input,
      uplinkSource: "translated_tts",
    })).resolves.toBeUndefined();
    await expect(authorizer.assertAuthorized({
      ...input,
      publisherIdentity: "comm-1:worker:forged",
      uplinkSource: "translated_tts",
    })).rejects.toMatchObject({ reason: "worker_leg_inactive" });
  });

  it("allows takeover only for the resolved exact Host on a connected Agent call", async () => {
    const fixture = setup({
      purpose: "voice_agent",
      mediaPolicy: "agent_monitored",
      publisherIdentity: "comm-1:host:user-1",
      draft: {
        status: "takeover_requested",
        takeoverReadyAt: "2026-08-13T08:00:00.000Z",
        takeoverResolvedAt: "2026-08-13T08:00:01.000Z",
        takeoverParticipantIdentity: "comm-1:host:user-1",
      },
    });

    await expect(fixture.authorizer().assertAuthorized({
      ...input,
      publisherIdentity: "comm-1:host:user-1",
      trackName: "microphone",
      uplinkSource: "takeover_microphone",
    })).resolves.toBeUndefined();
  });

  it.each([
    ["carrier_not_connected", { carrierState: "ringing" }],
    ["media_policy_mismatch", { mediaPolicy: "translation_isolated" }],
  ])("fails closed for %s", async (reason, override) => {
    const fixture = setup({
      purpose: "voice_agent",
      publisherIdentity: "comm-1:host:user-1",
      ...override,
    });
    await expect(fixture.authorizer().assertAuthorized({
      ...input,
      publisherIdentity: "comm-1:host:user-1",
      trackName: "microphone",
      uplinkSource: "takeover_microphone",
    })).rejects.toEqual(expect.objectContaining({
      reason,
      name: "DeviceCallMediaAdmissionConflict",
    }));
  });

  it("blocks Agent TTS after the Host takeover has resolved", async () => {
    const fixture = setup({
      purpose: "voice_agent",
      draft: {
        status: "takeover_requested",
        takeoverReadyAt: "2026-08-13T08:00:00.000Z",
        takeoverResolvedAt: "2026-08-13T08:00:01.000Z",
      },
    });

    await expect(fixture.authorizer().assertAuthorized({
      ...input,
      uplinkSource: "translated_tts",
    })).rejects.toBeInstanceOf(DeviceCallMediaAdmissionConflict);
  });
});

function setup(options: {
  purpose?: "human_call" | "voice_agent";
  mediaPolicy?: "translation_isolated" | "agent_monitored";
  carrierState?: "connected" | "ringing";
  publisherIdentity?: string;
  draft?: Record<string, unknown>;
} = {}) {
  const publisherIdentity = options.publisherIdentity ?? input.publisherIdentity;
  const airCall = {
    providerCallId: "air-call-1",
    communicationSessionId: "comm-1",
    providerOperationId: "provider-operation-1",
    deviceId: "air-1",
    leaseId: "lease-1",
    fencingToken: 7,
    carrierState: options.carrierState ?? "connected",
    liveKitParticipantState: "joined" as const,
    callGeneration: 3,
    mediaPolicy: options.mediaPolicy ?? "agent_monitored",
    version: 1,
  };
  const dependencies = {
    findCallLink: vi.fn(async () => ({
      callId: "comm-1", userId: "user-1", sessionId: "comm-1",
      roomName: "call_comm-1", roomProvider: "livekit" as const,
      joinUrl: "https://example.cn/join", hostUrl: "https://example.cn/host",
      status: "active" as const, version: 1, mode: "call_link" as const,
      purpose: options.purpose ?? "voice_agent", expiresAt: "2099-01-01T00:00:00Z",
      createdAt: "2026-08-13T00:00:00Z",
    })),
    findSession: vi.fn(async () => ({
      id: "comm-1", userId: "user-1", mode: "call_link" as const,
      status: "active" as const, consumedSeconds: 0,
      createdAt: "2026-08-13T00:00:00Z", segments: [],
      callLegs: [{ id: publisherIdentity, participantIdentity: publisherIdentity,
        participantRole: publisherIdentity.includes(":host:") ? "host" as const
          : "worker" as const,
        joinType: publisherIdentity.includes(":host:") ? "app" as const
          : "worker" as const,
        status: "active" as const, joinedAt: "2026-08-13T00:00:00Z" }],
    })),
    findAgentCallDraftByCallReference: vi.fn(async () => ({
      id: "draft-1", userId: "user-1", scenario: "custom" as const,
      status: "in_progress" as const, objective: "test", suggestedScript: "test",
      language: "zh" as const, riskLevel: "low" as const, riskReasons: [],
      createdAt: "2026-08-13T00:00:00Z", updatedAt: "2026-08-13T00:00:00Z",
      executionProvider: "air780_volte" as const, callId: "comm-1",
      providerCallId: "air-call-1", providerOperationId: "provider-operation-1",
      ...options.draft,
    })),
  };
  return {
    authorizer: () => createAirDeviceUplinkSourceAuthorizer({
      findCurrentCallStatus: vi.fn(async () => airCall),
    }, dependencies),
  };
}

const input = {
  communicationSessionId: "comm-1",
  roomName: "call_comm-1",
  deviceId: "air-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
  targetParticipantIdentity: "comm-1:guest:air:air-1",
  trackSid: "TR_1",
  trackName: "translation-tts-guest-1.target",
  publisherIdentity: "comm-1:worker:voice-agent-1",
};
