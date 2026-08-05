import { describe, expect, it, vi } from "vitest";
import { DeviceCallBindingConflict } from
  "./postgres-air-device-calls.repository.js";
import { PostgresAirDeviceCallEvents } from
  "./postgres-air-device-call-events.js";

describe("PostgreSQL Air device carrier events", () => {
  it("applies one fenced carrier event with inbox and outbox atomically", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ...callRow, carrier_state: "dialing" }] })
      .mockResolvedValueOnce({
        rows: [{ ...callRow, carrier_state: "connected", version: "5" }],
      });
    const fixture = dependencies(query);
    const events = new PostgresAirDeviceCallEvents(fixture.dependencies);

    await expect(events.processCarrierEvent(eventInput("connected")))
      .resolves.toMatchObject({
        providerCallId: "air-call-1",
        carrierState: "connected",
        liveKitParticipantState: "joined",
        version: 5,
      });
    expect(fixture.inbox.claim).toHaveBeenCalledOnce();
    expect(fixture.outbox.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: "air-call-event-event-1",
        eventType: "device.call.connected",
      }),
    );
    expect(fixture.inbox.abandon).not.toHaveBeenCalled();
  });

  it("replays a processed event without applying a second update", async () => {
    const fixture = dependencies(vi.fn());
    fixture.inbox.claim.mockResolvedValueOnce({
      duplicate: true,
      result: callDto,
    });
    const events = new PostgresAirDeviceCallEvents(fixture.dependencies);

    await expect(events.processCarrierEvent(eventInput("connected")))
      .resolves.toEqual(callDto);
    expect(fixture.inbox.completeClaim).not.toHaveBeenCalled();
    expect(fixture.outbox.enqueue).not.toHaveBeenCalled();
  });

  it("rejects a terminal-state regression and abandons the claim", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ ...callRow, carrier_state: "disconnected" }],
    });
    const fixture = dependencies(query);
    const events = new PostgresAirDeviceCallEvents(fixture.dependencies);

    await expect(events.processCarrierEvent(eventInput("connected")))
      .rejects.toBeInstanceOf(DeviceCallBindingConflict);
    expect(fixture.inbox.abandon).toHaveBeenCalledWith(
      "event-1",
      "gateway-instance-1",
    );
  });

  it("updates LiveKit participant state without changing carrier authority", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        ...callRow,
        carrier_state: "connected",
        livekit_participant_state: "joining",
        livekit_event_sequence: "1",
      }] })
      .mockResolvedValueOnce({ rows: [{
        ...callRow,
        carrier_state: "connected",
        livekit_participant_state: "joined",
        livekit_event_sequence: "2",
        version: "5",
      }] });
    const fixture = dependencies(query);
    const events = new PostgresAirDeviceCallEvents(fixture.dependencies);

    await expect(events.processLiveKitParticipantEvent(liveKitEvent("joined")))
      .resolves.toMatchObject({
        carrierState: "connected",
        liveKitParticipantState: "joined",
      });
    expect(query.mock.calls[1]?.[0]).toContain("livekit_event_sequence");
    expect(fixture.outbox.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "device.livekit.joined" }),
    );
  });
});

function eventInput(carrierState: "connected") {
  return {
    eventId: "event-1",
    claimOwner: "gateway-instance-1",
    communicationSessionId: "session-1",
    providerCallId: "air-call-1",
    deviceId: "air-001",
    leaseId: "lease-1",
    fencingToken: 7,
    callGeneration: 3,
    eventSequence: 10,
    carrierState,
    carrierCause: "none" as const,
    occurredAt: "2026-08-04T03:00:10.000Z",
  };
}

function liveKitEvent(liveKitParticipantState: "joined") {
  return {
    eventId: "livekit-event-2",
    claimOwner: "gateway-instance-1",
    communicationSessionId: "session-1",
    providerCallId: "air-call-1",
    deviceId: "air-001",
    leaseId: "lease-1",
    fencingToken: 7,
    callGeneration: 3,
    eventSequence: 2,
    liveKitParticipantState,
    occurredAt: "2026-08-04T03:00:09.000Z",
  };
}

const callRow = {
  provider_call_id: "air-call-1",
  communication_session_id: "session-1",
  provider_operation_id: "op-1",
  device_id: "air-001",
  lease_id: "lease-1",
  fencing_token: "7",
  carrier_state: "unknown",
  livekit_participant_state: "joined",
  call_generation: "3",
  version: "4",
  room_name: "call_session-1",
  participant_identity: "session-1:guest:air:air-001",
  carrier_event_sequence: "9",
  livekit_event_sequence: "1",
};

const callDto = {
  providerCallId: "air-call-1",
  communicationSessionId: "session-1",
  providerOperationId: "op-1",
  deviceId: "air-001",
  leaseId: "lease-1",
  fencingToken: 7,
  carrierState: "connected" as const,
  liveKitParticipantState: "joined" as const,
  callGeneration: 3,
  version: 5,
};

function dependencies(query: ReturnType<typeof vi.fn>) {
  const inbox = {
    claim: vi.fn().mockResolvedValue({ duplicate: false, result: undefined }),
    completeClaim: vi.fn(async (input: {
      beforeComplete?: (client: { query: typeof query }) => Promise<void>;
    }) => {
      await input.beforeComplete?.({ query });
      return true;
    }),
    abandon: vi.fn().mockResolvedValue(true),
  };
  const outbox = { enqueue: vi.fn().mockResolvedValue({ inserted: true }) };
  return {
    inbox,
    outbox,
    dependencies: { inbox, outbox },
  };
}
