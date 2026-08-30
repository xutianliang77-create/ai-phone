import { describe, expect, it } from "vitest";
import { getEnterpriseBillingLifecycleReadiness,
  signEnterpriseBillingLifecycleRequest,
  verifyEnterpriseBillingLifecycleRequest,
  type EnterpriseBillingLifecycleWebhookBody } from
  "./enterprise-billing-lifecycle-auth.js";

const secret = "billing-lifecycle-secret-01234567890123456789";
const env = {
  ENTERPRISE_BILLING_LIFECYCLE_PROVIDER: "billing-adapter",
  ENTERPRISE_BILLING_LIFECYCLE_SIGNING_SECRET: secret,
  ENTERPRISE_BILLING_LIFECYCLE_REPLAY_SECONDS: "300",
};
const body: EnterpriseBillingLifecycleWebhookBody = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  provider: "billing-adapter",
  providerEventId: "event-1",
  subscriptionId: "00000000-0000-4000-8000-000000000002",
  eventType: "payment_failed",
  providerPayloadHash: "a".repeat(64),
  occurredAt: "2026-08-31T00:00:00.000Z",
  effectiveAt: "2026-08-31T00:00:00.000Z",
};

describe("enterprise billing lifecycle request authentication", () => {
  it("fails closed when the provider edge is not configured", () => {
    expect(getEnterpriseBillingLifecycleReadiness({})).toMatchObject({
      status: "not_ready",
      issues: ["billing_lifecycle_provider_not_configured",
        "billing_lifecycle_signing_secret_not_configured"],
    });
  });

  it("accepts only a current canonical HMAC envelope", () => {
    const timestamp = String(Date.parse(body.effectiveAt) / 1_000);
    const signature = signEnterpriseBillingLifecycleRequest({
      body, timestamp, secret,
    });
    expect(verifyEnterpriseBillingLifecycleRequest({
      body, timestamp, signature, env,
      now: new Date(body.effectiveAt),
    })).toMatchObject({ status: "verified", body });
  });

  it("rejects tampering and replay outside the bounded window", () => {
    const timestamp = String(Date.parse(body.effectiveAt) / 1_000);
    const signature = signEnterpriseBillingLifecycleRequest({
      body, timestamp, secret,
    });
    expect(verifyEnterpriseBillingLifecycleRequest({
      body: { ...body, eventType: "cancelled" }, timestamp, signature, env,
      now: new Date(body.effectiveAt),
    })).toMatchObject({ status: "invalid", reasonCode: "signature_invalid" });
    expect(verifyEnterpriseBillingLifecycleRequest({
      body, timestamp, signature, env,
      now: new Date("2026-08-31T00:06:00.000Z"),
    })).toMatchObject({ status: "invalid", reasonCode: "timestamp_invalid" });
  });
});
