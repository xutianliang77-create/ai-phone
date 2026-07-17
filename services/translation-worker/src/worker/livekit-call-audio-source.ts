import type {
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallSpeechPipeline,
} from "./types.js";
import {
  AudioIngestRingBuffer,
  type AudioIngestMetrics,
} from "./audio-ingest-ring-buffer.js";
import {
  isCallRoomEndedError,
  type CallRoomEndedError,
} from "./call-room-event-client.js";
import type { HttpCallRoomTokenClient } from "./call-room-token-client.js";
import {
  isLiveKitTtsAudioSupported,
  LiveKitTtsAudioSink,
  type LiveKitTtsRtcModule,
  type LiveKitTtsRoom,
} from "./livekit-tts-audio-sink.js";
import type {
  CallSipStatusReporter,
  LiveKitSipCallStatus,
} from "./call-sip-status-client.js";
import {
  isAnsweredSipStatus,
  liveKitSipParticipant,
  participantRole,
  sipCallStatus,
} from "./livekit-call-participant.js";
import type { CallTtsTrackAccessAuthorizer } from "./call-tts-track-access-client.js";
import type { TtsVoiceConfig } from "./types.js";
import {
  deferred,
  int16Base64,
  isRemoteAudioTrack,
  normalizeSampleRate,
  shouldForwardAudioTrack,
} from "./livekit-call-audio-utils.js";

export interface LiveKitCallAudioSourceOptions {
  callId: string;
  tokenClient?: Pick<HttpCallRoomTokenClient, "createWorkerToken">;
  worker: CallSpeechPipeline;
  audioSampleRate: 16000 | 24000;
  audioFrameSizeMs: number;
  audioIngestMaxFrames?: number;
  sipStatusClient?: CallSipStatusReporter;
  ttsTrackAccessClient?: CallTtsTrackAccessAuthorizer;
  onError?: (error: unknown) => void;
  onCallEnded?: (error: CallRoomEndedError) => void;
  onIngestMetrics?: (metrics: AudioIngestMetrics) => void;
  loadRtcNode?: () => Promise<RtcNodeModule>;
  nowMs?: () => number;
}

export interface RtcNodeModule extends Partial<LiveKitTtsRtcModule> {
  Room: new () => RtcRoom;
  RoomEvent: {
    TrackSubscribed: string;
    Disconnected: string;
    ParticipantAttributesChanged?: string;
  };
  AudioStream: new (
    track: unknown,
    options: { sampleRate: number; numChannels: number; frameSizeMs: number },
  ) => ReadableStream<RtcAudioFrame>;
  RemoteAudioTrack?: new (...args: unknown[]) => object;
  dispose?: () => Promise<void>;
}

export interface RtcRoom extends LiveKitTtsRoom {
  on(event: string, listener: (...args: unknown[]) => void): RtcRoom;
  connect(url: string, token: string, opts: {
    autoSubscribe: boolean;
    dynacast: boolean;
  }): Promise<void>;
  disconnect(): Promise<void>;
  remoteParticipants?: Map<string, {
    trackPublications?: Map<string, { track?: unknown }>;
  }>;
}

interface RtcAudioFrame {
  data: Int16Array;
  sampleRate: number;
}

interface PendingSipTrack {
  track: unknown;
  speakerRole: CallAudioSpeakerRole;
  identity: string;
  rtc: RtcNodeModule;
}

interface AudioTrackRuntime {
  reader: ReadableStreamDefaultReader<RtcAudioFrame>;
  queue: AudioIngestRingBuffer<CallAudioFrame>;
}

const DEFAULT_AUDIO_INGEST_MAX_FRAMES = 20;

export class LiveKitCallAudioSource {
  private room: RtcRoom | null = null;
  private rtc: RtcNodeModule | null = null;
  private readonly sequenceByRole: Record<CallAudioSpeakerRole, number> = {
    host: 0,
    guest: 0,
  };
  private readonly legCountByRole: Record<CallAudioSpeakerRole, number> = {
    host: 0,
    guest: 0,
  };
  private ingestStopped = false;
  private stopPromise: Promise<void> | null = null;
  private callEnded = false;
  private fatalError: unknown;
  private workerStarted = false;
  private ownsRoomConnection = false;
  private readonly pendingSipTracks = new Map<unknown, PendingSipTrack>();
  private readonly startedTracks = new Set<unknown>();
  private readonly reportedSipStatuses = new Set<string>();
  private readonly trackRuntimes = new Set<AudioTrackRuntime>();
  private readonly trackTasks = new Set<Promise<void>>();
  private readonly disconnected = deferred<void>();
  private readonly pipelineReady = deferred<void>();

  constructor(private readonly options: LiveKitCallAudioSourceOptions) {}

  async start() {
    if (!this.options.tokenClient) throw new Error("Worker room token client is required");
    const token = await this.options.tokenClient.createWorkerToken(this.options.callId);
    const rtc = await this.loadRtcNode();
    const room = new rtc.Room();
    this.rtc = rtc;
    this.room = room;
    this.ownsRoomConnection = true;

    if (token.ttsVoice) this.options.worker.setTtsVoice(token.ttsVoice);
    this.attachRoomListeners(room, rtc);
    await room.connect(token.wsUrl, token.token, {
      autoSubscribe: true,
      dynacast: false,
    });
    this.attachLiveKitTtsSink(room, rtc, token.callId, token.participantIdentity);
    try {
      await this.startPipeline();
    } catch (error) {
      this.stopIngest(true);
      await room.disconnect();
      await rtc.dispose?.();
      throw error;
    }
    return token;
  }

  async startInRoom(input: {
    room: RtcRoom;
    rtc: RtcNodeModule;
    participantIdentity: string;
    ttsVoice?: TtsVoiceConfig;
  }) {
    this.room = input.room;
    this.rtc = input.rtc;
    if (input.ttsVoice) this.options.worker.setTtsVoice(input.ttsVoice);
    this.attachRoomListeners(input.room, input.rtc);
    this.attachLiveKitTtsSink(
      input.room,
      input.rtc,
      this.options.callId,
      input.participantIdentity,
    );
    await this.startPipeline();
    for (const participant of input.room.remoteParticipants?.values() ?? []) {
      for (const publication of participant.trackPublications?.values() ?? []) {
        if (publication.track) {
          void this.handleTrackSubscribed(
            publication.track,
            publication,
            participant,
            input.rtc,
          ).catch((error) => this.handleAudioTrackError(error));
        }
      }
    }
  }

  async waitUntilDisconnected() {
    await this.disconnected.promise;
    if (this.fatalError) throw this.fatalError;
  }

  stop() {
    this.stopPromise ??= this.performStop();
    return this.stopPromise;
  }

  private async performStop() {
    this.stopIngest(true);
    this.pipelineReady.resolve();
    await Promise.allSettled([...this.trackTasks]);
    let failure: unknown;
    try {
      if (this.ownsRoomConnection) await this.room?.disconnect();
    } catch (error) {
      failure = error;
    }
    try {
      if (this.workerStarted) await this.options.worker.endCall(this.options.callId);
    } catch (error) {
      if (isCallRoomEndedError(error)) {
        this.markCallEnded(error);
      } else {
        failure ??= error;
      }
    }
    try {
      if (this.ownsRoomConnection) await this.rtc?.dispose?.();
    } catch (error) {
      failure ??= error;
    } finally {
      this.disconnected.resolve();
    }
    if (failure) throw failure;
  }

  private async handleTrackSubscribed(
    track: unknown,
    publication: unknown,
    participant: unknown,
    rtc: RtcNodeModule,
  ) {
    if (!shouldForwardAudioTrack(track, publication)) return;
    const speakerRole = participantRole(participant);
    if (!speakerRole || !isRemoteAudioTrack(track, rtc.RemoteAudioTrack)) return;

    const sipParticipant = liveKitSipParticipant(participant);
    if (sipParticipant) {
      const status = sipCallStatus(participant);
      if (!isAnsweredSipStatus(status) ||
        !await this.reportSipStatus(sipParticipant, participant, status)) {
        this.pendingSipTracks.set(track, {
          track,
          speakerRole,
          identity: sipParticipant.identity,
          rtc,
        });
        return;
      }
    }
    await this.startAudioTrack(track, speakerRole, rtc);
  }

  private async handleParticipantAttributesChanged(
    participant: unknown,
  ) {
    const sipParticipant = liveKitSipParticipant(participant);
    const status = sipCallStatus(participant);
    if (!sipParticipant || !status ||
      !await this.reportSipStatus(sipParticipant, participant, status) ||
      !isAnsweredSipStatus(status)) return;
    for (const [track, pending] of this.pendingSipTracks) {
      if (pending.identity !== sipParticipant.identity) continue;
      this.pendingSipTracks.delete(track);
      await this.startAudioTrack(pending.track, pending.speakerRole, pending.rtc);
    }
  }

  private async reportSipStatus(
    binding: { identity: string; operationId: string },
    participant: unknown,
    status: LiveKitSipCallStatus,
  ) {
    if (!this.options.sipStatusClient) return false;
    const reportKey = `${binding.identity}:${status}`;
    if (this.reportedSipStatuses.has(reportKey)) return true;
    const value = participant as {
      sid?: unknown;
      attributes?: Record<string, string>;
    };
    try {
      await this.options.sipStatusClient.reportStatus(this.options.callId, {
        operationId: binding.operationId,
        participantIdentity: binding.identity,
        callStatus: status,
        ...(typeof value.sid === "string" ? { participantSid: value.sid } : {}),
        ...(value.attributes?.["sip.callID"]
          ? { sipCallId: value.attributes["sip.callID"] }
          : {}),
      });
    } catch (error) {
      this.reportError(error);
      return false;
    }
    this.reportedSipStatuses.add(reportKey);
    return true;
  }

  private async startAudioTrack(
    track: unknown,
    speakerRole: CallAudioSpeakerRole,
    rtc: RtcNodeModule,
  ) {
    if (this.startedTracks.has(track)) return;
    this.startedTracks.add(track);

    const stream = new rtc.AudioStream(track, {
      sampleRate: this.options.audioSampleRate,
      numChannels: 1,
      frameSizeMs: this.options.audioFrameSizeMs,
    });
    const legId = `${speakerRole}:${++this.legCountByRole[speakerRole]}`;
    const reader = stream.getReader();
    const runtime: AudioTrackRuntime = {
      reader,
      queue: new AudioIngestRingBuffer<CallAudioFrame>({
        callId: this.options.callId,
        legId,
        speakerRole,
        capacityFrames: this.audioIngestMaxFrames(),
        onMetrics: this.options.onIngestMetrics,
      }),
    };
    this.trackRuntimes.add(runtime);
    let task!: Promise<void>;
    task = this.runAudioTrack(runtime, speakerRole)
      .catch((error) => this.handleAudioTrackError(error))
      .finally(() => {
        this.trackRuntimes.delete(runtime);
        this.trackTasks.delete(task);
      });
    this.trackTasks.add(task);
  }

  private async runAudioTrack(
    runtime: AudioTrackRuntime,
    speakerRole: CallAudioSpeakerRole,
  ) {
    await this.pipelineReady.promise;
    await Promise.all([
      this.readAudioStream(runtime, speakerRole),
      this.consumeAudio(runtime.queue),
    ]);
    if (!this.ingestStopped) runtime.queue.report("drained");
  }

  private async readAudioStream(
    runtime: AudioTrackRuntime,
    speakerRole: CallAudioSpeakerRole,
  ) {
    try {
      while (!this.ingestStopped) {
        const result = await runtime.reader.read();
        if (result.done) break;
        runtime.queue.enqueue({
          type: "audio.frame",
          sessionId: this.options.callId,
          speakerRole,
          sequence: ++this.sequenceByRole[speakerRole],
          timestampMs: this.options.nowMs?.() ?? Date.now(),
          format: "pcm16",
          sampleRate: normalizeSampleRate(result.value.sampleRate),
          data: int16Base64(result.value.data),
        });
      }
    } catch (error) {
      if (!this.ingestStopped) throw error;
    } finally {
      runtime.queue.close({ discardPending: this.ingestStopped });
      runtime.reader.releaseLock();
    }
  }

  private async consumeAudio(queue: AudioIngestRingBuffer<CallAudioFrame>) {
    while (!this.ingestStopped) {
      const frame = await queue.dequeue();
      if (!frame) return;
      try {
        await this.options.worker.processAudioFrame(frame);
        queue.markProcessed(frame);
      } catch (error) {
        queue.markFailed();
        throw error;
      }
    }
  }

  private handleAudioTrackError(error: unknown) {
    if (isCallRoomEndedError(error)) {
      this.markCallEnded(error);
    } else {
      this.fatalError ??= error;
      this.reportError(error);
    }
    this.stopIngest(true);
    this.disconnected.resolve();
  }

  private markCallEnded(error: CallRoomEndedError) {
    if (this.callEnded) return;
    this.callEnded = true;
    try {
      this.options.onCallEnded?.(error);
    } catch {
      // Lifecycle observers must not turn a normal terminal state into failure.
    }
  }

  private stopIngest(discardPending: boolean) {
    this.ingestStopped = true;
    for (const runtime of this.trackRuntimes) {
      runtime.queue.close({ discardPending });
      void runtime.reader.cancel().catch(() => undefined);
    }
  }

  private reportError(error: unknown) {
    try {
      this.options.onError?.(error);
    } catch {
      // Error observers must not replace the original media failure.
    }
  }

  private audioIngestMaxFrames() {
    const configured = this.options.audioIngestMaxFrames ??
      DEFAULT_AUDIO_INGEST_MAX_FRAMES;
    return Number.isInteger(configured) && configured > 0
      ? configured
      : DEFAULT_AUDIO_INGEST_MAX_FRAMES;
  }

  private async loadRtcNode() {
    try {
      return await (this.options.loadRtcNode ?? loadRtcNode)();
    } catch (error) {
      throw new Error(
        "LiveKit Node RTC runtime is unavailable. Install @livekit/rtc-node before running the Translation Worker.",
        { cause: error },
      );
    }
  }

  private attachRoomListeners(room: RtcRoom, rtc: RtcNodeModule) {
    room
      .on(rtc.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        void this.handleTrackSubscribed(track, publication, participant, rtc)
          .catch((error) => this.handleAudioTrackError(error));
      })
      .on(rtc.RoomEvent.Disconnected, () => {
        this.pendingSipTracks.clear();
        this.stopIngest(true);
        this.disconnected.resolve();
      });
    if (rtc.RoomEvent.ParticipantAttributesChanged) {
      room.on(rtc.RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
        void this.handleParticipantAttributesChanged(participant)
          .catch((error) => this.handleAudioTrackError(error));
      });
    }
  }

  private async startPipeline() {
    try {
      await this.options.worker.startCall(this.options.callId);
      this.workerStarted = true;
    } finally {
      this.pipelineReady.resolve();
    }
  }

  private attachLiveKitTtsSink(
    room: RtcRoom,
    rtc: RtcNodeModule,
    callId: string,
    participantIdentity: string,
  ) {
    if (!isLiveKitTtsAudioSupported(room, rtc)) return;
    this.options.worker.addTtsAudioSink(new LiveKitTtsAudioSink({
      room,
      rtc: rtc as LiveKitTtsRtcModule,
      ...(this.options.ttsTrackAccessClient ? {
        trackAccess: {
          authorizeTrack: (request) =>
            this.options.ttsTrackAccessClient!.authorizeTrack(callId, {
              workerIdentity: participantIdentity,
              ...request,
            }),
        },
      } : {}),
    }));
  }
}

async function loadRtcNode(): Promise<RtcNodeModule> {
  const dynamicImport = new Function("name", "return import(name)") as
    (name: string) => Promise<RtcNodeModule>;
  return dynamicImport("@livekit/rtc-node");
}
