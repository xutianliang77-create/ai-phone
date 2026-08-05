import { describe, expect, it, vi } from "vitest";
import type { AirDeviceCallDto } from "@translation/contracts";
import type { AgentCallRecord } from "./agent-call-record.js";
import { toAgentCallReadDto } from "./agent-call-status-projection.js";

describe("agent call status projection", () => {
  it("projects carrier and LiveKit state without exposing lease authority", async () => {
    const reader = vi.fn(async () => airCall);

    const result = await toAgentCallReadDto(record(), reader);

    expect(reader).toHaveBeenCalledWith(expect.objectContaining({
      providerOperationId: "operation-1",
    }));
    expect(result).toMatchObject({
      id: "draft-1",
      carrierState: "connected",
      liveKitParticipantState: "joined",
      deviceId: "air-001",
      callGeneration: 7,
    });
    expect(result).not.toHaveProperty("providerOperationId");
    expect(result).not.toHaveProperty("leaseId");
    expect(result).not.toHaveProperty("fencingToken");
  });

  it("does not query Air state for another provider", async () => {
    const reader = vi.fn(async () => airCall);

    const result = await toAgentCallReadDto(
      record({ executionProvider: "livekit_sip" }),
      reader,
    );

    expect(reader).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("carrierState");
  });
});

function record(overrides: Partial<AgentCallRecord> = {}): AgentCallRecord {
  return {
    id: "draft-1",
    userId: "user-1",
    scenario: "booking",
    status: "in_progress",
    objective: "预约复诊",
    suggestedScript: "您好",
    language: "zh",
    riskLevel: "low",
    riskReasons: [],
    callId: "call-1",
    providerOperationId: "operation-1",
    executionProvider: "air780_volte",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

const airCall: AirDeviceCallDto = {
  providerCallId: "air-call-1",
  communicationSessionId: "session-1",
  providerOperationId: "operation-1",
  deviceId: "air-001",
  leaseId: "lease-1",
  fencingToken: 9,
  carrierState: "connected",
  liveKitParticipantState: "joined",
  callGeneration: 7,
  version: 3,
};
