import { llm, voice } from "@livekit/agents";
import type {
  VoiceAgentAmdCategory,
  VoiceAgentStructuredResultDto,
} from "@translation/contracts";
import {
  discloseAndGenerateReply,
  playVoiceAgentDisclosure,
  voiceAgentReplyInstructions,
} from "./voice-agent-disclosure.js";
import type { ManagedVoiceAgentSessionInput } from
  "./voice-agent-session-input.js";
import type { VoiceAgentRuntimeApiClient } from "./runtime-api-client.js";
import type { VoiceAgentUserData } from "./runtime-tools.js";
import type { VoiceAgentInteractionState } from
  "./voice-agent-interaction-state.js";

type ReportEvent = Parameters<VoiceAgentRuntimeApiClient["event"]>[0]["event"];
type ReportExtra = Partial<Parameters<VoiceAgentRuntimeApiClient["event"]>[0]>;

export class VoiceAgentConversationFlow {
  private amd?: voice.AMD;

  constructor(private readonly input: {
    runtime: ManagedVoiceAgentSessionInput;
    session: voice.AgentSession<VoiceAgentUserData>;
    interaction: VoiceAgentInteractionState;
    isClosed: () => boolean;
    report: (event: ReportEvent, extra?: ReportExtra) => Promise<unknown>;
  }) {}

  async classifyAndBegin(model: llm.LLM, closed: Promise<void>) {
    const { runtime, session } = this.input;
    const amd = new voice.AMD(session, {
      llm: runtime.env.amdModel ?? model,
      participantIdentity: runtime.snapshot.calleeParticipantIdentity,
      interruptOnMachine: false,
      noSpeechTimeoutMs: runtime.env.amdNoSpeechTimeoutMs,
      detectionTimeoutMs: runtime.env.amdDetectionTimeoutMs,
      waitUntilFinished: true,
    });
    this.amd = amd;
    const prediction = await amd.execute();
    if (this.input.isClosed()) return;
    const category = prediction.category as VoiceAgentAmdCategory;
    await this.input.report("amd_classified", {
      amdCategory: category,
      transcriptSummary: prediction.transcript.slice(0, 500),
    });
    if (category === "machine-unavailable") {
      await this.finish({
        outcome: "failed",
        summary: "The destination was unavailable.",
        evidence: [prediction.reason],
        unresolvedItems: [runtime.snapshot.objective],
        nextStep: "Retry only after provider reconciliation.",
      });
      return;
    }
    if (category === "machine-vm") {
      await this.handleVoicemail(prediction.reason, closed);
      return;
    }
    if (category === "machine-ivr") {
      await this.input.report("ivr_detected", {
        amdCategory: category,
        transcriptSummary: prediction.transcript.slice(0, 500),
      });
      session.resumeReplyAuthorization();
      session.generateReply({
        instructions: [
          "Navigate only the IVR needed for the approved objective.",
          "Use send_dtmf one digit at a time.",
          "If a human answers, disclose the AI identity first.",
        ].join(" "),
      });
      return;
    }
    await discloseAndGenerateReply({
      session,
      disclosureText: runtime.snapshot.disclosureText,
      replyInstructions: voiceAgentReplyInstructions(runtime.snapshot),
      closed,
      isClosed: this.input.isClosed,
      report: (event) => this.input.report(event),
    });
  }

  close() {
    return this.amd?.aclose() ?? Promise.resolve();
  }

  private async handleVoicemail(reason: string, closed: Promise<void>) {
    const { runtime, session } = this.input;
    if (!runtime.env.voicemailEnabled) {
      await this.finish({
        outcome: "unresolved",
        summary: "Voicemail detected; no message was left by policy.",
        evidence: [reason],
        unresolvedItems: [runtime.snapshot.objective],
        nextStep: "Ask whether a disclosed voicemail may be left.",
      });
      return;
    }
    const played = await playVoiceAgentDisclosure({
      session,
      disclosureText:
        `${runtime.snapshot.disclosureText} ${runtime.snapshot.approvedScript}`,
      closed,
      isClosed: this.input.isClosed,
      report: (event) => this.input.report(event),
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
    const { runtime, session, interaction } = this.input;
    interaction.setSessionState("ending");
    await this.input.report("structured_result", { result });
    await runtime.api.hangup({
      snapshot: runtime.snapshot,
      ticket: runtime.ticket,
      reason: "task_finished",
    });
    session.shutdown({ drain: true, reason: "task_finished" });
  }
}
