import { describe, expect, it, vi } from "vitest";
import { TrackSource, TrackType } from "livekit-server-sdk";
import { LiveKitInputTrackBindingVerifier } from
  "./livekit-input-track-binding.js";

describe("LiveKit input track binding verifier", () => {
  it("requires the exact identity, SID, name, audio type, and mic source", async () => {
    const participant = {
      identity: "call-1:guest:air:air-780-1",
      metadata: "{}",
      attributes: {},
      tracks: [{
        sid: "TR_air_1",
        name: "air780-downlink-air-780-1",
        type: TrackType.AUDIO,
        source: TrackSource.MICROPHONE,
      }],
    };
    const listParticipants = vi.fn(async () => [participant]);
    const verifier = new LiveKitInputTrackBindingVerifier(config, {
      listParticipants,
    });

    await expect(verifier.resolve({
      roomName: "call_call-1",
      participantIdentity: participant.identity,
      trackSid: "TR_air_1",
      trackName: "air780-downlink-air-780-1",
    })).resolves.toEqual({ participant, track: participant.tracks[0] });
    expect(listParticipants).toHaveBeenCalledWith("call_call-1");
  });

  it("rejects a same-name track from another participant", async () => {
    const verifier = new LiveKitInputTrackBindingVerifier(config, {
      listParticipants: async () => [{
        identity: "call-1:guest:air:forged",
        metadata: "{}",
        attributes: {},
        tracks: [{
          sid: "TR_air_1",
          name: "air780-downlink-air-780-1",
          type: TrackType.AUDIO,
          source: TrackSource.MICROPHONE,
        }],
      }],
    });
    await expect(verifier.resolve({
      roomName: "call_call-1",
      participantIdentity: "call-1:guest:air:air-780-1",
      trackSid: "TR_air_1",
      trackName: "air780-downlink-air-780-1",
    })).rejects.toThrow("binding not found");
  });
});

const config = {
  livekitUrl: "wss://livekit.example.cn",
  apiKey: "key",
  apiSecret: "secret",
  tokenTtlSeconds: 120,
};
