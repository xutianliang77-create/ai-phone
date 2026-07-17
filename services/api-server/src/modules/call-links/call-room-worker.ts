import type { CallLinkRecord } from "./call-links.service.js";
import {
  buildCallRoomSmokeEvents,
  callRoomCaptionTopic,
  encodeCallRoomEvent,
  type CallRoomDataEvent,
} from "./call-room-events.js";
import { getLiveKitRoomConfig, type LiveKitRoomConfig } from "./call-room-readiness.js";
import {
  completeCallRoomDataEvent,
  failCallRoomDataEvent,
  pendingCallRoomDataEvents,
  stageCallRoomDataEvents,
} from "./call-room-reliable-events.js";
import { LiveKitRoomProviderAdapter } from "./livekit-room-provider-adapter.js";
export {
  isLiveKitAlreadyExistsError,
  liveKitApiUrl,
} from "./livekit-room-provider-adapter.js";
export { persistCallRoomDataEvent } from "./call-room-event-persistence.js";

export interface CallRoomDataPublisher {
  ensureRoom?(roomName: string): Promise<void>;
  hasParticipant?(roomName: string, participantIdentity: string): Promise<boolean>;
  listParticipantIdentities?(roomName: string): Promise<string[]>;
  publish(roomName: string, event: CallRoomDataEvent): Promise<void>;
}

export interface CallRoomHumanPresence {
  activeHostCount: number;
  activeGuestCount: number;
  activeHumanParticipantCount: number;
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

export async function confirmCallRoomParticipant(
  record: CallLinkRecord,
  participantIdentity: string,
): Promise<{ ok: true; connected: boolean } | { ok: false; issues: string[] }> {
  const config = getLiveKitRoomConfig();
  if (!config.ok) return { ok: false, issues: config.issues };
  const publisher = testPublisher ?? new LiveKitRoomDataPublisher(config.config);
  if (!publisher.hasParticipant) return { ok: true, connected: true };
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (await publisher.hasParticipant(record.roomName, participantIdentity)) {
        return { ok: true, connected: true };
      }
      if (attempt < 3) await delay(75);
    }
    return { ok: true, connected: false };
  } catch (error) {
    return { ok: false, issues: [errorMessage(error)] };
  }
}

export async function readCallRoomHumanPresence(
  record: CallLinkRecord,
): Promise<
  | { ok: true; presence: CallRoomHumanPresence }
  | { ok: false; issues: string[] }
> {
  const config = getLiveKitRoomConfig();
  if (!config.ok) return { ok: false, issues: config.issues };
  const publisher = testPublisher ?? new LiveKitRoomDataPublisher(config.config);
  if (!publisher.listParticipantIdentities) {
    return { ok: false, issues: ["Call room presence is unavailable"] };
  }
  try {
    const identities = await publisher.listParticipantIdentities(record.roomName);
    const roles = identities
      .map((identity) => callRoomParticipantRole(record.callId, identity))
      .filter((role): role is "host" | "guest" => role !== null);
    const activeHostCount = roles.filter((role) => role === "host").length;
    const activeGuestCount = roles.filter((role) => role === "guest").length;
    return {
      ok: true,
      presence: {
        activeHostCount,
        activeGuestCount,
        activeHumanParticipantCount: activeHostCount + activeGuestCount,
      },
    };
  } catch (error) {
    return { ok: false, issues: [errorMessage(error)] };
  }
}

export async function publishCallRoomDataEvents(
  record: CallLinkRecord,
  events: CallRoomDataEvent[],
  options: { expectedVersion?: number } = {},
):
  Promise<
    | {
      ok: true;
      roomName: string;
      topic: string;
      events: CallRoomDataEvent[];
      duplicateCount: number;
      sessionVersion: number;
    }
    | { ok: false; issues: string[]; sessionVersion: number }
  > {
  const staged = await stageCallRoomDataEvents({
    record,
    events,
    expectedVersion: options.expectedVersion,
  });
  const delivered = await deliverPendingCallRoomDataEvents(record);
  if (!delivered.ok) {
    return { ...delivered, sessionVersion: staged.sessionVersion };
  }
  return {
    ok: true,
    roomName: record.roomName,
    topic: callRoomCaptionTopic,
    events,
    duplicateCount: staged.duplicateCount,
    sessionVersion: staged.sessionVersion,
  };
}

export async function deliverPendingCallRoomDataEvents(
  record: CallLinkRecord,
  now?: Date,
) {
  const config = getLiveKitRoomConfig();
  if (!config.ok) return { ok: false as const, issues: config.issues };

  const publisher = testPublisher ?? new LiveKitRoomDataPublisher(config.config);
  try {
    await publisher.ensureRoom?.(record.roomName);
  } catch (error) {
    return { ok: false as const, issues: [errorMessage(error)] };
  }
  for (const pending of pendingCallRoomDataEvents(record.sessionId, now)) {
    try {
      await publisher.publish(record.roomName, pending.event);
      completeCallRoomDataEvent(pending.record.idempotencyKey);
    } catch (error) {
      failCallRoomDataEvent(pending.record.idempotencyKey, error);
      return { ok: false as const, issues: [errorMessage(error)] };
    }
  }
  return {
    ok: true as const,
    roomName: record.roomName,
    topic: callRoomCaptionTopic,
  };
}

class LiveKitRoomDataPublisher implements CallRoomDataPublisher {
  private readonly adapter: LiveKitRoomProviderAdapter;

  constructor(config: LiveKitRoomConfig) {
    this.adapter = new LiveKitRoomProviderAdapter(config);
  }

  async ensureRoom(roomName: string) {
    const result = await this.adapter.ensureRoom({
      operationId: `room:ensure:${roomName}`,
      sessionId: roomName.replace(/^call_/, ""),
      expectedVersion: 1,
      idempotencyKey: `room:ensure:${roomName}`,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      payload: { roomName },
    });
    if (!result.ok) throw new Error(`LiveKit room ensure failed: ${result.errorClass}`);
  }

  async hasParticipant(roomName: string, participantIdentity: string) {
    return this.adapter.hasParticipant(roomName, participantIdentity);
  }

  async listParticipantIdentities(roomName: string) {
    return this.adapter.listParticipantIdentities(roomName);
  }

  async publish(roomName: string, event: CallRoomDataEvent) {
    const data = encodeCallRoomEvent(event);
    const config = getLiveKitRoomConfig();
    if (!config.ok || data.byteLength > config.config.resourceLimits.maxDataPacketBytes) {
      throw new Error("Call room data packet exceeds the configured limit");
    }
    await this.adapter.publish(roomName, data, callRoomCaptionTopic);
  }
}

function callRoomParticipantRole(callId: string, identity: string) {
  const [identityCallId, role] = identity.split(":", 3);
  if (identityCallId !== callId) return null;
  return role === "host" || role === "guest" ? role : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
