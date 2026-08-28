import { createHash } from "node:crypto";
import {
  agentDeliveryTopic,
  parseAgentDeliveryCommand,
  type AgentDeliveryCommand,
  type VoiceAgentRuntimeSnapshotDto,
} from "@translation/contracts";

export class AgentDeliveryInbox {
  private readonly accepted = new Map<string, string>();

  accept(input: {
    data: Uint8Array;
    hasParticipant: boolean;
    topic: string;
    snapshot: VoiceAgentRuntimeSnapshotDto;
    now?: Date;
  }): AgentDeliveryCommand | null {
    if (input.hasParticipant || input.topic !== agentDeliveryTopic ||
        input.data.byteLength < 2 || input.data.byteLength > 8_192) {
      return null;
    }
    let command: AgentDeliveryCommand;
    try {
      command = parseAgentDeliveryCommand(
        JSON.parse(new TextDecoder().decode(input.data)),
      );
    } catch {
      return null;
    }
    const now = input.now ?? new Date();
    if (command.sessionId !== input.snapshot.sessionId ||
        command.legId !== input.snapshot.calleeParticipantIdentity ||
        command.workerParticipantIdentity !== input.snapshot.participantIdentity ||
        command.dispatchGeneration !== input.snapshot.generation ||
        Date.parse(command.issuedAt) > now.getTime() + 30_000 ||
        Date.parse(command.expiresAt) <= now.getTime() ||
        !command.clientParticipantIdentity.startsWith(
          `${input.snapshot.callId}:host:`,
        )) {
      return null;
    }
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex");
    const existing = this.accepted.get(command.commandId);
    if (existing) {
      if (existing !== fingerprint) {
        throw new AgentDeliveryInboxError("delivery_command_id_reused");
      }
      return null;
    }
    this.accepted.set(command.commandId, fingerprint);
    while (this.accepted.size > 64) {
      const oldest = this.accepted.keys().next().value as string | undefined;
      if (!oldest) break;
      this.accepted.delete(oldest);
    }
    return command;
  }
}

export class AgentDeliveryInboxError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentDeliveryInboxError";
  }
}
