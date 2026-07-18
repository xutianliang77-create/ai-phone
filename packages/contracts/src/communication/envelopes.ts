import type { CommunicationIds } from "./identifiers.js";

export interface CommunicationActor {
  type: "user" | "service" | "agent" | "system";
  id: string;
}

export interface CommunicationCommand<TPayload = unknown>
  extends CommunicationIds {
  contractVersion: 1;
  kind: "command";
  commandId: string;
  expectedVersion: number;
  idempotencyKey: string;
  issuedAt: string;
  deadlineAt?: string;
  actor: CommunicationActor;
  payload: TPayload;
}

export interface CommunicationEvent<TPayload = unknown>
  extends CommunicationIds {
  contractVersion: 1;
  kind: "event";
  eventId: string;
  eventType: string;
  eventVersion: number;
  aggregateVersion: number;
  sequence: number;
  occurredAt: string;
  producer: string;
  traceId: string;
  idempotencyKey: string;
  payload: TPayload;
}

export function isReliableCommunicationEvent(eventType: string) {
  return ![
    "speech.transcript.partial",
    "speech.vad.probability",
    "speech.waveform.updated",
  ].includes(eventType);
}
