import { describe, expect, it } from "vitest";
import { agentCallStatusRequestFromPstnWebhook } from
  "./agent-call-webhook-runtime.js";

describe("PSTN agent webhook status projection", () => {
  it("preserves an unknown provider result for reconciliation", () => {
    expect(agentCallStatusRequestFromPstnWebhook({
      eventId: "air-carrier:event-1",
      callId: "call-1",
      providerCallId: "air-call-1",
      status: "failed",
      providerOperationStatus: "unknown",
      failureReason: "carrier_unknown",
      nextStep: "电话线路状态待服务商对账；对账完成前不得重拨。",
    })).toMatchObject({
      status: "failed",
      providerOperationStatus: "unknown",
      failureReason: "carrier_unknown",
    });
  });
});
