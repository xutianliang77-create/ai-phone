import { randomUUID } from "node:crypto";
import {
  Room,
  RoomEvent,
  TrackKind,
  TrackSource,
  VideoBufferType,
  VideoStream,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type VideoFrame,
} from "@livekit/rtc-node";
import type {
  EnterpriseScreenOcrRuntimeClient,
  EnterpriseScreenOcrTicket,
} from "./enterprise-screen-ocr-runtime-client.js";
import {
  HttpScreenOcrProvider,
  ScreenOcrProviderError,
} from "../providers/http-screen-ocr-provider.js";

export class EnterpriseScreenOcrSource {
  private stopped = false;

  constructor(private readonly options: {
    room: Room;
    ticket: EnterpriseScreenOcrTicket;
    client: EnterpriseScreenOcrRuntimeClient;
    provider: HttpScreenOcrProvider;
    sampleIntervalMs: number;
    maxRawBytes: number;
  }) {}

  async run() {
    const publication = await waitForPublication(
      this.options.room, this.options.ticket,
    );
    publication.setSubscribed(true);
    const track = publication.track ?? await waitForTrack(
      this.options.room, this.options.ticket,
    );
    const stream = new VideoStream(track);
    const reader = stream.getReader();
    let lastSampleAt = 0;
    try {
      while (!this.stopped) {
        const next = await reader.read();
        if (next.done) break;
        const now = Date.now();
        if (now - lastSampleAt < this.options.sampleIntervalMs) continue;
        lastSampleAt = now;
        await this.process(next.value.frame, new Date(now));
      }
    } finally {
      publication.setSubscribed(false);
      await reader.cancel().catch(() => undefined);
    }
  }

  stop() { this.stopped = true; }

  private async process(frame: VideoFrame, capturedAt: Date) {
    const rgba = frame.convert(VideoBufferType.RGBA);
    if (rgba.data.byteLength > this.options.maxRawBytes) {
      throw new Error("Screen OCR frame exceeds configured memory boundary");
    }
    const perceptualHash = averageHash(rgba);
    const frameId = randomUUID();
    const claim = await this.options.client.claim({
      frameId, perceptualHash, sourceWidth: rgba.width,
      sourceHeight: rgba.height, capturedAt: capturedAt.toISOString(),
    });
    if (claim.status !== "claimed") return;
    try {
      const result = await this.options.provider.recognize({
        frame: rgba, targetLanguage: this.options.ticket.targetLanguage,
      });
      await this.options.client.complete({ frameId,
        providerFingerprint: result.fingerprint, blocks: result.blocks });
    } catch (error) {
      const reasonCode = error instanceof ScreenOcrProviderError
        ? error.reasonCode : "screen_ocr_worker_failed";
      await this.options.client.fail({ frameId, reasonCode }).catch(() => undefined);
      throw error;
    }
  }
}

function averageHash(frame: VideoFrame) {
  const luminance: number[] = [];
  for (let y = 0; y < 8; y++) {
    const sourceY = Math.min(frame.height - 1,
      Math.floor((y + 0.5) * frame.height / 8));
    for (let x = 0; x < 8; x++) {
      const sourceX = Math.min(frame.width - 1,
        Math.floor((x + 0.5) * frame.width / 8));
      const offset = (sourceY * frame.width + sourceX) * 4;
      luminance.push((frame.data[offset]! * 299 +
        frame.data[offset + 1]! * 587 + frame.data[offset + 2]! * 114) / 1000);
    }
  }
  const average = luminance.reduce((sum, value) => sum + value, 0) / 64;
  let result = "";
  for (let index = 0; index < 64; index += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit++) {
      if (luminance[index + bit]! >= average) nibble |= 1 << (3 - bit);
    }
    result += nibble.toString(16);
  }
  return result;
}

async function waitForPublication(room: Room, ticket: EnterpriseScreenOcrTicket) {
  const existing = publicationFor(room, ticket);
  if (existing) return existing;
  return waitFor<RemoteTrackPublication>(room, 20_000, (resolve) => {
    const inspect = (participant: RemoteParticipant) => {
      const publication = participant.trackPublications.get(ticket.trackSid);
      if (participant.identity === ticket.publisherIdentity &&
        validPublication(publication, ticket)) resolve(publication);
    };
    return [
      [RoomEvent.ParticipantConnected, inspect],
      [RoomEvent.TrackPublished, (publication: RemoteTrackPublication,
        participant: RemoteParticipant) => inspect(participant)],
    ];
  });
}

async function waitForTrack(room: Room, ticket: EnterpriseScreenOcrTicket) {
  return waitFor<RemoteTrack>(room, 20_000, (resolve) => [[
    RoomEvent.TrackSubscribed,
    (track: RemoteTrack, publication: RemoteTrackPublication,
      participant: RemoteParticipant) => {
      if (participant.identity === ticket.publisherIdentity &&
        validPublication(publication, ticket) && track.kind === TrackKind.KIND_VIDEO) {
        resolve(track);
      }
    },
  ]]);
}

function publicationFor(room: Room, ticket: EnterpriseScreenOcrTicket) {
  const publication = room.remoteParticipants.get(ticket.publisherIdentity)
    ?.trackPublications.get(ticket.trackSid);
  return validPublication(publication, ticket) ? publication : null;
}

function validPublication(
  publication: RemoteTrackPublication | undefined,
  ticket: EnterpriseScreenOcrTicket,
): publication is RemoteTrackPublication {
  return Boolean(publication && publication.sid === ticket.trackSid &&
    publication.source === TrackSource.SOURCE_SCREENSHARE &&
    publication.kind === TrackKind.KIND_VIDEO);
}

function waitFor<T>(
  room: Room,
  timeoutMs: number,
  listeners: (resolve: (value: T) => void) => Array<[RoomEvent, (...args: any[]) => void]>,
) {
  return new Promise<T>((resolve, reject) => {
    let handlers: Array<[RoomEvent, (...args: any[]) => void]> = [];
    const finish = (value: T) => { cleanup(); resolve(value); };
    const timer = setTimeout(() => {
      cleanup(); reject(new Error("Screen OCR track authorization timed out"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      for (const [event, handler] of handlers) room.off(event, handler);
    };
    handlers = listeners(finish);
    for (const [event, handler] of handlers) room.on(event, handler);
  });
}
