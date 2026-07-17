import type {
  AgentCallWorkerClaimDto,
  AiCallingAgentDraftDto,
} from "@translation/contracts";
import { describe, expect, it } from "vitest";
import { AgentCallDispatcher } from "./agent-call-dispatcher.js";
import type { AgentCallApi, PstnBridge, PstnBridgeCallResult } from "./types.js";

describe("AgentCallDispatcher", () => {
  it("dispatches queued calls and marks them in progress", async () => {
    const api = new RecordingApi([draft("draft_1")]);
    const bridge = new FakeBridge({ providerCallId: "pstn_1" });
    const dispatcher = new AgentCallDispatcher({
      api,
      bridge,
      batchSize: 5,
      workerId: "worker-1",
    });

    const count = await dispatcher.dispatchOnce();

    expect(count).toBe(1);
    expect(bridge.placed.map((item) => item.draft.id)).toEqual(["draft_1"]);
    expect(api.updates).toEqual([{
      draftId: "draft_1",
      request: {
        status: "in_progress",
        providerCallId: "pstn_1",
        providerOperationStatus: "accepted",
      },
    }]);
  });

  it("marks queued calls failed when the bridge rejects", async () => {
    const api = new RecordingApi([draft("draft_1")]);
    const bridge = new FailingBridge();
    const dispatcher = new AgentCallDispatcher({
      api,
      bridge,
      batchSize: 5,
      workerId: "worker-1",
    });

    await dispatcher.dispatchOnce();

    expect(api.updates[0].draftId).toBe("draft_1");
    expect(api.updates[0].request).toMatchObject({
      status: "failed",
      failureReason: "bridge unavailable",
    });
  });
});

function draft(id: string): AiCallingAgentDraftDto {
  return {
    id,
    callId: `call_${id}`,
    scenario: "booking",
    status: "queued",
    objective: "预约洗牙",
    suggestedScript: "您好，我想预约洗牙",
    targetPhone: "13800138000",
    language: "zh",
    riskLevel: "low",
    riskReasons: [],
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
  };
}

class RecordingApi implements AgentCallApi {
  readonly updates: Array<{ draftId: string; request: object }> = [];

  constructor(private readonly queued: AiCallingAgentDraftDto[]) {}

  async claim(workerId: string, _limit: number) {
    return this.queued.map((item) => claim(item, workerId));
  }

  async updateStatus(item: AgentCallWorkerClaimDto, request: object) {
    this.updates.push({ draftId: item.draft.id, request });
    return draft(item.draft.id);
  }
}

class FakeBridge implements PstnBridge {
  readonly placed: AgentCallWorkerClaimDto[] = [];

  constructor(private readonly result: PstnBridgeCallResult) {}

  async placeCall(item: AgentCallWorkerClaimDto) {
    this.placed.push(item);
    return this.result;
  }
}

class FailingBridge implements PstnBridge {
  async placeCall(_item: AgentCallWorkerClaimDto) {
    throw new Error("bridge unavailable");
  }
}

function claim(item: AiCallingAgentDraftDto, workerId: string): AgentCallWorkerClaimDto {
  return {
    draft: { ...item, status: "dispatching" },
    workerId,
    leaseToken: `lease-${item.id}`,
    leaseExpiresAt: "2026-07-03T00:01:00.000Z",
    attempt: 1,
    dialIdempotencyKey: `agent-dial:${item.callId}`,
  };
}
