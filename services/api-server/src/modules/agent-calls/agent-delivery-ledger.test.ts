import { describe, expect, it } from "vitest";
import {
  AgentDeliveryConflict,
  applyAgentDeliveryClientReceipt,
  applyAgentDeliveryServerPlayback,
  claimAgentDelivery,
  createAgentDeliveryAttempt,
  expireAgentDelivery,
  queueAgentDelivery,
} from "./agent-delivery-ledger.js";

describe("Agent delivery ledger", () => {
  it("does not treat generation or server playout as client delivery", () => {
    let record = generated();
    expect(record.status).toBe("generated");
    record = claimAgentDelivery(record, {
      claimId: "claim-1",
      claimantId: "coordinator-1",
      claimExpiresAt: "2026-07-30T08:00:30.000Z",
      now: "2026-07-30T08:00:01.000Z",
    });
    record = queueAgentDelivery(record, {
      claimId: "claim-1",
      playbackId: "playback-1",
      playbackGeneration: 11,
      workerParticipantIdentity: "session-1:worker:voice_agent_001_g4",
      now: "2026-07-30T08:00:02.000Z",
    });
    record = applyAgentDeliveryServerPlayback(record, {
      type: "playback.ended",
      playbackId: "playback-1",
      playbackGeneration: 11,
      now: "2026-07-30T08:00:03.000Z",
    });
    expect(record.status).toBe("queued_for_playback");
    expect(record.serverPlaybackState).toBe("ended");
  });

  it("marks delivered only after exact client started and ended receipts", () => {
    let record = queued();
    const started = applyAgentDeliveryClientReceipt(record, receipt(
      "client.playback.started",
      "receipt-started",
    ));
    expect(started.record.status).toBe("playback_started");
    const ended = applyAgentDeliveryClientReceipt(started.record, receipt(
      "client.playback.ended",
      "receipt-ended",
    ));
    expect(ended.record.status).toBe("playback_ended");
    expect(ended.record.endedAt).toBe("2026-07-30T08:00:04.000Z");
  });

  it("rejects stale generation and wrong target client receipts", () => {
    const record = queued();
    expect(() => applyAgentDeliveryClientReceipt(record, {
      ...receipt("client.playback.started", "receipt-stale"),
      playbackGeneration: 10,
    })).toThrowError(new AgentDeliveryConflict(
      "playback_receipt_binding_mismatch",
    ));
    expect(() => applyAgentDeliveryClientReceipt(record, {
      ...receipt("client.playback.started", "receipt-attacker"),
      clientInstanceId: "client-other",
    })).toThrow("playback_receipt_binding_mismatch");
  });

  it("replays the same receipt without a second state transition", () => {
    const first = applyAgentDeliveryClientReceipt(
      queued(),
      receipt("client.playback.started", "receipt-started"),
    );
    const replay = applyAgentDeliveryClientReceipt(
      first.record,
      receipt("client.playback.started", "receipt-started"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.record.version).toBe(first.record.version);
  });

  it("rejects reuse of a receipt ID with a different payload", () => {
    const first = applyAgentDeliveryClientReceipt(
      queued(),
      receipt("client.playback.started", "receipt-reused"),
    );
    expect(() => applyAgentDeliveryClientReceipt(
      first.record,
      receipt("client.playback.ended", "receipt-reused"),
    )).toThrow("playback_receipt_id_reused");
  });

  it("rejects an invalid claim lease and a late client receipt", () => {
    expect(() => claimAgentDelivery(generated(), {
      claimId: "claim-expired",
      claimantId: "coordinator-1",
      claimExpiresAt: "2026-07-30T08:00:00.000Z",
      now: "2026-07-30T08:00:01.000Z",
    })).toThrow("delivery_claim_expiry_invalid");
    expect(() => applyAgentDeliveryClientReceipt(queued(), {
      ...receipt("client.playback.started", "receipt-late"),
      occurredAt: "2026-07-30T08:06:00.000Z",
    })).toThrow("delivery_expired");
  });

  it("expires an unplayed result without pretending playback completed", () => {
    const record = expireAgentDelivery(
      generated(),
      "2026-07-30T08:05:00.000Z",
    );
    expect(record).toMatchObject({
      status: "expired",
      terminalReason: "delivery_window_expired",
    });
  });
});

function generated() {
  return createAgentDeliveryAttempt({
    deliveryAttemptId: "delivery-1",
    workId: "work-1",
    sessionId: "session-1",
    legId: "leg-host",
    turnId: "turn-7",
    clientInstanceId: "client-ios-1",
    clientParticipantIdentity: "session-1:host:user-1",
    ownershipLeaseId: "voice-lease-1",
    ownershipGeneration: 6,
    turnGeneration: 4,
    dispatchGeneration: 4,
    expiresAt: "2026-07-30T08:05:00.000Z",
    now: "2026-07-30T08:00:00.000Z",
  });
}

function queued() {
  const claimed = claimAgentDelivery(generated(), {
    claimId: "claim-1",
    claimantId: "coordinator-1",
    claimExpiresAt: "2026-07-30T08:00:30.000Z",
    now: "2026-07-30T08:00:01.000Z",
  });
  return queueAgentDelivery(claimed, {
    claimId: "claim-1",
    playbackId: "playback-1",
    playbackGeneration: 11,
    workerParticipantIdentity: "session-1:worker:voice_agent_001_g4",
    now: "2026-07-30T08:00:02.000Z",
  });
}

function receipt(
  type: "client.playback.started" | "client.playback.ended",
  receiptId: string,
) {
  return {
    version: 1 as const,
    receiptId,
    type,
    sessionId: "session-1",
    legId: "leg-host",
    turnId: "turn-7",
    workId: "work-1",
    deliveryAttemptId: "delivery-1",
    playbackId: "playback-1",
    clientInstanceId: "client-ios-1",
    clientParticipantIdentity: "session-1:host:user-1",
    workerParticipantIdentity: "session-1:worker:voice_agent_001_g4",
    ownershipLeaseId: "voice-lease-1",
    ownershipGeneration: 6,
    turnGeneration: 4,
    dispatchGeneration: 4,
    playbackGeneration: 11,
    occurredAt: type === "client.playback.started"
      ? "2026-07-30T08:00:03.000Z"
      : "2026-07-30T08:00:04.000Z",
  };
}
