import { describe, expect, it } from "vitest";
import { runAgentEgressLoadSession } from "./agent_egress_load_session.mjs";

describe("Agent Egress load session", () => {
  it("waits for bound consent, proves Egress replay, holds, verifies, and cancels", async () => {
    const clock = new FakeClock();
    const requests = [];
    const targetPhone = "+8613800138000";
    const result = await runAgentEgressLoadSession({
      apiBaseUrl: "https://staging.example.cn",
      sessionId: "capacity-25-agent-001",
      targetPhone,
      language: "zh",
      durationMs: 1000,
      accountToken: "private-account-token",
      consentPromptVersion: "cn-agent-v1",
      disclosurePromptVersion: "cn-agent-disclosure-v1",
      recordingPolicyVersion: "voice-agent-recording-v1",
      requestTimeoutMs: 1000,
      statusPollMs: 100,
      agentStartTimeoutMs: 1000,
      consentTimeoutMs: 1000,
      egressStartTimeoutMs: 1000,
      artifactTimeoutMs: 1000,
      nowMs: () => clock.now,
      sleep: (ms) => clock.sleep(ms),
      fetchFn: fakeApi(requests),
    });

    expect(result).toMatchObject({
      status: "passed",
      environment: "staging",
      realProviderTraffic: true,
      trafficKinds: ["api", "livekit", "sip", "agent", "egress"],
      finalEventObserved: true,
      providerSideEffectDuplicates: 0,
      lostFinalEvents: 0,
      duplicateSettlements: 0,
      metrics: { sessionStartMs: 100, finalLatencyMs: 100 },
      observedDurationMs: 1100,
    });
    expect(result.providerEvidence).toMatchObject({
      sip: ["provider-call:sip-call-[REDACTED_TARGET]"],
      egress: [
        "recording:egress-1",
        `artifact:artifact-1:${"a".repeat(64)}:${"b".repeat(64)}`,
      ],
    });
    expect(JSON.stringify(result)).not.toContain(targetPhone);
    expect(JSON.stringify(result)).not.toContain("13800138000");
    const starts = requests.filter((item) => item.url.endsWith("/recordings") &&
      item.method === "POST");
    expect(starts).toHaveLength(2);
    expect(starts[0].body).toEqual(starts[1].body);
    expect(requests.filter((item) => item.url.endsWith("/stop"))).toHaveLength(1);
    expect(requests.filter((item) => item.url.endsWith("/cancel"))).toHaveLength(1);
    expect(requests.find((item) => item.url.endsWith("/drafts"))?.body.targetPhone)
      .toBe(targetPhone);
  });

  it("does not start Egress when the callee refuses recording", async () => {
    const clock = new FakeClock();
    const requests = [];
    await expect(runAgentEgressLoadSession({
      apiBaseUrl: "https://staging.example.cn",
      sessionId: "capacity-25-agent-refused",
      targetPhone: "+8613800138000",
      language: "zh",
      durationMs: 1000,
      accountToken: "private-account-token",
      consentPromptVersion: "cn-agent-v1",
      disclosurePromptVersion: "cn-agent-disclosure-v1",
      recordingPolicyVersion: "voice-agent-recording-v1",
      requestTimeoutMs: 1000,
      statusPollMs: 100,
      agentStartTimeoutMs: 1000,
      consentTimeoutMs: 1000,
      egressStartTimeoutMs: 1000,
      artifactTimeoutMs: 1000,
      nowMs: () => clock.now,
      sleep: (ms) => clock.sleep(ms),
      fetchFn: fakeApi(requests, { refused: true }),
    })).rejects.toThrow("did not grant recording consent");

    expect(requests.some((item) => item.url.endsWith("/recordings")))
      .toBe(false);
    expect(requests.filter((item) => item.url.endsWith("/cancel")))
      .toHaveLength(1);
  });
});

class FakeClock {
  now = 0;
  async sleep(ms) { this.now += ms; }
}

function fakeApi(requests, options = {}) {
  let recordingStarts = 0;
  let stopped = false;
  let listsAfterStop = 0;
  return async (url, init) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, method, body, headers: init.headers });
    if (url.endsWith("/health")) return json({
      callRoomReadiness: { status: "ready" },
      pstnReadiness: { status: "ready", provider: "livekit_sip" },
      voiceAgentRuntimeReadiness: { status: "ready", provider: "livekit_dispatch" },
      egressReadiness: { status: "ready" },
    });
    if (url.endsWith("/ai-calling-agent/drafts") && method === "POST") {
      return json({ draft: { id: "draft-1", status: "draft" } }, 201);
    }
    if (url.endsWith("/authorize")) return json({ draft: {
      id: "draft-1",
      status: "authorized",
      recordingRequested: true,
      recordingPolicyVersion: "voice-agent-recording-v1",
    } });
    if (url.endsWith("/start")) return json({ draft: {
      id: "draft-1", status: "queued", callId: "call-1",
    } });
    if (url.endsWith("/ai-calling-agent/drafts/draft-1") && method === "GET") {
      return json({ draft: activeDraft() });
    }
    if (url.endsWith("/recording-consents")) return json({
      consents: [{ ...consent(), status: options.refused ? "revoked" : "granted" }],
    });
    if (url.endsWith("/recordings") && method === "POST") {
      recordingStarts += 1;
      return json({
        ...activeRecording(),
        replayed: recordingStarts > 1,
      }, 202);
    }
    if (url.endsWith("/recordings") && method === "GET") {
      if (!stopped) return json({ recordings: [activeRecording()] });
      listsAfterStop += 1;
      return json({ recordings: [listsAfterStop === 1
        ? { ...activeRecording(), status: "stopping" }
        : completedRecording()] });
    }
    if (url.endsWith("/stop")) {
      stopped = true;
      return json({ ...activeRecording(), status: "stopping" }, 202);
    }
    if (url.endsWith("/cancel")) {
      return json({ draft: { ...activeDraft(), status: "cancelled" } });
    }
    return json({ error: { code: "not_found", message: "not found" } }, 404);
  };
}

function activeDraft() {
  return {
    id: "draft-1",
    status: "in_progress",
    callId: "call-1",
    providerCallId: "sip-call-13800138000",
  };
}

function consent() {
  return {
    status: "granted",
    source: "voice_agent_runtime",
    participantRole: "guest",
    joinType: "sip",
    policyVersion: "voice-agent-recording-v1",
    generation: 2,
    runtimeEventId: "consent-event-1",
    evidenceHash: "c".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

function activeRecording() {
  return {
    id: "recording-1",
    sessionId: "session-1",
    status: "active",
    providerOperationId: "operation-1",
    externalRecordingId: "egress-1",
    artifacts: [],
  };
}

function completedRecording() {
  return {
    ...activeRecording(),
    status: "completed",
    artifacts: [{
      id: "artifact-1",
      status: "verified",
      sha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
      verifiedAt: "2026-07-18T00:00:00.000Z",
    }],
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
