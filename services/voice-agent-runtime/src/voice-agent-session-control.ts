import { voice } from "@livekit/agents";
import type {
  DataPacketKind,
  RemoteParticipant,
} from "@livekit/rtc-node";
import { AgentDeliveryInbox } from "./agent-delivery-inbox.js";
import type { AgentDeliveryPlayback } from "./agent-delivery-playback.js";
import type { ManagedVoiceAgentSessionInput } from
  "./voice-agent-session-input.js";
import { VoiceAgentControlInbox } from "./voice-agent-control.js";
import {
  pauseVoiceAgentMedia,
  resumeVoiceAgentMedia,
} from "./voice-agent-media-control.js";
import type { VoiceAgentInteractionState } from
  "./voice-agent-interaction-state.js";
import type { VoiceAgentRuntimeApiClient } from "./runtime-api-client.js";
import type { VoiceAgentUserData } from "./runtime-tools.js";

type ReportEvent = Parameters<VoiceAgentRuntimeApiClient["event"]>[0]["event"];

export class VoiceAgentSessionControl {
  private readonly controlInbox = new VoiceAgentControlInbox();
  private readonly deliveryInbox = new AgentDeliveryInbox();
  private transition: Promise<void> = Promise.resolve();
  private heartbeat?: NodeJS.Timeout;
  private active = true;
  takeover = false;
  paused = false;

  constructor(private readonly input: {
    runtime: ManagedVoiceAgentSessionInput;
    interaction: VoiceAgentInteractionState;
    session: () => voice.AgentSession<VoiceAgentUserData> | undefined;
    deliveryPlayback: () => AgentDeliveryPlayback | undefined;
    report: (event: ReportEvent) => Promise<{
      command: "continue" | "pause" | "takeover" | "cancel" | "resume";
    }>;
    onError: (error: unknown, message: string) => void;
  }) {}

  startHeartbeat() {
    this.active = true;
    let running = false;
    this.heartbeat = setInterval(() => {
      if (running || !this.active) return;
      running = true;
      void this.input.report("heartbeat")
        .then((response) => {
          if (this.active) return this.enqueue(response.command);
        })
        .catch((error) => this.input.onError(error, "Voice Agent heartbeat failed"))
        .finally(() => {
          running = false;
        });
    }, this.input.runtime.env.heartbeatSeconds * 1000);
    this.heartbeat.unref();
  }

  stopHeartbeat() {
    this.active = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  handleData(
    data: Uint8Array,
    participant: RemoteParticipant | undefined,
    _kind: DataPacketKind | undefined,
    topic: string,
  ) {
    if (!this.active) return;
    const deliveryPlayback = this.input.deliveryPlayback();
    if (deliveryPlayback) {
      let delivery;
      try {
        delivery = this.deliveryInbox.accept({
          data,
          hasParticipant: participant !== undefined,
          topic,
          snapshot: this.input.runtime.snapshot,
        });
      } catch (error) {
        this.input.onError(error, "Agent delivery command rejected");
        return;
      }
      if (delivery) {
        void deliveryPlayback.enqueue(delivery);
        return;
      }
    }
    const command = this.controlInbox.accept({
      data,
      hasParticipant: participant !== undefined,
      topic,
      callId: this.input.runtime.snapshot.callId,
      generation: this.input.runtime.snapshot.generation,
    });
    if (command) void this.enqueue(command);
  }

  private enqueue(
    command: "continue" | "pause" | "takeover" | "cancel" | "resume",
  ) {
    if (!this.active) return Promise.resolve();
    this.transition = this.transition
      .then(() => this.apply(command))
      .catch((error) => this.input.onError(error, "Voice Agent control failed"));
    return this.transition;
  }

  private async apply(
    command: "continue" | "pause" | "takeover" | "cancel" | "resume",
  ) {
    const session = this.input.session();
    if (command === "continue" || command === "resume") {
      if (!this.takeover && !this.paused) return;
      const returningFromTakeover = this.takeover;
      this.takeover = false;
      this.paused = false;
      this.input.interaction.setSessionState("active");
      resumeVoiceAgentMedia(session, { returningFromTakeover });
      return;
    }
    if (command === "pause") {
      if (this.takeover || this.paused) return;
      this.paused = true;
      this.input.interaction.setSessionState("transferring");
      await pauseVoiceAgentMedia(session);
      return;
    }
    if (command === "cancel") {
      this.input.interaction.setSessionState("ending");
      await this.input.runtime.api.hangup({
        snapshot: this.input.runtime.snapshot,
        ticket: this.input.runtime.ticket,
        reason: "task_cancelled",
      }).catch(() => {});
      session?.shutdown({ drain: false, reason: "task_cancelled" });
      return;
    }
    if (this.takeover) return;
    this.takeover = true;
    this.input.interaction.setSessionState("takeover");
    await pauseVoiceAgentMedia(session);
    await this.input.report("takeover_ready");
  }
}
