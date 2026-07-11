import type { AiCallingAgentDraftDto } from "@translation/contracts";
import { describe, expect, it } from "vitest";
import { AgentCallDispatcher } from "./agent-call-dispatcher.js";
import type { AgentCallApi, PstnBridge, PstnBridgeCallResult } from "./types.js";

describe("AgentCallDispatcher", () => {
  it("dispatches queued calls and marks them in progress", async () => {
    const api = new RecordingApi([draft("draft_1")]);
    const bridge = new FakeBridge({ providerCallId: "pstn_1" });
    const dispatcher = new AgentCallDispatcher({ api, bridge, batchSize: 5 });

    const count = await dispatcher.dispatchOnce();

    expect(count).toBe(1);
    expect(bridge.placed.map((item) => item.id)).toEqual(["draft_1"]);
    expect(api.updates).toEqual([{
      draftId: "draft_1",
      request: { status: "in_progress", providerCallId: "pstn_1" },
    }]);
  });

  it("marks queued calls failed when the bridge rejects", async () => {
    const api = new RecordingApi([draft("draft_1")]);
    const bridge = new FailingBridge();
    const dispatcher = new AgentCallDispatcher({ api, bridge, batchSize: 5 });

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

  async listQueued(_limit: number) {
    return this.queued;
  }

  async updateStatus(draftId: string, request: object) {
    this.updates.push({ draftId, request });
    return draft(draftId);
  }
}

class FakeBridge implements PstnBridge {
  readonly placed: AiCallingAgentDraftDto[] = [];

  constructor(private readonly result: PstnBridgeCallResult) {}

  async placeCall(draftItem: AiCallingAgentDraftDto) {
    this.placed.push(draftItem);
    return this.result;
  }
}

class FailingBridge implements PstnBridge {
  async placeCall(_draftItem: AiCallingAgentDraftDto) {
    throw new Error("bridge unavailable");
  }
}
