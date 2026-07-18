import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  captureAgentCallEnv,
  clearAgentCallEnv,
  restoreAgentCallEnv,
} from "./agent-calls.test-support.js";

describe("Voice Agent recording authorization route", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureAgentCallEnv();
    clearAgentCallEnv();
    getStoreSnapshot().agentCallDrafts = [];
  });

  afterEach(() => restoreAgentCallEnv(previousEnv));

  it("fails closed and persists the exact recording policy", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/ai-calling-agent/drafts",
      payload: {
        scenario: "booking",
        objective: "咨询营业时间",
        targetPhone: "13800138000",
      },
    });
    const draftId = created.json().draft.id as string;
    const request = {
      userConfirmed: true,
      consentPromptVersion: "cn-agent-v1",
      recordingRequested: true,
      recordingPolicyVersion: "voice-agent-recording-v1",
    };
    const disabled = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/authorize`,
      payload: request,
    });
    configureRecordingConsent();
    const mismatch = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/authorize`,
      payload: { ...request, recordingPolicyVersion: "other-policy" },
    });
    const authorized = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/authorize`,
      payload: request,
    });
    await app.close();

    expect(disabled.statusCode).toBe(503);
    expect(disabled.json().error.code).toBe("voice_agent_recording_not_ready");
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe("voice_agent_recording_policy_invalid");
    expect(authorized.json().draft).toMatchObject({
      status: "authorized",
      recordingRequested: true,
      recordingPolicyVersion: "voice-agent-recording-v1",
    });
  });
});

function configureRecordingConsent() {
  process.env.VOICE_AGENT_RECORDING_ENABLED = "true";
  process.env.VOICE_AGENT_RECORDING_POLICY_VERSION = "voice-agent-recording-v1";
  process.env.VOICE_AGENT_RECORDING_CONSENT_TEXT_ZH =
    "这是用于测试的明确录音同意问题，请回答同意或不同意。";
  process.env.VOICE_AGENT_RECORDING_CONSENT_TEXT_EN =
    "This test asks for explicit recording consent. Please answer yes or no.";
  process.env.VOICE_AGENT_RECORDING_CONSENT_TTL_SECONDS = "600";
}
