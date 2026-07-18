import type { Room } from "livekit-client";
import type {
  EnterpriseMeetingScreenShareGrant,
  EnterpriseMeetingScreenShareQuality,
  EnterpriseMeetingScreenShareSource,
} from "@translation/contracts";

export interface EnterpriseScreenCapture {
  stream: MediaStream;
  track: MediaStreamTrack;
  sourceType: EnterpriseMeetingScreenShareSource;
}

export class EnterpriseMeetingScreenSharePublisher {
  private room: Room | null = null;
  private publishedTrack: MediaStreamTrack | null = null;

  async capture(
    quality: EnterpriseMeetingScreenShareQuality,
  ): Promise<EnterpriseScreenCapture> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("screen_capture_unsupported");
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints(quality),
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw new Error("screen_capture_missing_video");
    }
    const sourceType = screenShareSource(track.getSettings().displaySurface);
    if (!sourceType) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw new Error("screen_capture_source_unknown");
    }
    return { stream, track, sourceType };
  }

  async publish(grant: EnterpriseMeetingScreenShareGrant, track: MediaStreamTrack) {
    await this.disconnect();
    const { Room, Track } = await import("livekit-client");
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    try {
      await room.connect(grant.rtcUrl, grant.accessToken, { autoSubscribe: false });
      const publication = await room.localParticipant.publishTrack(track, {
        source: Track.Source.ScreenShare,
        name: `enterprise-screen-g${grant.generation}`,
        stream: grant.publisherIdentity,
      });
      this.publishedTrack = track;
      return publication.trackSid;
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect() {
    const room = this.room;
    const track = this.publishedTrack;
    this.room = null;
    this.publishedTrack = null;
    if (!room) return;
    try {
      if (track) await room.localParticipant.unpublishTrack(track, false);
    } catch {
      // Disconnecting the room below still revokes the local publisher transport.
    } finally {
      room.removeAllListeners();
      await room.disconnect(false).catch(() => undefined);
    }
  }
}

function videoConstraints(
  quality: EnterpriseMeetingScreenShareQuality,
): boolean | MediaTrackConstraints {
  if (quality === "auto") return true;
  if (quality === "smooth") {
    return {
      width: { ideal: 1_920, max: 1_920 },
      height: { ideal: 1_080, max: 1_080 },
      frameRate: { ideal: 30, max: 30 },
    };
  }
  return {
    width: { ideal: 2_560, max: 3_840 },
    height: { ideal: 1_440, max: 2_160 },
    frameRate: { ideal: 15, max: 30 },
  };
}

function screenShareSource(
  value: MediaTrackSettings["displaySurface"],
): EnterpriseMeetingScreenShareSource | null {
  if (value === "monitor") return "screen";
  if (value === "window") return "window";
  if (value === "browser") return "tab";
  return null;
}
