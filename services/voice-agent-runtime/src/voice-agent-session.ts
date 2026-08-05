import { llm, voice } from "@livekit/agents";
import type { JobContext } from "@livekit/agents";
import {
  type DataPacketKind,
  ParticipantKind,
  type RemoteParticipant,
  RoomEvent,
} from "@livekit/rtc-node";
import type {
  VoiceAgentAmdCategory,
  VoiceAgentRuntimeSnapshotDto,
  VoiceAgentStructuredResultDto,
} from "@translation/contracts";
import pino from "pino";
import type { VoiceAgentRuntimeEnv } from "./config.js";
import type { ProcessData } from "./agent-definition.js";
import type { VoiceAgentRuntimeApiClient } from "./runtime-api-client.js";
import type { VoiceAgentDispatchTicket } from "./runtime-ticket.js";
import { startWithReplyAuthorizationPaused } from "./agent-session-start-gate.js";
import { configureVoiceAgentSessionAudio,
  type LiveKitTargetAudioOutput } from "./livekit-target-audio-output.js";
import { buildVoiceAgentTools,
  type VoiceAgentUserData } from "./runtime-tools.js";
import { parseVoiceAgentControl } from "./voice-agent-control.js";
import { assertVoiceAgentCalleeBinding } from "./voice-agent-participant-binding.js";
import {
  discloseAndGenerateReply,
  playVoiceAgentDisclosure,
  voiceAgentReplyInstructions,
} from "./voice-agent-disclosure.js";
import { buildVoiceAgentModels,
  voiceAgentInstructions } from "./voice-agent-session-config.js";

const logger = pino({ name: "voice-agent-session" });
const controlTopic = "voice-agent.control.v1";
export class ManagedVoiceAgentSession {
  private session?: voice.AgentSession<VoiceAgentUserData>;
  private amd?: voice.AMD;
  private heartbeat?: NodeJS.Timeout;
  private stopped = false;
  private endingSent = false;
  private takeover = false;
  private sessionClosed = false;
  private targetAudioOutput?: LiveKitTargetAudioOutput;
  private targetAudioAbort?: AbortController;
  private readonly handledControls = new Set<string>();

  constructor(private readonly input: {
    env: VoiceAgentRuntimeEnv;
    api: VoiceAgentRuntimeApiClient;
    ticket: VoiceAgentDispatchTicket;
    snapshot: VoiceAgentRuntimeSnapshotDto;
    workerId: string;
    jobId: string;
    ctx: JobContext<ProcessData>;
  }) {}

  async run() {
    const userData: VoiceAgentUserData = {
      api: this.input.api,
      ticket: this.input.ticket,
      snapshot: this.input.snapshot,
      room: this.input.ctx.room,
      resultReported: false,
      takeoverRequested: false,
      recordingConsentStatus: undefined,
    };
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
    const closed = new Promise<void>((resolve) => {
      session.once(voice.AgentSessionEventTypes.Close, () => {
        this.sessionClosed = true;
        this.targetAudioAbort?.abort();
        resolve();
      });
    });
    const audio = configureVoiceAgentSessionAudio(session, {
      room: this.input.ctx.room,
      telephonyProvider: this.input.snapshot.telephonyProvider,
      publisherIdentity: this.input.snapshot.participantIdentity,
      targetParticipantIdentity: this.input.snapshot.calleeParticipantIdentity,
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
    const room = this.input.ctx.room;
    const onControl = (
      data: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: DataPacketKind,
      topic?: string,
    ) => this.handleControl(data, participant, topic ?? "");
    room.on(RoomEvent.DataReceived, onControl);
    try {
      await this.report("ready");
      this.startHeartbeat();
      const participant = await this.input.ctx.waitForParticipant(
        this.input.snapshot.calleeParticipantIdentity,
      );
      assertVoiceAgentCalleeBinding(this.input.snapshot, participant);
      await this.classifyAndBegin(models.llm, closed);
      await closed;
    } finally {
      room.off(RoomEvent.DataReceived, onControl);
    }
  }

  async stop(errorClass?: string) {
    if (this.stopped) return;
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.targetAudioAbort?.abort();
    if (errorClass && !this.takeover) {
      await this.input.api.hangup({
        snapshot: this.input.snapshot,
        ticket: this.input.ticket,
        reason: "runtime_failed",
      }).catch(() => {});
    }
    await this.amd?.aclose().catch(() => {});
    await this.session?.close().catch(() => {});
    await this.targetAudioOutput?.close().catch(() => {});
    if (errorClass) {
      await this.report("failed", { errorClass }).catch(() => {});
    }
    if (!this.endingSent) {
      this.endingSent = true;
      await this.report("ending").catch(() => {});
    }
  }

  private async classifyAndBegin(model: llm.LLM, closed: Promise<void>) {
    const amd = new voice.AMD(this.session!, {
      llm: this.input.env.amdModel ?? model,
      participantIdentity: this.input.snapshot.calleeParticipantIdentity,
      interruptOnMachine: false,
      noSpeechTimeoutMs: this.input.env.amdNoSpeechTimeoutMs,
      detectionTimeoutMs: this.input.env.amdDetectionTimeoutMs,
      waitUntilFinished: true,
    });
    this.amd = amd;
    const prediction = await amd.execute();
    if (this.sessionClosed) return;
    const category = prediction.category as VoiceAgentAmdCategory;
    await this.report("amd_classified", {
      amdCategory: category,
      transcriptSummary: prediction.transcript.slice(0, 500),
    });
    if (category === "machine-unavailable") {
      await this.finish({
        outcome: "failed",
        summary: "The destination was unavailable.",
        evidence: [prediction.reason],
        unresolvedItems: [this.input.snapshot.objective],
        nextStep: "Retry only after provider reconciliation.",
      });
      return;
    }
    if (category === "machine-vm") {
      await this.handleVoicemail(prediction.reason, closed);
      return;
    }
    if (category === "machine-ivr") {
      await this.report("ivr_detected", {
        amdCategory: category,
        transcriptSummary: prediction.transcript.slice(0, 500),
      });
      this.session!.resumeReplyAuthorization();
      this.session!.generateReply({
        instructions: "Navigate only the IVR needed for the approved objective. Use send_dtmf one digit at a time. If a human answers, disclose the AI identity before discussing the task.",
      });
      return;
    }
    await this.discloseAndStart(closed);
  }

  private async discloseAndStart(closed: Promise<void>) {
    await discloseAndGenerateReply({
      session: this.session!,
      disclosureText: this.input.snapshot.disclosureText,
      replyInstructions: voiceAgentReplyInstructions(this.input.snapshot),
      closed,
      isClosed: () => this.sessionClosed,
      report: (event) => this.report(event),
    });
  }

  private async handleVoicemail(reason: string, closed: Promise<void>) {
    if (!this.input.env.voicemailEnabled) {
      await this.finish({
        outcome: "unresolved",
        summary: "Voicemail detected; no message was left by policy.",
        evidence: [reason],
        unresolvedItems: [this.input.snapshot.objective],
        nextStep: "Ask the user whether a disclosed voicemail may be left.",
      });
      return;
    }
    const played = await playVoiceAgentDisclosure({
      session: this.session!,
      disclosureText:
        `${this.input.snapshot.disclosureText} ${this.input.snapshot.approvedScript}`,
      closed,
      isClosed: () => this.sessionClosed,
      report: (event) => this.report(event),
    });
    if (!played) return;
    await this.finish({
      outcome: "partial",
      summary: "A disclosed voicemail message was left.",
      evidence: [reason],
      unresolvedItems: ["A human response was not obtained."],
      nextStep: "Wait for a callback or retry under user authorization.",
    });
  }

  private async finish(result: VoiceAgentStructuredResultDto) {
    await this.report("structured_result", { result });
    await this.input.api.hangup({
      snapshot: this.input.snapshot,
      ticket: this.input.ticket,
      reason: "task_finished",
    });
    this.session?.shutdown({ drain: true, reason: "task_finished" });
  }

  private startHeartbeat() {
    let running = false;
    this.heartbeat = setInterval(() => {
      if (running || this.stopped) return;
      running = true;
      void this.report("heartbeat")
        .then((response) => this.applyCommand(response.command))
        .catch((error) => logger.warn({ err: error }, "Voice Agent heartbeat failed"))
        .finally(() => {
          running = false;
        });
    }, this.input.env.heartbeatSeconds * 1000);
    this.heartbeat.unref();
  }

  private handleControl(
    data: Uint8Array,
    participant: RemoteParticipant | undefined,
    topic: string,
  ) {
    if (participant !== undefined || topic !== controlTopic) return;
    const message = parseVoiceAgentControl(data);
    if (!message || message.callId !== this.input.snapshot.callId ||
      message.generation !== this.input.snapshot.generation ||
      Date.parse(message.expiresAt) <= Date.now() ||
      Date.parse(message.issuedAt) > Date.now() + 5_000 ||
      this.handledControls.has(message.controlId)) return;
    this.handledControls.add(message.controlId);
    if (this.handledControls.size > 100) {
      this.handledControls.delete(this.handledControls.values().next().value!);
    }
    void this.applyCommand(message.command).catch((error) =>
      logger.warn({ err: error }, "Voice Agent control failed"));
  }

  private async applyCommand(command: "continue" | "takeover" | "cancel" | "resume") {
    if (command === "continue" || command === "resume") {
      if (!this.takeover) return;
      this.takeover = false;
      this.session?.input.setAudioEnabled(true);
      this.session?.output.setAudioEnabled(true);
      this.session?.resumeReplyAuthorization();
      this.session?.generateReply({
        instructions: "The human declined takeover. Resume the approved task without repeating completed steps.",
      });
      return;
    }
    if (command === "cancel") {
      await this.input.api.hangup({
        snapshot: this.input.snapshot,
        ticket: this.input.ticket,
        reason: "task_cancelled",
      }).catch(() => {});
      this.session?.shutdown({ drain: false, reason: "task_cancelled" });
      return;
    }
    if (this.takeover) return;
    this.takeover = true;
    this.session?.pauseReplyAuthorization();
    const interrupted = this.session?.interrupt({ force: true });
    if (interrupted) await interrupted.await.catch(() => {});
    this.session?.output.audio?.clearBuffer();
    this.session?.output.setAudioEnabled(false);
    this.session?.input.setAudioEnabled(false);
    await this.report("takeover_ready");
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
