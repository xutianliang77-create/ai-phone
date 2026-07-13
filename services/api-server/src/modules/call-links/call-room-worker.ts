import { DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import { upsertSegment } from "../sessions/sessions.repository.js";
import type { CallLinkRecord } from "./call-links.service.js";
import {
  buildCallRoomSmokeEvents,
  callRoomCaptionTopic,
  encodeCallRoomEvent,
  type CallRoomDataEvent,
} from "./call-room-events.js";
import { getLiveKitRoomConfig, type LiveKitRoomConfig } from "./call-room-readiness.js";

export interface CallRoomDataPublisher {
  ensureRoom?(roomName: string): Promise<void>;
  publish(roomName: string, event: CallRoomDataEvent): Promise<void>;
}

let testPublisher: CallRoomDataPublisher | null = null;

export function setCallRoomDataPublisherForTests(
  publisher: CallRoomDataPublisher | null,
) {
  testPublisher = publisher;
}

export async function publishCallRoomSmokeCaptions(record: CallLinkRecord):
  Promise<
    | { ok: true; roomName: string; topic: string; events: CallRoomDataEvent[] }
    | { ok: false; issues: string[] }
  > {
  return publishCallRoomDataEvents(
    record,
    buildCallRoomSmokeEvents({
      callId: record.callId,
      roomName: record.roomName,
    }),
  );
}

export async function ensureCallRoom(
  record: CallLinkRecord,
): Promise<{ ok: true; roomName: string } | { ok: false; issues: string[] }> {
  const config = getLiveKitRoomConfig();
  if (!config.ok) return { ok: false, issues: config.issues };
  const publisher =
    testPublisher ?? new LiveKitRoomDataPublisher(config.config);
  try {
    await publisher.ensureRoom?.(record.roomName);
    return { ok: true, roomName: record.roomName };
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function publishCallRoomDataEvents(
  record: CallLinkRecord,
  events: CallRoomDataEvent[],
):
  Promise<
    | { ok: true; roomName: string; topic: string; events: CallRoomDataEvent[] }
    | { ok: false; issues: string[] }
  > {
  const config = getLiveKitRoomConfig();
  if (!config.ok) return { ok: false, issues: config.issues };

  const publisher = testPublisher ?? new LiveKitRoomDataPublisher(config.config);
  await publisher.ensureRoom?.(record.roomName);
  for (const event of events) {
    await publisher.publish(record.roomName, event);
    persistCallRoomDataEvent(record, event);
  }
  return {
    ok: true,
    roomName: record.roomName,
    topic: callRoomCaptionTopic,
    events,
  };
}

export function persistCallRoomDataEvent(
  record: CallLinkRecord,
  event: CallRoomDataEvent,
) {
  if (event.type === "worker.status") return null;
  return upsertSegment(record.sessionId, {
    segmentId: event.segmentId,
    sourceText: event.sourceText ?? (
      event.type === "transcript.final" ? event.text : undefined
    ),
    translatedText: event.translatedText ?? (
      event.type === "translation.final" ? event.text : undefined
    ),
    speaker: event.speaker,
    timing: {
      startMs: event.timestampMs,
      endMs: event.timestampMs,
      source: "participant_track",
    },
  });
}

class LiveKitRoomDataPublisher implements CallRoomDataPublisher {
  private readonly client: RoomServiceClient;
  private readonly ensuredRooms = new Set<string>();

  constructor(config: LiveKitRoomConfig) {
    this.client = new RoomServiceClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
    );
  }

  async ensureRoom(roomName: string) {
    if (this.ensuredRooms.has(roomName)) return;
    try {
      await this.client.createRoom({
        name: roomName,
        emptyTimeout: 300,
        maxParticipants: 16,
      });
    } catch (error) {
      if (!isLiveKitAlreadyExistsError(error)) throw error;
    }
    this.ensuredRooms.add(roomName);
  }

  async publish(roomName: string, event: CallRoomDataEvent) {
    await this.client.sendData(
      roomName,
      encodeCallRoomEvent(event),
      DataPacket_Kind.RELIABLE,
      { topic: callRoomCaptionTopic },
    );
  }
}

export function liveKitApiUrl(livekitUrl: string) {
  const url = new URL(livekitUrl);
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol === "ws:") url.protocol = "http:";
  return url.toString().replace(/\/$/, "");
}

export function isLiveKitAlreadyExistsError(error: unknown) {
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  return candidate.code === "already_exists" ||
    candidate.status === 409 ||
    (
      typeof candidate.message === "string" &&
      candidate.message.toLowerCase().includes("already exists")
    );
}
