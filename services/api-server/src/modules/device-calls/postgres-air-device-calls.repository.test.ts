import { describe, expect, it, vi } from "vitest";
import {
  DeviceCallBindingConflict,
  PostgresAirDeviceCallsRepository,
} from "./postgres-air-device-calls.repository.js";

describe("PostgreSQL Air device calls", () => {
  it("records a dial only when provider operation and current lease match", async () => {
    const fixture = pool([{
      ...callRow,
      carrier_state: "dialing",
      livekit_participant_state: "absent",
      version: "1",
    }]);
    const repository = new PostgresAirDeviceCallsRepository(fixture.pool);
    await expect(repository.recordDial({
      providerCallId: "air-call-1",
      providerOperationId: "op-1",
      communicationSessionId: "session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      fencingToken: 7,
      roomName: "call_session-1",
      participantIdentity: "session-1:guest:air:air-001",
      callGeneration: 3,
    })).resolves.toMatchObject({
      providerCallId: "air-call-1",
      carrierState: "dialing",
      callGeneration: 3,
    });
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /provider\.operation_type = 'phone_outbound'[\s\S]+reliable_outbox_events/,
      ),
      ["air-call-1", "session-1", "op-1", "air-001", "lease-1", 7,
        "call_session-1", "session-1:guest:air:air-001", 3],
    );
  });

  it("terminalizes a durably recorded dial after a definitive command rejection", async () => {
    const fixture = pool([{
      ...callRow,
      carrier_state: "failed",
      livekit_participant_state: "absent",
      version: "2",
    }]);
    const repository = new PostgresAirDeviceCallsRepository(fixture.pool);

    await expect(repository.recordDialRejected({
      providerCallId: "air-call-1",
      providerOperationId: "op-1",
      communicationSessionId: "session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      fencingToken: 7,
      roomName: "call_session-1",
      participantIdentity: "session-1:guest:air:air-001",
      callGeneration: 3,
    })).resolves.toMatchObject({
      providerCallId: "air-call-1",
      carrierState: "failed",
      callGeneration: 3,
    });
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /carrier_state = 'failed'[\s\S]+carrier_state = 'dialing'[\s\S]+device\.call\.failed/,
      ),
      ["air-call-1", "session-1", "op-1", "air-001", "lease-1", 7,
        "call_session-1", "session-1:guest:air:air-001", 3],
    );
  });

  it("accepts only the exact active call generation and fence", async () => {
    const current = pool([{ current: true }]);
    const repository = new PostgresAirDeviceCallsRepository(current.pool);
    await expect(repository.assertCallBinding(binding())).resolves.toBeUndefined();
    expect(current.query).toHaveBeenCalledWith(
      expect.stringContaining("call_generation = $5"),
      ["session-1", "air-001", "lease-1", 7, 3],
    );

    const stale = pool([{ current: false }]);
    await expect(new PostgresAirDeviceCallsRepository(stale.pool)
      .assertCallBinding({ ...binding(), callGeneration: 2 }))
      .rejects.toBeInstanceOf(DeviceCallBindingConflict);
  });

  it("loads a control binding only for the active call and current lease", async () => {
    const fixture = pool([callRow]);
    const repository = new PostgresAirDeviceCallsRepository(fixture.pool);

    await expect(repository.findActiveBinding({
      communicationSessionId: "session-1",
      providerOperationId: "op-1",
    })).resolves.toEqual({
      providerCallId: "air-call-1",
      participantIdentity: "session-1:guest:air:air-001",
      roomName: "call_session-1",
      carrierState: "unknown",
      callGeneration: 3,
      deviceLease: {
        deviceId: "air-001",
        leaseId: "lease-1",
        fencingToken: 7,
      },
    });
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringMatching(/provider_operation_id = \$2[\s\S]+air_device_lease_is_current/),
      ["session-1", "op-1"],
    );
  });

  it("loads the exact call status after a terminal carrier state", async () => {
    const fixture = pool([{
      ...callRow,
      carrier_state: "disconnected",
      livekit_participant_state: "disconnected",
    }]);
    const repository = new PostgresAirDeviceCallsRepository(fixture.pool);

    await expect(repository.findCallStatus({
      communicationSessionId: "session-1",
      providerOperationId: "op-1",
    })).resolves.toMatchObject({
      providerCallId: "air-call-1",
      carrierState: "disconnected",
      liveKitParticipantState: "disconnected",
      deviceId: "air-001",
      callGeneration: 3,
    });
    expect(fixture.query).toHaveBeenCalledWith(
      expect.not.stringContaining("air_device_lease_is_current"),
      ["session-1", "op-1"],
    );
  });

  it("lists only bounded calls that require carrier reconciliation", async () => {
    const fixture = pool([callRow]);
    const repository = new PostgresAirDeviceCallsRepository(fixture.pool);
    await expect(repository.listReconcile(25)).resolves.toMatchObject([{
      providerCallId: "air-call-1",
      carrierState: "unknown",
      liveKitParticipantState: "joined",
      callGeneration: 3,
    }]);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("carrier_state IN"),
      [25],
    );
    await expect(repository.listReconcile(501)).rejects.toThrow(
      "Invalid Air device reconciliation limit",
    );
  });
});

function binding() {
  return {
    communicationSessionId: "session-1",
    deviceId: "air-001",
    leaseId: "lease-1",
    fencingToken: 7,
    callGeneration: 3,
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
};

function pool(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return { pool: { connect } as never, query };
}
