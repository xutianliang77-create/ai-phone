import { describe, expect, it } from "vitest";
import type {
  AirDeviceCallDto,
  AirDeviceCarrierEventRequest,
} from "@translation/contracts";
import { airCarrierAgentStatusRequest } from
  "./air-device-agent-call-convergence.js";

describe("Air carrier Agent call convergence", () => {
  it("uses carrier connected instead of LiveKit joined as in-progress authority", () => {
    expect(airCarrierAgentStatusRequest(event("connected"), call)).toMatchObject({
      status: "in_progress",
      providerOperationStatus: "accepted",
    });
    expect(airCarrierAgentStatusRequest(event("ringing"), call)).toBeNull();
  });

  it("completes a previously connected remote hangup with measured seconds", () => {
    expect(airCarrierAgentStatusRequest(event("disconnected", {
      carrierCause: "remote_hangup",
    }), call)).toMatchObject({
      status: "completed",
      providerOperationStatus: "succeeded",
      consumedSeconds: 11,
    });
  });

  it("fails busy and never-connected terminal calls", () => {
    expect(airCarrierAgentStatusRequest(event("busy", {
      carrierCause: "busy",
    }), call)).toMatchObject({
      status: "failed",
      providerOperationStatus: "failed",
      failureReason: "carrier_busy",
    });
    expect(airCarrierAgentStatusRequest(event("disconnected", {
      carrierCause: "no_answer",
    }), { ...call, connectedAt: undefined })).toMatchObject({
      status: "failed",
      failureReason: "carrier_no_answer",
    });
  });

  it("marks an unknown carrier state for reconciliation instead of ignoring it", () => {
    expect(airCarrierAgentStatusRequest(event("unknown", {
      carrierCause: "unknown",
    }), call)).toMatchObject({
      status: "failed",
      providerOperationStatus: "unknown",
      failureReason: "carrier_unknown",
      nextStep: expect.stringContaining("不得重拨"),
    });
  });
});

function event(
  carrierState: AirDeviceCarrierEventRequest["carrierState"],
  overrides: Partial<AirDeviceCarrierEventRequest> = {},
): AirDeviceCarrierEventRequest {
  return {
    eventId: "air_evt_1",
    communicationSessionId: "call-1",
    providerCallId: "air-call-1",
    deviceId: "air-001",
    leaseId: "lease-1",
    fencingToken: 7,
    callGeneration: 7,
    eventSequence: 3,
    carrierState,
    carrierCause: "none",
    occurredAt: "2026-08-04T12:00:20.500Z",
    ...overrides,
  };
}

const call: AirDeviceCallDto = {
  providerCallId: "air-call-1",
  communicationSessionId: "call-1",
  providerOperationId: "operation-1",
  deviceId: "air-001",
  leaseId: "lease-1",
  fencingToken: 7,
  carrierState: "disconnected",
  liveKitParticipantState: "joined",
  callGeneration: 7,
  mediaPolicy: "agent_monitored",
  version: 4,
  connectedAt: "2026-08-04T12:00:10.000Z",
  endedAt: "2026-08-04T12:00:20.500Z",
};
