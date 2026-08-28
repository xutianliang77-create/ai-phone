import { describe, expect, it, vi } from "vitest";
import { LiveKitCallTrackLifecycle } from
  "./livekit-call-track-lifecycle.js";

describe("LiveKit call input track lifecycle", () => {
  it("subscribes only after exact server admission and reuses it for the track", async () => {
    const authorizeTrack = vi.fn(async () => ({ speakerRole: "guest" as const }));
    const lifecycle = new LiveKitCallTrackLifecycle({
      callId: "call-1",
      access: { authorizeTrack },
    });
    lifecycle.bindWorker("call-1:worker:translation-1", 4);
    const publication = publishedTrack();
    const participant = { identity: "call-1:guest:air:air-780-1" };
    const { rtc, RemoteAudioTrack } = fakeRtc();

    await lifecycle.subscribePublication(publication, participant, rtc);
    await expect(lifecycle.acceptSubscribedTrack(
      new RemoteAudioTrack(),
      publication,
      participant,
      rtc,
    )).resolves.toBe("guest");

    expect(authorizeTrack).toHaveBeenCalledOnce();
    expect(authorizeTrack).toHaveBeenCalledWith("call-1", {
      workerIdentity: "call-1:worker:translation-1",
      dispatchGeneration: 4,
      participantIdentity: "call-1:guest:air:air-780-1",
      trackSid: "TR_air_1",
      trackName: "air780-downlink-air-780-1",
    });
    expect(publication.setSubscribed).toHaveBeenCalledWith(true);
  });

  it("actively unsubscribes a forged or stale same-role track", async () => {
    const events: unknown[] = [];
    const lifecycle = new LiveKitCallTrackLifecycle({
      callId: "call-1",
      access: {
        authorizeTrack: async () => { throw new Error("stale binding"); },
      },
      observer: (event) => events.push(event),
    });
    lifecycle.bindWorker("call-1:worker:translation-1", 5);
    const publication = publishedTrack();
    const participant = { identity: "call-1:guest:air:forged" };
    const { rtc, RemoteAudioTrack } = fakeRtc();

    await lifecycle.subscribePublication(publication, participant, rtc);
    await expect(lifecycle.acceptSubscribedTrack(
      new RemoteAudioTrack(), publication, participant, rtc,
    )).resolves.toBeNull();

    expect(publication.setSubscribed).toHaveBeenCalledWith(false);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: "ignored_binding" }),
    ]));
  });

  it("forgets admission when the publication disappears", async () => {
    const authorizeTrack = vi.fn(async () => ({ speakerRole: "host" as const }));
    const lifecycle = new LiveKitCallTrackLifecycle({
      callId: "call-1",
      access: { authorizeTrack },
    });
    lifecycle.bindWorker("worker-1");
    const publication = publishedTrack();
    const participant = { identity: "host-1" };
    const { rtc } = fakeRtc();

    await lifecycle.subscribePublication(publication, participant, rtc);
    lifecycle.forgetPublication(publication);
    await lifecycle.subscribePublication(publication, participant, rtc);

    expect(authorizeTrack).toHaveBeenCalledTimes(2);
  });
});

function publishedTrack() {
  return {
    sid: "TR_air_1",
    name: "air780-downlink-air-780-1",
    setSubscribed: vi.fn(),
  };
}

function fakeRtc() {
  class RemoteAudioTrack {}
  return {
    RemoteAudioTrack,
    rtc: {
      RemoteAudioTrack,
      Room: class {},
      RoomEvent: { TrackSubscribed: "trackSubscribed", Disconnected: "disconnected" },
      AudioStream: class {},
    } as never,
  };
}
