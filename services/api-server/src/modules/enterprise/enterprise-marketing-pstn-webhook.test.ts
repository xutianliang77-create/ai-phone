import { describe, expect, it } from "vitest";
import type { EnterpriseMarketingPstnWebhookRequest } from
  "@translation/contracts";
import { signEnterpriseMarketingPstnWebhook,
  verifyEnterpriseMarketingPstnWebhook } from
  "./enterprise-marketing-pstn-webhook.js";

const body: EnterpriseMarketingPstnWebhookRequest = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  taskId: "00000000-0000-4000-8000-000000000002",
  homeRegion: "cn-north", cellId: "cell-a", routeEpoch: 3,
  dispatchGeneration: 2, eventId: "provider-event-1",
  callId: "00000000-0000-4000-8000-000000000003", status: "completed",
  consumedSeconds: 42,
};

describe("enterprise marketing PSTN webhook", () => {
  it("signs every route and generation fence and rejects tampering", () => {
    const secret = "enterprise-marketing-pstn-webhook-secret";
    const signature = signEnterpriseMarketingPstnWebhook(secret, body);
    expect(verifyEnterpriseMarketingPstnWebhook({ body, signature,
      env: { ENTERPRISE_MARKETING_PSTN_WEBHOOK_SECRET: secret } }))
      .toEqual({ status: "verified", body });
    expect(verifyEnterpriseMarketingPstnWebhook({
      body: { ...body, dispatchGeneration: 3 }, signature,
      env: { ENTERPRISE_MARKETING_PSTN_WEBHOOK_SECRET: secret } }).status)
      .toBe("invalid_signature");
  });
});
