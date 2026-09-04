import { describe, expect, it, vi } from "vitest";
import { DeviceLeaseConflict } from "./device-lease-registry.js";
import { createAirDeviceTrackAdmission } from
  "./device-call-track-admission.js";

describe("Air device TTS track admission", () => {
  it("binds the exact server-authorized track to the current call and lease", async () => {
    const assertLease = vi.fn();
    const assertCallBinding = vi.fn();
    const input = validInput();

    await expect(createAirDeviceTrackAdmission(input, {
      leaseVerifier: { assertLease },
      callVerifier: { assertCallBinding },
      sourceAuthorizer: { assertAuthorized: vi.fn() },
      trackVerifier: { assertTrackBinding: vi.fn() },
      nowMs: 1_722_741_200_000,
    })).resolves.toEqual({
      uplinkSource: "translated_tts",
      trackSid: "track-1",
      trackName: input.trackName,
      publisherIdentity: "session-1:worker:translation",
      communicationSessionId: "session-1",
      targetParticipantIdentity: "session-1:guest:air:air-001",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
    });
    expect(assertLease).toHaveBeenCalledWith({
      deviceId: "air-001",
      leaseId: "lease-1",
      fencingToken: 7,
      nowMs: 1_722_741_200_000,
    });
    expect(assertCallBinding).toHaveBeenCalledWith(expect.objectContaining({
      communicationSessionId: "session-1",
      callGeneration: 3,
    }));
  });

  it.each([
    { roomName: "call_other" },
    { publisherIdentity: "session-2:worker:translation" },
    { targetParticipantIdentity: "session-1:guest:air:air-002" },
    { trackName: "translation-tts-host-24000.invalid" },
  ])("rejects an invalid binding before lease admission", async (override) => {
    const assertLease = vi.fn();
    await expect(createAirDeviceTrackAdmission({
      ...validInput(),
      ...override,
    }, {
      leaseVerifier: { assertLease },
      callVerifier: { assertCallBinding: vi.fn() },
      sourceAuthorizer: { assertAuthorized: vi.fn() },
      trackVerifier: { assertTrackBinding: vi.fn() },
      nowMs: 1_722_741_200_000,
    })).rejects.toThrow("Invalid Air device track admission");
    expect(assertLease).not.toHaveBeenCalled();
  });

  it("rejects an old fence", async () => {
    await expect(createAirDeviceTrackAdmission(validInput(), {
      leaseVerifier: {
        assertLease: () => {
          throw new DeviceLeaseConflict("stale");
        },
      },
      callVerifier: { assertCallBinding: vi.fn() },
      sourceAuthorizer: { assertAuthorized: vi.fn() },
      trackVerifier: { assertTrackBinding: vi.fn() },
      nowMs: 1_722_741_200_000,
    })).rejects.toThrow(DeviceLeaseConflict);
  });

  it("accepts the identity assigned by LiveKit Agents", async () => {
    const input = {
      ...validInput(),
      publisherIdentity: "translation-session-1-g3",
    };

    await expect(createAirDeviceTrackAdmission(input, {
      leaseVerifier: { assertLease: vi.fn() },
      callVerifier: { assertCallBinding: vi.fn() },
      sourceAuthorizer: { assertAuthorized: vi.fn() },
      trackVerifier: { assertTrackBinding: vi.fn() },
      nowMs: 1_722_741_200_000,
    })).resolves.toMatchObject({
      publisherIdentity: input.publisherIdentity,
      targetParticipantIdentity: input.targetParticipantIdentity,
    });
  });

  it("classifies only an exact accepted Host microphone as takeover media", async () => {
    const input = {
      ...validInput(),
      publisherIdentity: "session-1:host:user-1",
      trackName: "microphone",
    };

    await expect(createAirDeviceTrackAdmission(input, {
      leaseVerifier: { assertLease: vi.fn() },
      callVerifier: { assertCallBinding: vi.fn() },
      sourceAuthorizer: { assertAuthorized: vi.fn() },
      trackVerifier: { assertTrackBinding: vi.fn() },
      nowMs: 1_722_741_200_000,
    })).resolves.toMatchObject({
      uplinkSource: "takeover_microphone",
      publisherIdentity: input.publisherIdentity,
      trackName: "microphone",
    });
  });
});

function validInput() {
  const targetParticipantIdentity = "session-1:guest:air:air-001";
  const target = Buffer.from(targetParticipantIdentity).toString("base64url");
  return {
    communicationSessionId: "session-1",
    roomName: "call_session-1",
    deviceId: "air-001",
    leaseId: "lease-1",
    fencingToken: 7,
    callGeneration: 3,
    targetParticipantIdentity,
    trackSid: "track-1",
    trackName: `translation-tts-guest-24000.${target}`,
    publisherIdentity: "session-1:worker:translation",
  };
}
