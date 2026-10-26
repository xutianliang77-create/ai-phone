import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signGatewayStopReceipt } from "@translation/platform-security";
import { buildApp } from "../../app.js";
import { createEmptyStoreSnapshot, getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { loginWithPhoneCode, logout } from "../account/account.service.js";
import { authorizationSessionHash } from "../account/auth-session-binding.js";
import { recoverStaleRealtimeSessions } from "../sessions/stale-session-recovery.js";
import { getHeldSeconds } from "../usage/usage.service.js";
import { gatewayStopHoldNote } from "../usage/gateway-stop-hold.js";

const key = "fixture-only-formal-gateway-signing-secret";
const internal = { authorization: "Bearer fixture-internal-secret-only" };
const input = { mode: "conversation", sourceLanguage: "zh", targetLanguage: "en", voiceOutput: false };

describe("formal HTTP admission and server-authoritative settlement", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let authorization: string;
  let owner: string;
  beforeEach(async () => {
    vi.stubEnv("DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL", "app_store");
    vi.stubEnv("REALTIME_TOKEN_SECRET", key);
    vi.stubEnv("INTERNAL_API_SECRET", "fixture-internal-secret-only");
    vi.stubEnv("API_TEST_AUTO_ACCOUNT", "false");
    vi.stubEnv("AUTH_TEST_PHONE", "13900139002");
    vi.stubEnv("AUTH_TEST_CODE", "123456");
    Object.assign(getStoreSnapshot(), createEmptyStoreSnapshot());
    const login = loginWithPhoneCode("13900139002", "123456");
    if (!login.ok) throw new Error("fixture login failed");
    authorization = `Bearer ${login.token}`; owner = login.account.id;
    getStoreSnapshot().usageBalances[owner] = 100;
    getStoreSnapshot().usagePlanCodes[owner] = "free";
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); vi.unstubAllEnvs(); });

  async function create() {
    const result = await app.inject({ method: "POST", url: "/realtime/sessions", headers: { authorization }, payload: input });
    expect(result.statusCode).toBe(200);
    return result.json().sessionId as string;
  }
  function state(id: string, fresh = true) {
    return app.inject({ method: "POST", url: `/internal/realtime/sessions/${id}/state`,
      headers: internal, payload: { status: "active", fresh } });
  }
  function finalize(id: string, gatewayReceipt?: string, billableSeconds = 999) {
    return app.inject({ method: "POST", url: `/realtime/sessions/${id}/finalize`, headers: { authorization },
      payload: { sessionId: id, idempotencyKey: `finalize:${id}`, segments: [], billableSeconds,
        ...(gatewayReceipt ? { gatewayReceipt } : {}) } });
  }
  function receipt(id: string, userId = owner) {
    return signGatewayStopReceipt({ sessionId: id, userId, billableSeconds: 12,
      providerClosed: true, issuedAt: Date.now() }, key);
  }

  it("binds only a hash of login identity and prevents a second fresh admission", async () => {
    const id = await create();
    expect(getStoreSnapshot().sessions[0].ownerAuthSessionHash).toBe(authorizationSessionHash(authorization));
    expect(getStoreSnapshot().usageHolds[0].note).toBe(gatewayStopHoldNote);
    expect((await state(id)).statusCode).toBe(200);
    expect((await state(id)).statusCode).toBe(409);
    expect((await state(id, false)).statusCode).toBe(200);
    logout(authorization);
    expect((await state(id, false)).statusCode).toBe(403);
    expect(getStoreSnapshot().sessions[0].status).toBe("active");
  });

  it.each([0, 999])("rejects unproven client seconds %s without changing hold or ledger", async (seconds) => {
    const id = await create(); await state(id);
    expect((await finalize(id, undefined, seconds)).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/realtime/sessions/${id}/end`, headers: { authorization } })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `/sessions/${id}`, headers: { authorization } })).statusCode).toBe(409);
    expect(getHeldSeconds(owner)).toBe(30);
    expect(getStoreSnapshot().billingLedger).toHaveLength(0);
  });

  it("settles one signed server amount despite racing retries and ignores client zero", async () => {
    const id = await create(); await state(id); const proof = receipt(id);
    const results = await Promise.all([finalize(id, proof, 0), finalize(id, proof),
      app.inject({ method: "POST", url: `/internal/realtime/sessions/${id}/end`, headers: internal,
        payload: { billableSeconds: 999, gatewayReceipt: proof } })]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(getStoreSnapshot().billingLedger).toMatchObject([{ sessionId: id, deltaSeconds: -12, idempotencyKey: `settle:${id}` }]);
    expect(getStoreSnapshot().usageBalances[owner]).toBe(88);
    expect(getHeldSeconds(owner)).toBe(0);
    expect((await state(id)).statusCode).toBe(409);
  });

  it("retains an internal stop proof for a client whose event was lost", async () => {
    const id = await create(); await state(id);
    expect((await app.inject({ method: "POST", url: `/internal/realtime/sessions/${id}/end`, headers: internal,
      payload: { gatewayReceipt: receipt(id) } })).statusCode).toBe(200);
    expect((await finalize(id)).json().consumedSeconds).toBe(12);
    expect(getStoreSnapshot().billingLedger).toHaveLength(1);
  });

  it("refuses tampered, wrong-session and wrong-owner receipts before any ledger change", async () => {
    const id = await create(); await state(id);
    for (const proof of [receipt("another-session"), receipt(id, "another-owner"), receipt(id) + "x"]) {
      expect((await finalize(id, proof)).statusCode).toBe(409);
    }
    expect(getStoreSnapshot().billingLedger).toHaveLength(0);
    expect(getHeldSeconds(owner)).toBe(30);
  });

  it("permits trusted zero only before new formal admission and blocks later admission", async () => {
    const id = await create();
    expect((await finalize(id)).json().consumedSeconds).toBe(0);
    expect(getHeldSeconds(owner)).toBe(0);
    expect((await state(id)).statusCode).toBe(409);
  });

  it("does not infer closure from stale heartbeats or an expired marked hold", async () => {
    const id = await create(); await state(id);
    const store = getStoreSnapshot();
    store.sessions[0].createdAt = store.sessions[0].lastActivityAt = "2026-01-01T00:00:00Z";
    store.usageHolds[0].expiresAt = "2026-01-01T01:00:00Z";
    expect((await recoverStaleRealtimeSessions()).recoveredCount).toBe(0);
    expect(getHeldSeconds(owner)).toBe(30);
    delete store.sessions[0].ownerAuthSessionHash;
    store.sessions[0].status = "created";
    expect((await finalize(id)).statusCode).toBe(409);
  });

  it("rejects a deferred language or cloned voice before creating a hold", async () => {
    for (const patch of [{ targetLanguage: "fr" }, { voice: { mode: "personal_clone" }, voiceOutput: true }]) {
      const response = await app.inject({ method: "POST", url: "/realtime/sessions", headers: { authorization }, payload: { ...input, ...patch } });
      expect(response.statusCode).toBe(400);
    }
    expect(getStoreSnapshot().usageHolds).toHaveLength(0);
  });

  it("does not substitute a formal test account even with an explicit fallback flag", async () => {
    vi.stubEnv("API_TEST_AUTO_ACCOUNT", "true");
    expect((await app.inject({ method: "GET", url: "/sessions" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/realtime/sessions", payload: input })).statusCode).toBe(401);
  });

  it("does not resume an old revoked login after relogin, but accepts its owner-bound stop receipt", async () => {
    const id = await create(); await state(id); logout(authorization);
    const login = loginWithPhoneCode("13900139002", "123456");
    if (!login.ok) throw new Error("fixture relogin failed");
    authorization = `Bearer ${login.token}`;
    expect((await state(id, false)).statusCode).toBe(403);
    expect((await finalize(id, receipt(id))).statusCode).toBe(200);
    expect(getHeldSeconds(owner)).toBe(0);
  });
});
