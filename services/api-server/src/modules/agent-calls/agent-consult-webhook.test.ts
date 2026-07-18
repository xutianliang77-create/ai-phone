import type { WebhookEvent } from "livekit-server-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import {
  beginAgentConsult,
  findAgentConsult,
  updateAgentConsult,
} from "./agent-consult.repository.js";
import { reconcileAgentConsultWebhook } from "./agent-consult-webhook.js";
import { beginAgentRun } from "./agent-orchestration.repository.js";

describe("Agent operator consult webhook", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.agentRuns = [];
    store.agentHandoffs = [];
    store.agentConsults = [];
    store.providerOperations = [];
    store.inboxEvents = [];
    store.postgresProjectionEvents = [];
  });

  it("connects in private and reconciles the move into the main room", async () => {
    const binding = createConsult();
    const joinedPrivate = await reconcileAgentConsultWebhook(event(
      binding,
      "operator-private",
      "participant_joined",
      binding.consultRoomName,
    ));
    const move = beginProviderOperation({
      sessionId: binding.sessionId,
      provider: "livekit_sip",
      operationType: "sip_consult_move",
      operationKey: binding.id,
      idempotencyKey: `sip_consult_move:${binding.id}`,
      requestHash: `sip_consult_move:${binding.id}`,
    }).operation;
    updateAgentConsult({ consultId: binding.id, status: "merging" });
    updateProviderOperation({ operationId: move.id, status: "unknown" });
    const leftPrivate = await reconcileAgentConsultWebhook(event(
      binding,
      "operator-left-private",
      "participant_left",
      binding.consultRoomName,
    ));
    const joinedMain = await reconcileAgentConsultWebhook(event(
      binding,
      "operator-main",
      "participant_joined",
      binding.mainRoomName,
    ));

    expect(joinedPrivate?.status).toBe("connected");
    expect(leftPrivate?.status).toBe("moving");
    expect(joinedMain?.status).toBe("merged");
    expect(findAgentConsult(binding.id)?.status).toBe("merged");
    expect(getStoreSnapshot().providerOperations.find((item) => item.id === move.id)?.status)
      .toBe("succeeded");
  });

  it("deduplicates a signed event without replaying state changes", async () => {
    const binding = createConsult();
    const joined = event(
      binding,
      "operator-duplicate",
      "participant_joined",
      binding.consultRoomName,
    );

    const first = await reconcileAgentConsultWebhook(joined);
    const duplicate = await reconcileAgentConsultWebhook(joined);

    expect(first?.status).toBe("connected");
    expect(duplicate?.status).toBe("duplicate");
    expect(findAgentConsult(binding.id)?.version).toBe(3);
  });
});

function createConsult() {
  const run = beginAgentRun({
    taskId: "draft-webhook",
    sessionId: "call-webhook",
    mode: "autonomous",
    policyVersion: "voice-agent-v1",
  }).run;
  const consult = beginAgentConsult({
    runId: run.id,
    sessionId: "call-webhook",
    mainRoomName: "call_call-webhook",
    operatorPhoneHash: "phone-hash",
    idempotencyKey: "consult-webhook",
    requestHash: "request-hash",
    ttlSeconds: 180,
  }).consult;
  const operation = beginProviderOperation({
    sessionId: consult.sessionId,
    provider: "livekit_sip",
    operationType: "sip_consult",
    operationKey: consult.id,
    idempotencyKey: `sip-consult:${consult.id}`,
    requestHash: "request-hash",
  }).operation;
  updateAgentConsult({
    consultId: consult.id,
    status: "dialing",
    providerOperationId: operation.id,
  });
  updateProviderOperation({ operationId: operation.id, status: "accepted" });
  return findAgentConsult(consult.id)!;
}

function event(
  consult: ReturnType<typeof createConsult>,
  id: string,
  eventName: "participant_joined" | "participant_left",
  roomName: string,
) {
  return {
    id,
    event: eventName,
    createdAt: BigInt(1_700_000_000),
    room: { name: roomName },
    participant: {
      sid: "PA_operator",
      identity: consult.operatorParticipantIdentity,
      attributes: {
        "translation.operationId": consult.providerOperationId,
        "translation.sessionId": consult.sessionId,
        "translation.consultId": consult.id,
        "translation.role": "operator",
        "sip.callID": "sip-operator",
        "sip.callStatus": "active",
      },
    },
  } as unknown as WebhookEvent;
}
