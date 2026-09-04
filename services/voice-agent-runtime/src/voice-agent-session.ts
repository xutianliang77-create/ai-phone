import { voice } from "@livekit/agents";
import {
  type DataPacketKind,
  ParticipantKind,
  type RemoteParticipant,
  RoomEvent,
} from "@livekit/rtc-node";
import pino from "pino";
import type { VoiceAgentRuntimeApiClient } from "./runtime-api-client.js";
import type { ManagedVoiceAgentSessionInput } from
  "./voice-agent-session-input.js";
import { startWithReplyAuthorizationPaused } from "./agent-session-start-gate.js";
import { configureVoiceAgentSessionAudio } from
  "./livekit-target-audio-config.js";
import type { LiveKitTargetAudioOutput } from
  "./livekit-target-audio-output.js";
import { buildVoiceAgentTools,
  type VoiceAgentUserData } from "./runtime-tools.js";
import { assertVoiceAgentCalleeBinding } from "./voice-agent-participant-binding.js";
import { buildVoiceAgentModels,
  voiceAgentInstructions } from "./voice-agent-session-config.js";
import { AgentResponseStartWatchdog } from
  "./agent-response-start-watchdog.js";
import { VoiceAgentTurnObserver } from "./voice-agent-turn-observer.js";
import { AgentDeliveryPlayback } from "./agent-delivery-playback.js";
import { VoiceAgentInteractionState } from
  "./voice-agent-interaction-state.js";
import { VoiceAgentAudioShadow } from "./voice-agent-audio-shadow.js";
import { VoiceAgentConversationFlow } from
  "./voice-agent-conversation-flow.js";
import { VoiceAgentSessionControl } from "./voice-agent-session-control.js";

const logger = pino({ name: "voice-agent-session" });
export class ManagedVoiceAgentSession {
  private session?: voice.AgentSession<VoiceAgentUserData>;
  private conversation?: VoiceAgentConversationFlow;
  private stopped = false;
  private endingSent = false;
  private sessionClosed = false;
  private targetAudioOutput?: LiveKitTargetAudioOutput;
  private targetAudioAbort?: AbortController;
  private responseStartWatchdog?: AgentResponseStartWatchdog;
  private turnObserver?: VoiceAgentTurnObserver;
  private audioRealtimeShadow?: VoiceAgentAudioShadow;
  private readonly interaction = new VoiceAgentInteractionState();
  private readonly control: VoiceAgentSessionControl;
  private deliveryPlayback?: AgentDeliveryPlayback;

  constructor(private readonly input: ManagedVoiceAgentSessionInput) {
    this.control = new VoiceAgentSessionControl({
      runtime: input,
      interaction: this.interaction,
      session: () => this.session,
      deliveryPlayback: () => this.deliveryPlayback,
      report: (event) => this.report(event),
      onError: (error, message) => logger.warn({ err: error }, message),
    });
  }

  async run() {
    const userData: VoiceAgentUserData = {
      api: this.input.api,
      ticket: this.input.ticket,
      snapshot: this.input.snapshot,
      room: this.input.ctx.room,
      resultReported: false,
      takeoverRequested: false,
      recordingConsentStatus: undefined,
      backgroundWorkEnabled: this.input.env.backgroundWorkEnabled,
      interaction: this.interaction,
    };
    if (this.input.env.backgroundWorkEnabled) {
      this.turnObserver = new VoiceAgentTurnObserver({
        api: this.input.api,
        snapshot: this.input.snapshot,
        ticket: this.input.ticket,
        onScope: (scope) => {
          userData.currentTurn = scope;
        },
        onError: (error) => logger.warn(
          { err: error },
          "Voice Agent turn scope update failed closed",
        ),
      });
    }
    const models = buildVoiceAgentModels(
      this.input.env,
      this.input.snapshot.language,
    );
    const agent = new voice.Agent<VoiceAgentUserData>({
      instructions: voiceAgentInstructions(this.input.snapshot),
      tools: buildVoiceAgentTools(userData),
      ...models,
    });
    const session = new voice.AgentSession<VoiceAgentUserData>({
      ...models,
      userData,
      maxToolSteps: 3,
      aecWarmupDuration: 3000,
      turnHandling: {
        endpointing: { minDelay: 500, maxDelay: 1800 },
        interruption: {
          enabled: true,
          mode: "adaptive",
          minDuration: 300,
          minWords: 1,
          falseInterruptionTimeout: 1800,
          resumeFalseInterruption: true,
        },
        preemptiveGeneration: { enabled: false },
      },
    });
    this.session = session;
    this.conversation = new VoiceAgentConversationFlow({
      runtime: this.input,
      session,
      interaction: this.interaction,
      isClosed: () => this.sessionClosed,
      report: (event, extra) => this.report(event, extra),
    });
    this.responseStartWatchdog = new AgentResponseStartWatchdog({
      timeoutMs: this.input.env.responseStartTimeoutMs,
      onTimeout: () => this.cancelTimedOutAgentReply(),
      onError: (error) => logger.warn(
        { err: error },
        "Voice Agent response-start watchdog callback failed",
      ),
    });
    const onAgentStateChanged = (event: {
      newState: "initializing" | "idle" | "listening" | "thinking" | "speaking";
    }) => {
      this.responseStartWatchdog?.observe(event.newState);
      this.interaction.observeAgentState(event.newState);
    };
    const onUserStateChanged = (event: {
      newState: "speaking" | "listening" | "away";
      createdAt: number;
    }) => {
      this.interaction.observeUserState(event.newState);
      if (event.newState === "speaking") {
        this.turnObserver?.userSpeaking(event.createdAt);
      }
    };
    const onUserInputTranscribed = (event: {
      transcript: string;
      isFinal: boolean;
      createdAt: number;
    }) => {
      if (event.isFinal) {
        this.turnObserver?.finalTranscript(event.transcript, event.createdAt);
      }
    };
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, onAgentStateChanged);
    session.on(voice.AgentSessionEventTypes.UserStateChanged, onUserStateChanged);
    session.on(
      voice.AgentSessionEventTypes.UserInputTranscribed,
      onUserInputTranscribed,
    );
    const closed = new Promise<void>((resolve) => {
      session.once(voice.AgentSessionEventTypes.Close, () => {
        this.sessionClosed = true;
        this.interaction.setSessionState("ended");
        this.responseStartWatchdog?.close();
        this.targetAudioAbort?.abort();
        resolve();
      });
    });
    const audio = configureVoiceAgentSessionAudio(session, {
      room: this.input.ctx.room,
      telephonyProvider: this.input.snapshot.telephonyProvider,
      publisherIdentity: this.input.snapshot.participantIdentity,
      targetParticipantIdentity: this.input.snapshot.calleeParticipantIdentity,
      maxPendingAudioMs: this.input.env.maxPendingAudioMs,
      maxPendingAudioChunks: this.input.env.maxPendingAudioChunks,
      onCapacityExceeded: (evidence) => {
        logger.error(evidence, "Voice Agent pending audio capacity exceeded");
        void this.report("audio_capacity_exceeded", {
          errorClass: evidence.code,
        }).catch((error) => logger.warn(
          { err: error },
          "Voice Agent audio capacity event report failed",
        ));
      },
    });
    this.targetAudioOutput = audio.output;
    this.targetAudioAbort = audio.abortController;
    await startWithReplyAuthorizationPaused(session, {
      agent,
      room: this.input.ctx.room,
      inputOptions: {
        participantIdentity: this.input.snapshot.calleeParticipantIdentity,
        participantKinds: [this.input.snapshot.telephonyProvider === "livekit_sip"
          ? ParticipantKind.SIP
          : ParticipantKind.STANDARD],
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: audio.roomOutputOptions,
      record: false,
    });
    if (this.targetAudioOutput) {
      await this.targetAudioOutput.start(this.targetAudioAbort!.signal);
    }
    if (this.input.env.deliveryCoordinatorEnabled) {
      this.deliveryPlayback = new AgentDeliveryPlayback({
        api: this.input.api,
        ticket: this.input.ticket,
        snapshot: this.input.snapshot,
        session,
        interaction: this.interaction,
        ...(this.targetAudioOutput
          ? { targetAudioOutput: this.targetAudioOutput }
          : {}),
      });
    }
    const room = this.input.ctx.room;
    const onControl = (
      data: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: DataPacketKind,
      topic?: string,
    ) => this.control.handleData(data, participant, _kind, topic ?? "");
    room.on(RoomEvent.DataReceived, onControl);
    try {
      await this.report("ready");
      this.control.startHeartbeat();
      const participant = await this.input.ctx.waitForParticipant(
        this.input.snapshot.calleeParticipantIdentity,
      );
      assertVoiceAgentCalleeBinding(this.input.snapshot, participant);
      this.startAudioRealtimeShadow(participant);
      await this.conversation.classifyAndBegin(models.llm, closed);
      await closed;
    } finally {
      session.off(
        voice.AgentSessionEventTypes.AgentStateChanged,
        onAgentStateChanged,
      );
      session.off(
        voice.AgentSessionEventTypes.UserStateChanged,
        onUserStateChanged,
      );
      session.off(
        voice.AgentSessionEventTypes.UserInputTranscribed,
        onUserInputTranscribed,
      );
      this.responseStartWatchdog?.close();
      room.off(RoomEvent.DataReceived, onControl);
    }
  }

  async stop(errorClass?: string) {
    if (this.stopped) return;
    this.stopped = true;
    this.interaction.setSessionState("ending");
    this.control.stopHeartbeat();
    this.deliveryPlayback?.beginClose();
    this.responseStartWatchdog?.close();
    await this.turnObserver?.end().catch(() => {});
    await this.audioRealtimeShadow?.close().catch(() => {});
    this.targetAudioAbort?.abort();
    this.targetAudioOutput?.clearBuffer();
    if (errorClass && !this.control.takeover) {
      await this.input.api.hangup({
        snapshot: this.input.snapshot,
        ticket: this.input.ticket,
        reason: "runtime_failed",
      }).catch(() => {});
    }
    await this.conversation?.close().catch(() => {});
    await this.session?.close().catch(() => {});
    await this.deliveryPlayback?.close().catch(() => {});
    await this.targetAudioOutput?.close().catch(() => {});
    if (errorClass) {
      await this.report("failed", { errorClass }).catch(() => {});
    }
    if (!this.endingSent) {
      this.endingSent = true;
      await this.report("ending").catch(() => {});
    }
  }

  private startAudioRealtimeShadow(participant: RemoteParticipant) {
    const config = this.input.env.audioRealtimeShadow;
    if (!config || this.audioRealtimeShadow || this.stopped) return;
    const shadow = new VoiceAgentAudioShadow({
      config,
      room: this.input.ctx.room,
      participant,
      onError: (error) => logger.warn({
        errorClass: shadowErrorClass(error),
        sessionId: this.input.snapshot.sessionId,
        generation: this.input.snapshot.generation,
      }, "Qwen Audio realtime shadow stopped without affecting primary Agent"),
      onStopped: (telemetry) => logger.info({
        ...telemetry,
        sessionId: this.input.snapshot.sessionId,
        generation: this.input.snapshot.generation,
      }, "Qwen Audio realtime shadow closed"),
    });
    this.audioRealtimeShadow = shadow;
    void shadow.start();
  }

  private async cancelTimedOutAgentReply() {
    if (this.stopped || this.sessionClosed || this.control.paused ||
        this.control.takeover) return;
    logger.warn({
      callId: this.input.snapshot.callId,
      generation: this.input.snapshot.generation,
      timeoutMs: this.input.env.responseStartTimeoutMs,
    }, "Voice Agent response start timed out");
    const interrupted = this.session?.interrupt({ force: true });
    if (interrupted) await interrupted.await.catch(() => {});
    this.targetAudioOutput?.clearBuffer();
    await this.report("response_start_timeout", {
      errorClass: "agent_response_start_timeout",
    }).catch((error) => logger.warn(
      { err: error },
      "Voice Agent response timeout event report failed",
    ));
  }

  private report(
    event: Parameters<VoiceAgentRuntimeApiClient["event"]>[0]["event"],
    extra: Partial<Parameters<VoiceAgentRuntimeApiClient["event"]>[0]> = {},
  ) {
    return this.input.api.event({
      snapshot: this.input.snapshot,
      ticket: this.input.ticket,
      event,
      workerId: this.input.workerId,
      jobId: this.input.jobId,
      ...extra,
    });
  }
}

function shadowErrorClass(error: unknown) {
  if (error instanceof Error && /^shadow_[a-z0-9_]{1,72}$/.test(error.message)) {
    return error.message;
  }
  const value = error instanceof Error ? error.name : "shadow_error";
  return /^[a-zA-Z0-9_.:-]{1,80}$/.test(value) ? value : "shadow_error";
}
