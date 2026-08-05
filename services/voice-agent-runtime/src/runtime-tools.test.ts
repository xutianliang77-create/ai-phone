import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildVoiceAgentTools, type VoiceAgentUserData } from "./runtime-tools.js";

describe("buildVoiceAgentTools recording consent", () => {
  it("exposes the tool only for requested recording and sends only an evidence hash", async () => {
    const event = vi.fn().mockResolvedValue({ command: "continue" });
    const rawUtterance = "我明确同意这通电话录音";
    const data = {
      api: { event },
      ticket: { raw: "ticket" },
      snapshot: {
        run: { id: "run-1" },
        recordingConsent: {
          policyVersion: "voice-agent-recording-v1",
          promptText: "请问您是否同意录音？",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
      room: {},
      resultReported: false,
      takeoverRequested: false,
    } as unknown as VoiceAgentUserData;
    const tools = buildVoiceAgentTools(data);
    const consentTool = tools.find((item) => item.name === "record_recording_consent");

    await consentTool!.execute({
      status: "granted",
      calleeUtterance: rawUtterance,
    }, {} as never);

    const payload = event.mock.calls[0]![0];
    expect(payload).toMatchObject({
      event: "recording_consent",
      recordingConsent: {
        status: "granted",
        policyVersion: "voice-agent-recording-v1",
        evidenceHash: createHash("sha256").update(rawUtterance).digest("hex"),
      },
    });
    expect(JSON.stringify(payload)).not.toContain(rawUtterance);
    expect(data.recordingConsentStatus).toBe("granted");
  });

  it("does not publish SIP DTMF when the Air provider executed it in the API", async () => {
    const authorizeTool = vi.fn().mockResolvedValue({
      executionId: "execution-1",
      authorized: true,
      executionMode: "provider_api",
      providerStatus: "succeeded",
    });
    const publishDtmf = vi.fn();
    const completeTool = vi.fn();
    const data = {
      api: { authorizeTool, completeTool },
      ticket: { raw: "ticket" },
      snapshot: { run: { id: "run-1" } },
      room: { localParticipant: { publishDtmf } },
      resultReported: false,
      takeoverRequested: false,
    } as unknown as VoiceAgentUserData;
    const dtmf = buildVoiceAgentTools(data).find((item) => item.name === "send_dtmf");

    await expect(dtmf!.execute({ digit: "5", reason: "IVR asked" }, {
      toolCallId: "tool-1",
    } as never)).resolves.toEqual({ pressed: "5" });

    expect(authorizeTool).toHaveBeenCalledOnce();
    expect(publishDtmf).not.toHaveBeenCalled();
    expect(completeTool).not.toHaveBeenCalled();
  });

  it("does not expose recording consent when the owner did not request recording", () => {
    const data = {
      api: {}, ticket: {}, snapshot: { run: { id: "run-1" } }, room: {},
      resultReported: false, takeoverRequested: false,
    } as unknown as VoiceAgentUserData;

    expect(buildVoiceAgentTools(data).map((item) => item.name))
      .not.toContain("record_recording_consent");
  });
});
