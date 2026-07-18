import type { ConnectionState, Room } from "livekit-client";
import type {
  EnterpriseMeetingCaptionEvent,
  EnterpriseMeetingJoinTokenResponse,
} from "@translation/contracts";

export interface EnterpriseMeetingRoomSnapshot {
  status: "disconnected" | "connecting" | "connected" | "reconnecting";
  microphoneEnabled: boolean;
  remoteParticipantCount: number;
  translationStatus: "ready" | "captions_only" | "not_ready";
  translationReasonCode: string;
  captionLanguage: "zh" | "en";
  translatedAudioEnabled: boolean;
  translatedAudioAvailable: boolean;
  captions: EnterpriseMeetingCaptionEvent[];
}

export class EnterpriseMeetingRoomClient {
  private room: Room | null = null;
  private snapshot: EnterpriseMeetingRoomSnapshot = {
    status: "disconnected",
    microphoneEnabled: false,
    remoteParticipantCount: 0,
    translationStatus: "not_ready",
    translationReasonCode: "not_joined",
    captionLanguage: "zh",
    translatedAudioEnabled: false,
    translatedAudioAvailable: false,
    captions: [],
  };
  private grant: EnterpriseMeetingJoinTokenResponse | null = null;
  private readonly seenEventIds = new Set<string>();

  constructor(
    private readonly onSnapshot: (value: EnterpriseMeetingRoomSnapshot) => void,
  ) {}

  async connect(grant: EnterpriseMeetingJoinTokenResponse) {
    await this.disconnect();
    this.grant = grant;
    this.seenEventIds.clear();
    this.emit({
      status: "connecting",
      translationStatus: grant.translation.status,
      translationReasonCode: grant.translation.reasonCode,
      captionLanguage: grant.translation.captionLanguage,
      translatedAudioEnabled: grant.translation.translatedAudioEnabled,
      translatedAudioAvailable: grant.translation.translatedAudioAvailable,
      captions: [],
    });
    const { Room, RoomEvent } = await import("livekit-client");
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    room
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        this.emit({ status: connectionStatus(state) });
      })
      .on(RoomEvent.ParticipantConnected, () => this.syncParticipants())
      .on(RoomEvent.ParticipantDisconnected, () => this.syncParticipants())
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        this.acceptCaption(payload, participant, topic);
      })
      .on(RoomEvent.Disconnected, () => {
        this.emit({
          status: "disconnected",
          microphoneEnabled: false,
          remoteParticipantCount: 0,
        });
      });
    try {
      await room.connect(grant.rtcUrl, grant.accessToken, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);
      this.emit({
        status: "connected",
        microphoneEnabled: room.localParticipant.isMicrophoneEnabled,
        remoteParticipantCount: room.remoteParticipants.size,
      });
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async setMicrophoneEnabled(enabled: boolean) {
    const room = this.room;
    if (!room || String(room.state) !== "connected") return;
    await room.localParticipant.setMicrophoneEnabled(enabled);
    this.emit({ microphoneEnabled: room.localParticipant.isMicrophoneEnabled });
  }

  async disconnect() {
    const room = this.room;
    this.room = null;
    this.grant = null;
    this.seenEventIds.clear();
    if (room) {
      room.removeAllListeners();
      await room.disconnect();
    }
    this.emit({
      status: "disconnected",
      microphoneEnabled: false,
      remoteParticipantCount: 0,
      translationStatus: "not_ready",
      translationReasonCode: "not_joined",
      translatedAudioEnabled: false,
      translatedAudioAvailable: false,
      captions: [],
    });
  }

  private syncParticipants() {
    if (this.room) {
      this.emit({ remoteParticipantCount: this.room.remoteParticipants.size });
    }
  }

  private acceptCaption(
    payload: Uint8Array,
    participant: unknown,
    topic: string | undefined,
  ) {
    const grant = this.grant;
    if (!grant || participant || topic !== grant.translation.topic ||
      payload.byteLength > 12_000) return;
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    const event = validateCaption(value, grant);
    if (!event || this.seenEventIds.has(event.eventId)) return;
    this.seenEventIds.add(event.eventId);
    if (this.seenEventIds.size > 200) {
      const oldest = this.seenEventIds.values().next().value;
      if (oldest) this.seenEventIds.delete(oldest);
    }
    this.emit({ captions: [...this.snapshot.captions, event].slice(-50) });
  }

  private emit(value: Partial<EnterpriseMeetingRoomSnapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    this.onSnapshot(this.snapshot);
  }
}

function validateCaption(
  value: unknown,
  grant: EnterpriseMeetingJoinTokenResponse,
): EnterpriseMeetingCaptionEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<EnterpriseMeetingCaptionEvent>;
  const audio = event.translatedAudio;
  const occurredAt = typeof event.occurredAt === "string"
    ? Date.parse(event.occurredAt) : Number.NaN;
  const expectedLanguage = event.type === "transcript.final"
    ? event.sourceLanguage : event.targetLanguage;
  if (event.v !== 1 || !uuid(event.eventId) ||
    !["transcript.final", "translation.final"].includes(String(event.type)) ||
    event.meetingId !== grant.meetingId ||
    event.communicationSessionId !== grant.communicationSessionId ||
    event.targetParticipantId !== grant.participantId ||
    event.generation !== grant.translation.generation ||
    expectedLanguage !== grant.translation.captionLanguage ||
    !uuid(event.sourceParticipantId) || !bounded(event.sourceDisplayName, 120) ||
    !bounded(event.sourceTrackSid, 128) || !bounded(event.segmentId, 160) ||
    !Number.isSafeInteger(event.revision) || Number(event.revision) < 0 ||
    !["zh", "en"].includes(String(event.sourceLanguage)) ||
    !["zh", "en"].includes(String(event.targetLanguage)) ||
    event.sourceLanguage === event.targetLanguage ||
    !bounded(event.sourceText, 4_000) || !bounded(event.text, 4_000) ||
    event.final !== true || event.translated !== (event.type === "translation.final") ||
    !Number.isFinite(occurredAt) || !audio ||
    audio.playbackGeneration !== grant.translation.playbackGeneration ||
    typeof audio.enabled !== "boolean" || audio.available !== false ||
    !["disabled", "not_ready"].includes(String(audio.status))) return null;
  return event as EnterpriseMeetingCaptionEvent;
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maximum;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function connectionStatus(state: ConnectionState): EnterpriseMeetingRoomSnapshot["status"] {
  if (String(state) === "connected") return "connected";
  if (String(state) === "reconnecting") return "reconnecting";
  if (String(state) === "connecting") return "connecting";
  return "disconnected";
}
