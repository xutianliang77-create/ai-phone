import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";
import { toAgentCallDto } from "./agent-call-route-helpers.js";
import {
  createAgentCallDraft,
  markAgentCallTakeoverReady,
  requestAgentCallTakeover,
  resolveAgentCallTakeover,
  resumeAgentCallAfterTakeover,
} from "./agent-calls.repository.js";

describe("Agent takeover media binding", () => {
  beforeEach(() => {
    getStoreSnapshot().agentCallDrafts = [];
  });

  it("persists one exact Host identity and never exposes it in the public DTO", () => {
    const draft = createAgentCallDraft("user-1", {
      scenario: "custom",
      objective: "test takeover",
    })!;
    draft.status = "in_progress";
    draft.callId = "comm-1";
    draft.executionProvider = "air780_volte";
    draft.providerOperationId = "provider-operation-1";

    const requested = requestAgentCallTakeover("user-1", draft.id, {
      reason: "user_requested",
    })!;
    markAgentCallTakeoverReady(draft.id);
    const resolved = resolveAgentCallTakeover(
      draft.id,
      "comm-1:host:user-1",
    )!;
    const replay = requestAgentCallTakeover("user-1", draft.id, {
      reason: "replayed_request",
    })!;

    expect(resolved).toMatchObject({
      status: "takeover_requested",
      takeoverParticipantIdentity: "comm-1:host:user-1",
    });
    expect(replay.takeoverResolvedAt).toBe(resolved.takeoverResolvedAt);
    expect(replay.takeoverParticipantIdentity)
      .toBe("comm-1:host:user-1");
    expect(toAgentCallDto(resolved)).not.toHaveProperty(
      "takeoverParticipantIdentity",
    );
    expect(requested.takeoverRequestedAt).toBeTypeOf("string");
  });

  it("clears the Host media binding before the Agent resumes", () => {
    const draft = createAgentCallDraft("user-1", {
      scenario: "custom",
      objective: "test resume",
    })!;
    draft.status = "takeover_requested";
    draft.takeoverReadyAt = "2026-08-13T08:00:00.000Z";
    draft.takeoverResolvedAt = "2026-08-13T08:00:01.000Z";
    draft.takeoverParticipantIdentity = "comm-1:host:user-1";

    const resumed = resumeAgentCallAfterTakeover("user-1", draft.id)!;

    expect(resumed.status).toBe("in_progress");
    expect(resumed.takeoverParticipantIdentity).toBeUndefined();
    expect(resumed.agentControlState).toBe("running");
  });
});
