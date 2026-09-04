import { describe, expect, it, vi } from "vitest";
import { TrackSource, TrackType } from "livekit-server-sdk";
import { LiveKitAirTrackBindingVerifier } from
  "./livekit-air-track-binding-verifier.js";

describe("LiveKit Air uplink track binding verifier", () => {
  it("accepts only the exact audio microphone track and Air target", async () => {
    const listParticipants = vi.fn(async () => [{
      identity: input.publisherIdentity,
      tracks: [{
        sid: input.trackSid,
        name: input.trackName,
        type: TrackType.AUDIO,
        source: TrackSource.MICROPHONE,
      }],
    }, {
      identity: input.targetParticipantIdentity,
      tracks: [],
    }]);
    const verifier = new LiveKitAirTrackBindingVerifier(config, {
      listParticipants,
    });

    await expect(verifier.assertTrackBinding({
      ...input,
      uplinkSource: "takeover_microphone",
    })).resolves.toBeUndefined();
  });

  it.each([
    ["wrong source", TrackType.AUDIO, TrackSource.SCREEN_SHARE_AUDIO],
    ["video track", TrackType.VIDEO, TrackSource.CAMERA],
  ])("rejects a %s", async (_label, type, source) => {
    const verifier = new LiveKitAirTrackBindingVerifier(config, {
      listParticipants: vi.fn(async () => [{
        identity: input.publisherIdentity,
        tracks: [{ sid: input.trackSid, name: input.trackName, type, source }],
      }, { identity: input.targetParticipantIdentity, tracks: [] }]),
    });

    await expect(verifier.assertTrackBinding({
      ...input,
      uplinkSource: "takeover_microphone",
    })).rejects.toThrow("audio track binding not found");
  });

  it("retries a publication race without widening the binding", async () => {
    const listParticipants = vi.fn()
      .mockResolvedValueOnce([{ identity: input.targetParticipantIdentity, tracks: [] }])
      .mockResolvedValueOnce([{
        identity: input.publisherIdentity,
        tracks: [{
          sid: input.trackSid,
          name: input.trackName,
          type: TrackType.AUDIO,
          source: TrackSource.MICROPHONE,
        }],
      }, { identity: input.targetParticipantIdentity, tracks: [] }]);
    const verifier = new LiveKitAirTrackBindingVerifier(config, {
      listParticipants,
    });

    await verifier.assertTrackBinding({
      ...input,
      uplinkSource: "takeover_microphone",
    });
    expect(listParticipants).toHaveBeenCalledTimes(2);
  });
});

const config = {
  livekitUrl: "wss://livekit.example.cn",
  apiKey: "api-key",
  apiSecret: "api-secret",
  tokenTtlSeconds: 120,
  resourceLimits: {
    guestTicketTtlSeconds: 300,
    maxParticipants: 8,
    maxSessionSeconds: 3_600,
    maxDataPacketBytes: 12_288,
    emptyTimeoutSeconds: 300,
    maxEventsPerRequest: 20,
    maxEventRequestsPerSecond: 40,
    maxParticipantNameCharacters: 80,
  },
};

const input = {
  communicationSessionId: "comm-1",
  roomName: "call_comm-1",
  deviceId: "air-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
  targetParticipantIdentity: "comm-1:guest:air:air-1",
  trackSid: "TR_host_1",
  trackName: "microphone",
  publisherIdentity: "comm-1:host:user-1",
};
