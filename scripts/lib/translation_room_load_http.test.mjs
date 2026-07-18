import { describe, expect, it, vi } from "vitest";
import {
  admissionRejectionAttestation,
  LoadHttpError,
  requestLoadJson,
} from "./translation_room_load_http.mjs";

describe("translation room load HTTP", () => {
  it("keeps the account token in the request and out of the result", async () => {
    const fetchFn = vi.fn(async (_url, init) => new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const result = await requestLoadJson({
      fetchFn,
      requestTimeoutMs: 1000,
      accountToken: "staging-account-secret",
    }, "https://staging.example.cn/call-links", {
      method: "POST",
      account: true,
      body: { purpose: "test" },
    });

    expect(result.body).toEqual({ ok: true });
    expect(fetchFn.mock.calls[0][1].headers.authorization)
      .toBe("Bearer staging-account-secret");
    expect(fetchFn.mock.calls[0][1].redirect).toBe("error");
    expect(JSON.stringify(result)).not.toContain("staging-account-secret");
  });

  it("only converts explicit capacity responses into admission rejection", () => {
    expect(admissionRejectionAttestation(
      new LoadHttpError(429, { error: { code: "capacity_exhausted" } }, "url"),
      50,
    )).toMatchObject({
      status: "rejected",
      admissionEvidence: ["http:429:capacity_exhausted"],
    });
    expect(admissionRejectionAttestation(
      new LoadHttpError(503, { error: { code: "provider_down" } }, "url"),
      50,
    )).toBeNull();
  });
});
