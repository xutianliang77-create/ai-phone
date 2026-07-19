import type { CallAudioSpeakerRole } from "./types.js";
import {
  isCallRoomEndedError,
  type CallRoomEndedError,
} from "./call-room-event-client.js";
import {
  isLiveKitTtsAudioSupported,
  LiveKitTtsAudioSink,
  type LiveKitTtsRtcModule,
} from "./livekit-tts-audio-sink.js";
import { deferred } from "./livekit-call-audio-utils.js";
import { LiveKitCallAudioTrackRuntime } from "./livekit-call-audio-track-runtime.js";
import {
  audioSourceKey,
  LiveKitCallAudioTrackRegistry,
  loadRtcNodeModule,
} from "./livekit-call-audio-source-runtime.js";
import { LiveKitCallDiagnostics } from "./livekit-call-diagnostics.js";
import { LiveKitCallSipTrackGate } from "./livekit-call-sip-track-gate.js";
import { LiveKitCallTrackLifecycle } from "./livekit-call-track-lifecycle.js";
import type {
  LiveKitCallAudioSourceOptions,
  RtcNodeModule,
  RtcRoom,
  StartInRoomInput,
} from "./livekit-call-audio-source-types.js";
export type {
  LiveKitCallAudioSourceOptions,
  RtcNodeModule,
  RtcRoom,
} from "./livekit-call-audio-source-types.js";

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
  private readonly startedTracks = new Set<unknown>();
  private readonly trackRuntimes = new Set<LiveKitCallAudioTrackRuntime>();
  private readonly trackTasks = new Set<Promise<void>>();
  private readonly activeAudioTracks = new LiveKitCallAudioTrackRegistry();
  private readonly disconnected = deferred<void>();
  private readonly pipelineReady = deferred<void>();
  private readonly sipTrackGate: LiveKitCallSipTrackGate;
  private readonly diagnostics: LiveKitCallDiagnostics;
  private readonly trackLifecycle: LiveKitCallTrackLifecycle;
  constructor(private readonly options: LiveKitCallAudioSourceOptions) {
    this.diagnostics = new LiveKitCallDiagnostics(options);
    this.trackLifecycle = new LiveKitCallTrackLifecycle(options.onTrackLifecycle);
    this.sipTrackGate = new LiveKitCallSipTrackGate({
      callId: options.callId,
      statusClient: options.sipStatusClient,
      reportError: (error) => this.reportError(error),
      startAudioTrack: (track, speakerRole, rtc, sourceKey) =>
        this.startAudioTrack(track, speakerRole, rtc, sourceKey),
    });
  }

  async start() {
    if (!this.options.tokenClient) throw new Error("Worker room token client is required");
    const token = await this.options.tokenClient.createWorkerToken(this.options.callId);
    const rtc = await loadRtcNodeModule(this.options.loadRtcNode);
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
    this.diagnostics.startRtc(room);
    this.attachLiveKitTtsSink(room, rtc, token.callId, token.participantIdentity);
    try {
      await this.startPipeline();
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
    return token;
  }

  async startInRoom(input: StartInRoomInput) {
    this.room = input.room;
    this.rtc = input.rtc;
    if (input.ttsVoice) this.options.worker.setTtsVoice(input.ttsVoice);
    this.attachRoomListeners(input.room, input.rtc);
    this.diagnostics.startRtc(input.room);
    this.attachLiveKitTtsSink(
      input.room,
      input.rtc,
      this.options.callId,
      input.participantIdentity,
    );
    await this.startPipeline();
    this.reconcileExistingPublications(input.room, input.rtc);
  }

  private reconcileExistingPublications(room: RtcRoom, rtc: RtcNodeModule) {
    for (const participant of room.remoteParticipants?.values() ?? []) {
      for (const publication of participant.trackPublications?.values() ?? []) {
        if (publication.track) {
          void this.handleTrackSubscribed(
            publication.track,
            publication,
            participant,
            rtc,
          ).catch((error) => this.handleAudioTrackError(error));
        } else {
          this.trackLifecycle.subscribePublication(publication, participant, rtc);
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
    const diagnostics = await this.diagnostics.stop();
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
      await this.diagnostics.report(diagnostics);
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
    const speakerRole = this.trackLifecycle.acceptSubscribedTrack(
      track,
      publication,
      participant,
      rtc,
    );
    if (!speakerRole) return;
    const sourceKey = audioSourceKey(speakerRole, participant);
    if (!await this.sipTrackGate.allowTrack({
      track,
      speakerRole,
      sourceKey,
      participant,
      rtc,
    })) return;
    await this.startAudioTrack(track, speakerRole, rtc, sourceKey);
  }

  private async handleParticipantAttributesChanged(
    participant: unknown,
  ) {
    await this.sipTrackGate.handleParticipantAttributesChanged(participant);
  }

  private async startAudioTrack(
    track: unknown,
    speakerRole: CallAudioSpeakerRole,
    rtc: RtcNodeModule,
    sourceKey: string,
  ) {
    if (this.startedTracks.has(track)) return;
    this.startedTracks.add(track);
    await this.activeAudioTracks.stopPrevious(sourceKey);
    if (this.ingestStopped) return;
    this.trackLifecycle.legStarted(speakerRole);

    const stream = new rtc.AudioStream(track, {
      sampleRate: this.options.audioSampleRate,
      numChannels: 1,
      frameSizeMs: this.options.audioFrameSizeMs,
    });
    const legId = `${speakerRole}:${++this.legCountByRole[speakerRole]}`;
    const runtime = new LiveKitCallAudioTrackRuntime({
      callId: this.options.callId,
      legId,
      speakerRole,
      stream,
      capacityFrames: this.audioIngestMaxFrames(),
      pipelineReady: this.pipelineReady.promise,
      worker: this.options.worker,
      nextSequence: () => ++this.sequenceByRole[speakerRole],
      isStopped: () => this.ingestStopped,
      onMetrics: (metrics) => this.diagnostics.observeIngest(metrics),
      nowMs: this.options.nowMs,
    });
    this.trackRuntimes.add(runtime);
    let task!: Promise<void>;
    task = runtime.run()
      .catch((error) => this.handleAudioTrackError(error))
      .finally(() => {
        this.activeAudioTracks.deleteIfCurrent(sourceKey, runtime);
        this.trackRuntimes.delete(runtime);
        this.trackTasks.delete(task);
      });
    this.trackTasks.add(task);
    this.activeAudioTracks.set(sourceKey, runtime, task);
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
      runtime.stop(discardPending);
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

  private attachRoomListeners(room: RtcRoom, rtc: RtcNodeModule) {
    room
      .on(rtc.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        void this.handleTrackSubscribed(track, publication, participant, rtc)
          .catch((error) => this.handleAudioTrackError(error));
      })
      .on(rtc.RoomEvent.Disconnected, () => {
        this.sipTrackGate.clear();
        this.options.worker.markCallEnded?.(this.options.callId);
        this.stopIngest(true);
        this.disconnected.resolve();
      });
    if (rtc.RoomEvent.ParticipantAttributesChanged) {
      room.on(rtc.RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
        void this.handleParticipantAttributesChanged(participant)
          .catch((error) => this.handleAudioTrackError(error));
      });
    }
    if (rtc.RoomEvent.TrackPublished) {
      room.on(rtc.RoomEvent.TrackPublished, (publication, participant) => {
        this.trackLifecycle.subscribePublication(publication, participant, rtc);
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
