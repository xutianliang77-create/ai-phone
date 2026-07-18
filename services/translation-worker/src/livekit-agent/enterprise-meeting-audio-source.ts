import type { CallRoomSubmittedEvent } from "@translation/contracts";
import { buildDefaultWorker } from "../main.js";
import { deferred, isRemoteAudioTrack, shouldForwardAudioTrack } from
  "../worker/livekit-call-audio-utils.js";
import { LiveKitCallAudioTrackRuntime } from
  "../worker/livekit-call-audio-track-runtime.js";
import type {
  RtcNodeModule,
  RtcRoom,
} from "../worker/livekit-call-audio-source-types.js";
import type { CallRoomEventSink } from "../worker/types.js";
import {
  EnterpriseMeetingRuntimeClient,
  type EnterpriseMeetingWorkerCaptionInput,
  type EnterpriseMeetingWorkerSnapshot,
} from "./enterprise-meeting-runtime-client.js";

interface EnterpriseRtcNodeModule extends RtcNodeModule {
  RoomEvent: RtcNodeModule["RoomEvent"] & { TrackUnsubscribed?: string };
}

export class EnterpriseMeetingAudioSource {
  private readonly disconnected = deferred<void>();
  private readonly tracks = new Map<unknown, LiveKitCallAudioTrackRuntime>();
  private readonly tasks = new Set<Promise<void>>();
  private stopped = false;

  constructor(private readonly options: {
    room: RtcRoom;
    rtc: EnterpriseRtcNodeModule;
    snapshot: EnterpriseMeetingWorkerSnapshot;
    client: EnterpriseMeetingRuntimeClient;
    sampleRate: 16000 | 24000;
    frameSizeMs: number;
    capacityFrames: number;
    maxTracks: number;
    onError?: (error: unknown) => void;
  }) {}

  start() {
    const { room, rtc } = this.options;
    room.on(rtc.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      void this.addTrack(track, publication, participant);
    }).on(rtc.RoomEvent.Disconnected, () => {
      void this.stop();
    });
    if (rtc.RoomEvent.TrackUnsubscribed) {
      room.on(rtc.RoomEvent.TrackUnsubscribed, (track) => this.removeTrack(track));
    }
    for (const participant of participants(room)) {
      for (const publication of publications(participant)) {
        if (publication.track) {
          void this.addTrack(publication.track, publication, participant);
        }
      }
    }
  }

  waitUntilDisconnected() {
    return this.disconnected.promise;
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const runtime of this.tracks.values()) runtime.stop(true);
    await Promise.allSettled([...this.tasks]);
    this.tracks.clear();
    this.disconnected.resolve();
  }

  private async addTrack(
    track: unknown,
    publication: unknown,
    participant: unknown,
  ) {
    if (this.stopped || this.tracks.has(track) ||
      this.tracks.size >= this.options.maxTracks ||
      !shouldForwardAudioTrack(track, publication) ||
      !isRemoteAudioTrack(track, this.options.rtc.RemoteAudioTrack)) return;
    const identity = enterpriseParticipant(participant);
    const trackSid = publicationSid(publication);
    if (!identity || !trackSid) return;
    const callId = `meeting:${identity.participantId}:${trackSid}`;
    const eventSink = meetingEventSink({
      client: this.options.client,
      sourceParticipantId: identity.participantId,
      sourceTrackSid: trackSid,
    });
    const worker = buildDefaultWorker("listening", {
      eventSink,
      ttsEnabled: false,
    });
    let sequence = 0;
    const stream = new this.options.rtc.AudioStream(track, {
      sampleRate: this.options.sampleRate,
      numChannels: 1,
      frameSizeMs: this.options.frameSizeMs,
    });
    const runtime = new LiveKitCallAudioTrackRuntime({
      callId,
      legId: trackSid,
      speakerRole: "host",
      stream,
      capacityFrames: this.options.capacityFrames,
      pipelineReady: Promise.resolve(),
      worker,
      nextSequence: () => ++sequence,
      isStopped: () => this.stopped || !this.tracks.has(track),
    });
    this.tracks.set(track, runtime);
    let task!: Promise<void>;
    task = worker.startCall(callId)
      .then(() => runtime.run())
      .catch((error) => this.reportError(error))
      .finally(async () => {
        this.tracks.delete(track);
        await worker.endCall(callId).catch((error) => this.reportError(error));
        this.tasks.delete(task);
      });
    this.tasks.add(task);
  }

  private removeTrack(track: unknown) {
    const runtime = this.tracks.get(track);
    if (!runtime) return;
    this.tracks.delete(track);
    runtime.stop(false);
  }

  private reportError(error: unknown) {
    try {
      this.options.onError?.(error);
    } catch {
      // Observability callbacks must not replace the track failure.
    }
  }
}

function meetingEventSink(input: {
  client: EnterpriseMeetingRuntimeClient;
  sourceParticipantId: string;
  sourceTrackSid: string;
}): CallRoomEventSink {
  return {
    async publish(_callId, events) {
      const captions = events.flatMap(toCaptionEvent);
      if (captions.length === 0) return;
      await input.client.publish({
        sourceParticipantId: input.sourceParticipantId,
        sourceTrackSid: input.sourceTrackSid,
        events: captions,
      });
    },
  };
}

function toCaptionEvent(event: CallRoomSubmittedEvent):
  EnterpriseMeetingWorkerCaptionInput[] {
  if (event.type !== "transcript.final" && event.type !== "translation.final") {
    return [];
  }
  return [{
    type: event.type,
    segmentId: event.segmentId,
    revision: event.revision ?? 0,
    sourceLanguage: event.sourceLanguage,
    targetLanguage: event.targetLanguage,
    sourceText: event.sourceText ?? event.text,
    text: event.type === "translation.final"
      ? event.translatedText ?? event.text : event.text,
    timestampMs: event.timestampMs,
  }];
}

function enterpriseParticipant(value: unknown) {
  const identity = (value as { identity?: unknown }).identity;
  if (typeof identity !== "string") return null;
  const match = identity.match(
    /^ent:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(host|member|guest)$/i,
  );
  return match?.[1] ? { participantId: match[1] } : null;
}
function publicationSid(value: unknown) {
  const item = value as { sid?: unknown; trackSid?: unknown };
  const sid = typeof item.sid === "string" ? item.sid : item.trackSid;
  return typeof sid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(sid)
    ? sid : null;
}
function participants(room: RtcRoom) {
  return (room as unknown as { remoteParticipants?: Map<string, unknown> })
    .remoteParticipants?.values() ?? [];
}
function publications(participant: unknown) {
  return (participant as { trackPublications?: Map<string, { track?: unknown }> })
    .trackPublications?.values() ?? [];
}
