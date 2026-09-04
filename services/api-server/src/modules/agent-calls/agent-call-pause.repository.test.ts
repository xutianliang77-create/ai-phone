import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createAgentCallDraft } from "./agent-calls.repository.js";
import {
  pauseAgentCallDraft,
  resumePausedAgentCallDraft,
} from "./agent-call-pause.repository.js";

describe("Agent call pause state", () => {
  beforeEach(() => {
    getStoreSnapshot().agentCallDrafts = [];
  });

  it("persists idempotent pause and resume without changing the phone call", () => {
    const draft = createAgentCallDraft("user-1", {
      scenario: "booking",
      objective: "预约复诊",
    })!;
    draft.status = "in_progress";
    draft.callId = "call-1";
    draft.providerOperationId = "operation-1";

    const paused = pauseAgentCallDraft("user-1", draft.id);
    const pauseReplay = pauseAgentCallDraft("user-1", draft.id);
    const resumed = resumePausedAgentCallDraft("user-1", draft.id);
    const resumeReplay = resumePausedAgentCallDraft("user-1", draft.id);

    expect(paused).toMatchObject({
      status: "updated",
      draft: {
        status: "in_progress",
        callId: "call-1",
        providerOperationId: "operation-1",
        agentControlState: "paused",
      },
    });
    expect(pauseReplay.status).toBe("replayed");
    expect(resumed).toMatchObject({
      status: "updated",
      draft: {
        status: "in_progress",
        callId: "call-1",
        providerOperationId: "operation-1",
        agentControlState: "running",
      },
    });
    expect(resumeReplay.status).toBe("replayed");
    if (!("draft" in paused) || !("draft" in resumed)) {
      throw new Error("Pause transition did not return a draft");
    }
    expect(paused.draft.agentPausedAt).toBeTypeOf("string");
    expect(resumed.draft.agentResumedAt).toBeTypeOf("string");
  });

  it("rejects pause outside an active Agent call", () => {
    const draft = createAgentCallDraft("user-1", {
      scenario: "booking",
      objective: "预约复诊",
    })!;

    expect(pauseAgentCallDraft("user-1", draft.id)).toMatchObject({
      status: "invalid_state",
      draft: { status: "draft" },
    });
  });
});
