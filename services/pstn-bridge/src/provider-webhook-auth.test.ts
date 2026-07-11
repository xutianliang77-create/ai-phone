import { describe, expect, it } from "vitest";
import { signProviderWebhookBody, verifyProviderWebhook } from "./provider-webhook-auth.js";

describe("provider webhook auth", () => {
  it("accepts a valid HMAC signature", () => {
    const body = JSON.stringify({ eventType: "media.frame" });
    const timestamp = 1000;
    const signature = signProviderWebhookBody({ body, secret: "secret", timestamp });

    expect(verifyProviderWebhook({
      body,
      secret: "secret",
      maxSkewMs: 1000,
      nowMs: 1200,
      headers: {
        "x-pstn-provider-timestamp": String(timestamp),
        "x-pstn-provider-signature": signature,
      },
    })).toEqual({ ok: true });
  });

  it("rejects stale or tampered signatures", () => {
    const body = JSON.stringify({ eventType: "media.frame" });
    const signature = signProviderWebhookBody({ body, secret: "secret", timestamp: 1000 });

    expect(verifyProviderWebhook({
      body,
      secret: "secret",
      maxSkewMs: 100,
      nowMs: 2000,
      headers: {
        "x-pstn-provider-timestamp": "1000",
        "x-pstn-provider-signature": signature,
      },
    })).toMatchObject({ ok: false, statusCode: 401, code: "stale_provider_signature" });

    expect(verifyProviderWebhook({
      body: `${body} `,
      secret: "secret",
      maxSkewMs: 1000,
      nowMs: 1200,
      headers: {
        "x-pstn-provider-timestamp": "1000",
        "x-pstn-provider-signature": signature,
      },
    })).toMatchObject({ ok: false, statusCode: 401, code: "invalid_provider_signature" });
  });
});
