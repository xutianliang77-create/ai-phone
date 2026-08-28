import { createHash } from "node:crypto";
import type {
  AgentDeliveryCommand,
  AgentDeliveryLifecycleEvent,
  AgentDeliveryLifecycleType,
  VoiceAgentRuntimeSnapshotDto,
} from "@translation/contracts";
import type { LiveKitTargetAudioOutput } from
  "./livekit-target-audio-output.js";
import type { VoiceAgentRuntimeApiClient } from "./runtime-api-client.js";
import type { VoiceAgentDispatchTicket } from "./runtime-ticket.js";
import type { VoiceAgentInteractionState } from
  "./voice-agent-interaction-state.js";

interface DeliverySpeechSession {
  say(text: string, options: {
    allowInterruptions: boolean;
    addToChatCtx: boolean;
  }): { waitForPlayout(): Promise<unknown> };
}

export class AgentDeliveryPlayback {
  private transition: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly lifecycleEvents = new Map<
    string,
    AgentDeliveryLifecycleEvent
  >();

  constructor(private readonly input: {
    api: VoiceAgentRuntimeApiClient;
    ticket: VoiceAgentDispatchTicket;
    snapshot: VoiceAgentRuntimeSnapshotDto;
    session: DeliverySpeechSession;
    interaction: VoiceAgentInteractionState;
    targetAudioOutput?: LiveKitTargetAudioOutput;
  }) {}

  enqueue(command: AgentDeliveryCommand) {
    this.transition = this.transition
      .then(() => this.play(command))
      .catch(() => undefined);
    return this.transition;
  }

  beginClose() {
    if (this.closed) return;
    this.closed = true;
    this.input.interaction.setSessionState("ending");
  }

  async close() {
    this.beginClose();
    await this.transition;
    this.lifecycleEvents.clear();
    this.input.interaction.setSessionState("ended");
  }

  private async play(command: AgentDeliveryCommand) {
    if (this.closed) return;
    try {
      await this.authorize(command);
      await this.report(command, "agent.delivery.queued");
      if (!await this.waitForWindow(command)) return;
      await this.authorize(command);
      await this.playSpeech(command);
    } catch (error) {
      await this.report(command, "agent.delivery.failed", errorCode(error))
        .catch(() => undefined);
    }
  }

  private async waitForWindow(command: AgentDeliveryCommand) {
    while (!this.closed) {
      const nowMs = Date.now();
      const decision = this.input.interaction.decision({
        nowMs,
        expiresAtMs: Date.parse(command.expiresAt),
        scopeCurrent: true,
        targetLegState: "online",
      });
      if (decision.action === "announce") return true;
      if (decision.action === "cancel" || decision.action === "expire") {
        await this.report(command, "agent.delivery.interrupted");
        return false;
      }
      const remaining = Date.parse(command.expiresAt) - nowMs;
      if (remaining <= 0) {
        await this.report(command, "agent.delivery.interrupted");
        return false;
      }
      const revision = this.input.interaction.currentRevision();
      await this.input.interaction.waitForChange(
        revision,
        Math.min(1_000, remaining),
      );
    }
    await this.report(command, "agent.delivery.interrupted").catch(() => {});
    return false;
  }

  private async playSpeech(command: AgentDeliveryCommand) {
    const observation = this.input.targetAudioOutput?.observeNextSegment();
    let speech: ReturnType<DeliverySpeechSession["say"]>;
    try {
      speech = this.input.session.say(command.announcementText, {
        allowInterruptions: true,
        addToChatCtx: false,
      });
    } catch (error) {
      observation?.cancel();
      throw error;
    }
    if (!observation) {
      await this.report(command, "agent.delivery.started");
      await speech.waitForPlayout();
      if (this.closed) {
        await this.report(command, "agent.delivery.interrupted");
        return;
      }
      await this.report(command, "agent.delivery.ended");
      return;
    }
    const playout = speech.waitForPlayout();
    const first = await Promise.race([
      observation.started.then((value) => value.audible
        ? "started" as const
        : "interrupted_before_start" as const),
      playout.then(() => "playout_finished" as const),
    ]);
    if (first === "interrupted_before_start" || this.closed) {
      observation.cancel();
      await this.report(command, "agent.delivery.interrupted");
      return;
    }
    if (first !== "started") {
      observation.cancel();
      throw new AgentDeliveryPlaybackError("delivery_no_audio_frame");
    }
    await this.report(command, "agent.delivery.started");
    const finished = await observation.finished;
    if (finished.interrupted || this.closed) {
      await this.report(command, "agent.delivery.interrupted");
      return;
    }
    await playout;
    if (this.closed) {
      await this.report(command, "agent.delivery.interrupted");
      return;
    }
    await this.report(command, "agent.delivery.ended");
  }

  private authorize(command: AgentDeliveryCommand) {
    return this.input.api.authorizeDelivery({
      snapshot: this.input.snapshot,
      ticket: this.input.ticket,
      command,
    });
  }

  private report(
    command: AgentDeliveryCommand,
    type: AgentDeliveryLifecycleType,
    failureCode?: string,
  ) {
    const key = `${command.deliveryAttemptId}:${
      command.playbackGeneration
    }:${type}`;
    const existing = this.lifecycleEvents.get(key);
    if (existing) {
      return this.input.api.deliveryLifecycle({
        snapshot: this.input.snapshot,
        ticket: this.input.ticket,
        event: existing,
      });
    }
    const event: AgentDeliveryLifecycleEvent = {
      version: 1,
      eventId: `delivery-event:${createHash("sha256")
        .update(key)
        .digest("hex")}`,
      type,
      deliveryAttemptId: command.deliveryAttemptId,
      workId: command.workId,
      sessionId: command.sessionId,
      legId: command.legId,
      turnId: command.turnId,
      turnGeneration: command.turnGeneration,
      dispatchGeneration: command.dispatchGeneration,
      clientInstanceId: command.clientInstanceId,
      clientParticipantIdentity: command.clientParticipantIdentity,
      workerParticipantIdentity: command.workerParticipantIdentity,
      ownershipLeaseId: command.ownershipLeaseId,
      ownershipGeneration: command.ownershipGeneration,
      playbackId: command.playbackId,
      playbackGeneration: command.playbackGeneration,
      occurredAt: new Date().toISOString(),
      ...(failureCode ? { failureCode } : {}),
    };
    this.lifecycleEvents.set(key, event);
    while (this.lifecycleEvents.size > 64) {
      const oldest = this.lifecycleEvents.keys().next().value;
      if (!oldest) break;
      this.lifecycleEvents.delete(oldest);
    }
    return this.input.api.deliveryLifecycle({
      snapshot: this.input.snapshot,
      ticket: this.input.ticket,
      event,
    });
  }
}

export class AgentDeliveryPlaybackError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentDeliveryPlaybackError";
  }
}

function errorCode(error: unknown) {
  const value = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : error instanceof Error ? error.name : "delivery_playback_failed";
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) ||
    "delivery_playback_failed";
}
