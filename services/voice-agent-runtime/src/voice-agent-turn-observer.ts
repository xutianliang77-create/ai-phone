import { createHash, randomUUID } from "node:crypto";
import type { AgentVoiceTurnScopeDto } from "@translation/contracts";
import type { VoiceAgentRuntimeApiClient } from "./runtime-api-client.js";
import type { VoiceAgentRuntimeSnapshotDto } from "@translation/contracts";
import type { VoiceAgentDispatchTicket } from "./runtime-ticket.js";

export class VoiceAgentTurnObserver {
  private transition: Promise<void> = Promise.resolve();
  private ending = false;

  constructor(private readonly options: {
    api: VoiceAgentRuntimeApiClient;
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    onScope: (scope: AgentVoiceTurnScopeDto | undefined) => void;
    onError: (error: unknown) => void;
  }) {}

  userSpeaking(createdAt: number) {
    if (this.ending) return;
    this.options.onScope(undefined);
    this.enqueue("user_speaking", createdAt);
  }

  finalTranscript(transcript: string, createdAt: number) {
    if (this.ending) return;
    const normalized = transcript.trim();
    if (!normalized) return;
    const explicitInstructionEvidenceHash = createHash("sha256")
      .update(normalized)
      .digest("hex");
    this.enqueue("final_transcript", createdAt, {
      explicitInstructionEvidenceHash,
    });
  }

  async end(createdAt = Date.now()) {
    if (this.ending) return this.transition;
    this.ending = true;
    this.options.onScope(undefined);
    this.enqueue("session_ending", createdAt);
    return this.transition;
  }

  private enqueue(
    eventType: "user_speaking" | "final_transcript" | "session_ending",
    createdAt: number,
    extra: { explicitInstructionEvidenceHash?: string } = {},
  ) {
    const observedAt = observedTimestamp(createdAt);
    const eventId = randomUUID();
    this.transition = this.transition.then(async () => {
      const result = await this.options.api.observeTurn({
        snapshot: this.options.snapshot,
        ticket: this.options.ticket,
        eventId,
        eventType,
        observedAt,
        ...extra,
      });
      this.options.onScope(
        result.scope.state === "active" ? result.scope : undefined,
      );
    }).catch((error) => {
      this.options.onScope(undefined);
      this.options.onError(error);
    });
  }
}

function observedTimestamp(createdAt: number) {
  const timestamp = new Date(createdAt);
  return Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString()
    : new Date().toISOString();
}
