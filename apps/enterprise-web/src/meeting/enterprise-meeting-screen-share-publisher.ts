import type { Room } from "livekit-client";
import type {
  EnterpriseMeetingScreenShareGrant,
  EnterpriseMeetingScreenShareQuality,
  EnterpriseMeetingScreenShareSource,
} from "@translation/contracts";

export interface EnterpriseScreenCapture {
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  audioTrack: MediaStreamTrack | null;
  sourceType: EnterpriseMeetingScreenShareSource;
  includesSystemAudio: boolean;
}

export class EnterpriseMeetingScreenSharePublisher {
  private room: Room | null = null;
  private publishedTracks: MediaStreamTrack[] = [];

  async capture(
    quality: EnterpriseMeetingScreenShareQuality,
    includesSystemAudio: boolean,
  ): Promise<EnterpriseScreenCapture> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("screen_capture_unsupported");
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints(quality),
      audio: includesSystemAudio,
    });
    const videoTrack = stream.getVideoTracks()[0];
    if (!includesSystemAudio) {
      stream.getAudioTracks().forEach((track) => {
        stream.removeTrack(track); track.stop();
      });
    }
    const audioTrack = includesSystemAudio ? stream.getAudioTracks()[0] ?? null : null;
    if (!videoTrack) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw new Error("screen_capture_missing_video");
    }
    if (includesSystemAudio && !audioTrack) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw new Error("screen_capture_audio_unavailable");
    }
    const sourceType = screenShareSource(videoTrack.getSettings().displaySurface);
    if (!sourceType) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw new Error("screen_capture_source_unknown");
    }
    return {
      stream, videoTrack, audioTrack, sourceType,
      includesSystemAudio: audioTrack !== null,
    };
  }

  async publish(grant: EnterpriseMeetingScreenShareGrant, capture: EnterpriseScreenCapture) {
    await this.disconnect();
    if (grant.capabilities.screenShareAudio !== capture.includesSystemAudio) {
      throw new Error("screen_share_grant_mismatch");
    }
    const { Room, Track } = await import("livekit-client");
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    try {
      await room.connect(grant.rtcUrl, grant.accessToken, { autoSubscribe: false });
      this.publishedTracks.push(capture.videoTrack);
      const publication = await room.localParticipant.publishTrack(capture.videoTrack, {
        source: Track.Source.ScreenShare,
        name: `enterprise-screen-g${grant.generation}`,
        stream: grant.publisherIdentity,
      });
      if (capture.audioTrack) {
        this.publishedTracks.push(capture.audioTrack);
        await room.localParticipant.publishTrack(capture.audioTrack, {
          source: Track.Source.ScreenShareAudio,
          name: `enterprise-screen-audio-g${grant.generation}`,
          stream: grant.publisherIdentity,
        });
      }
      return publication.trackSid;
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect() {
    const room = this.room;
    const tracks = this.publishedTracks;
    this.room = null;
    this.publishedTracks = [];
    if (!room) return;
    try {
      await Promise.all(tracks.map((track) =>
        room.localParticipant.unpublishTrack(track, false)));
    } catch {
      // Disconnecting the room below still revokes the local publisher transport.
    } finally {
      room.removeAllListeners();
      await room.disconnect(false).catch(() => undefined);
    }
  }

  async unpublishAudio(track: MediaStreamTrack) {
    this.publishedTracks = this.publishedTracks.filter((candidate) => candidate !== track);
    await this.room?.localParticipant.unpublishTrack(track, false).catch(() => undefined);
  }

  degradeSystemAudio(capture: EnterpriseScreenCapture) {
    const track = capture.audioTrack;
    if (!track) return false;
    capture.audioTrack = null;
    capture.stream.removeTrack(track);
    void this.unpublishAudio(track);
    return true;
  }
}

export const enterpriseScreenCaptureReady = (capture: EnterpriseScreenCapture) =>
  capture.videoTrack.readyState === "live" &&
  (!capture.audioTrack || capture.audioTrack.readyState === "live");

export const enterpriseScreenShareDelay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function enterpriseScreenShareErrorCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? error.code : null;
  if (typeof code === "string" && /^[a-z0-9_]{1,120}$/.test(code)) return code;
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "screen_capture_not_allowed";
  }
  return error instanceof Error && /^[a-z0-9_]{1,120}$/.test(error.message)
    ? error.message : "screen_share_request_failed";
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
