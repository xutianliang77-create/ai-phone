import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import * as storage from "../../infrastructure/storage/json-store.js";
import { readFileSync } from "node:fs";
import { resultSyncHash, RESULT_SYNC_CONSENT_VERSION } from "./session-result-sync-contract.js";
import { syncSessionResults } from "./session-result-sync.service.js";
import type { SessionRecord } from "./session-record.js";

describe("authorized text-only result sync on the original session API", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID", "public-test");
    vi.stubEnv("API_TEST_AUTO_ACCOUNT", "true");
    const store = getStoreSnapshot();
    store.sessions = [session()]; store.billingLedger = []; store.usageHolds = [];
    store.usageBalances = {}; store.usagePlanCodes = {};
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const consent = (allowed = true) => ({ deploymentId: "public-test", modelPolicyRevision: "policy-v1",
    consentVersion: RESULT_SYNC_CONSENT_VERSION, allowed,
    expectedRevision:current().resultSyncState?.grantHistory?.length??0 });
  const current = () => getStoreSnapshot().sessions.find(s => s.id === "sync-session")!;
  const state = () => structuredClone({ sessions: getStoreSnapshot().sessions,
    ledger: getStoreSnapshot().billingLedger, holds: getStoreSnapshot().usageHolds });
  const setConsent = (allowed = true) => app.inject({ method: "POST",
    url: "/sessions/sync-session/result-sync-consent", payload: consent(allowed) });
  const body = (opId = "op-1", revision = 1, text = "你好") => {
    const segment = { id: "seg-1", revision, sourceText: text, translatedText: "Hello",
      rawText: text, optimizedText: text, sourceLanguage: "zh", targetLanguage: "en" };
    return { operation: "sync", sync: { contractVersion: 1, deploymentId: "public-test",
      opId, modelPolicyRevision: "policy-v1", scopeId: current().resultSyncState?.grant.scopeId ?? "ungranted",
      revisions: [{ segmentId: segment.id, revision, contentHash: resultSyncHash(segment) }] }, segments: [segment] };
  };
  const send = (payload: unknown) => app.inject({ method: "POST", url: "/sessions/sync-session/segments", payload: payload as object });

  it("atomically stores exact text and ACK, idempotently retries without inference/settlement/activity", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("external calls forbidden"));
    expect((await setConsent()).statusCode).toBe(200);
    const before = structuredClone(current());
    const result = await send(body());
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ operation: "sync", ownerId: "guest-user", deploymentId: "public-test", opId: "op-1" });
    expect(current().segments[0]).toEqual(body().segments[0]);
    expect(current().resultSyncState!.receipts[0].ack).toEqual(result.json());
    const saved = state();
    expect((await send(body())).json()).toEqual(result.json());
    expect(state()).toEqual(saved);
    expect(current().status).toBe(before.status);
    expect(current().consumedSeconds).toBe(before.consumedSeconds);
    expect(current().lastActivityAt).toBe(before.lastActivityAt);
    expect(getStoreSnapshot().billingLedger).toEqual([]);
    expect(getStoreSnapshot().usageHolds).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("matches the shared Dart hash fixture", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../../../../packages/contracts/fixtures/result-sync-v1.json",import.meta.url),"utf8"));
    expect(resultSyncHash(fixture.segment)).toBe(fixture.sha256);
  });
  it("rolls back both text and ACK when persistence fails", async () => {
    await setConsent();
    const before = state();
    vi.spyOn(storage,"persistStoreSnapshot").mockImplementationOnce(() => {throw new Error("injected persistence failure");});
    const reply = await send(body());
    expect(reply.statusCode).toBe(500);
    expect(state()).toEqual(before);
    expect((await send(body())).statusCode).toBe(200);
  });
  it("requires new session consent and cannot use a legacy private session", async () => {
    expect((await send(body())).statusCode).toBe(403);
    delete current().processingAuthorization;
    expect((await setConsent()).statusCode).toBe(403);
    expect(current().segments).toEqual([]);
  });
  it("requires authentication, ownership and deployment/policy binding", async () => {
    vi.stubEnv("API_TEST_AUTO_ACCOUNT", "false");
    expect((await setConsent()).statusCode).toBe(401);
    vi.stubEnv("API_TEST_AUTO_ACCOUNT", "true");
    current().userId = "another-owner";
    expect((await setConsent()).statusCode).toBe(403);
    current().userId = "guest-user";
    current().processingDeploymentId = "another-deployment";
    expect((await setConsent()).statusCode).toBe(403);
    current().processingDeploymentId = "public-test";
    current().processingAuthorization!.modelPolicyRevision = "new-policy";
    expect((await setConsent()).statusCode).toBe(409);
  });
  it("revocation invalidates even a previously accepted retry and new grants do not revive old scope", async () => {
    await setConsent(); const request = body(); await send(request);
    expect((await setConsent(false)).statusCode).toBe(200);
    expect(current().resultSyncState!.grant.scopeId).toBe(request.sync.scopeId);
    expect(current().resultSyncState!.grantHistory).toHaveLength(2);
    const revoked = state();
    expect((await send(request)).statusCode).toBe(403);
    expect(state()).toEqual(revoked);
    await setConsent();
    expect(current().resultSyncState!.grant.scopeId).not.toBe(request.sync.scopeId);
    expect((await send(request)).statusCode).toBe(403);
  });
  it("a delayed allow request cannot overwrite a newer revoke",async()=>{
    const delayed=consent(true);
    const before=await app.inject({method:"GET",url:"/sessions/sync-session/result-sync-consent"});
    expect(before.json().consentRevision).toBe(0);
    await setConsent(false);
    const reply=await app.inject({method:"POST",url:"/sessions/sync-session/result-sync-consent",payload:delayed});
    expect(reply.statusCode).toBe(409);expect(current().resultSyncState!.grant.revokedAt).toBeDefined();
  });
  it("rejects expired consent, wrong scope and client policy changes without mutation", async () => {
    await setConsent();
    for (const sync of [{...body().sync, scopeId:"other"}, {...body().sync, deploymentId:"private"},
      {...body().sync, modelPolicyRevision:"other"}]) {
      const before = state(); expect((await send({...body(), sync})).statusCode).toBe(403);
      expect(state()).toEqual(before);
    }
    current().resultSyncState!.grant.expiresAt = "2020-01-01T00:00:00Z";
    expect((await send(body())).statusCode).toBe(403);
  });
  it("does not let a new payload reuse an operation ID or downgrade a segment revision", async () => {
    await setConsent(); await send(body("first", 2));
    const before = state();
    expect((await send(body("first", 3, "changed"))).statusCode).toBe(409);
    expect((await send(body("second", 1))).statusCode).toBe(409);
    expect((await send(body("second", 2, "changed"))).statusCode).toBe(409);
    expect(state()).toEqual(before);
    expect((await send(body("second", 3, "changed"))).statusCode).toBe(200);
  });
  it("rejects forged billing/provider/speaker data and incorrect content hashes atomically", async () => {
    await setConsent();
    const original = body(); const before = state();
    for (const extra of [{providerUsage:{billableSeconds:0}}, {speaker:{source:"diarization"}}, {provider:"public"}]) {
      const segment = {...original.segments[0], ...extra};
      expect((await send({...original, segments:[segment], sync:{...original.sync,
        revisions:[{segmentId:segment.id,revision:1,contentHash:resultSyncHash(segment)}]}})).statusCode).toBe(400);
    }
    expect((await send({...original, billableSeconds:0})).statusCode).toBe(409);
    expect((await send({...original, segments:[{...original.segments[0],sourceText:"tampered"}]})).statusCode).toBe(400);
    expect(state()).toEqual(before);
  });
  it("checks language direction and blocks prototype keys", async () => {
    await setConsent(); const original = body();
    for (const segment of [{...original.segments[0],sourceLanguage:"fr"}, {...original.segments[0],id:"__proto__"}]) {
      const response = await send({...original, segments:[segment], sync:{...original.sync,
        revisions:[{segmentId:segment.id,revision:1,contentHash:resultSyncHash(segment)}]}});
      expect([400,409]).toContain(response.statusCode);
    }
    expect(current().segments).toEqual([]);
  });
  it("retries accepted ACK after end but rejects new writes or resurrection after delete", async () => {
    await setConsent(); const request = body(); const ack = (await send(request)).json();
    current().status = "ended";
    expect((await send(request)).json()).toEqual(ack);
    expect((await send(body("new",2))).statusCode).toBe(409);
    getStoreSnapshot().sessions = [];
    expect((await send(request)).statusCode).toBe(404);
    expect(getStoreSnapshot().sessions).toEqual([]);
  });
  it("blocks legacy save and finalization downgrade for a versioned session", async () => {
    await setConsent(); const before = state();
    expect((await send({segments:body().segments})).statusCode).toBe(409);
    const response = await app.inject({method:"POST",url:"/realtime/sessions/sync-session/finalize",payload:{
      sessionId:"sync-session",idempotencyKey:"finalize:sync-session",billableSeconds:0,segments:[]}});
    expect(response.statusCode).toBe(503);
    expect((await app.inject({method:"POST",url:"/realtime/sessions/sync-session/end"})).statusCode).toBe(503);
    expect(state()).toEqual(before);
  });
  it("handles concurrent duplicate requests as one durable receipt", async () => {
    await setConsent();
    const replies = await Promise.all(Array.from({length:10}, () => send(body())));
    expect(replies.every(r=>r.statusCode===200)).toBe(true);
    expect(current().resultSyncState!.receipts).toHaveLength(1);
    expect(new Set(replies.map(r=>JSON.stringify(r.json()))).size).toBe(1);
  });
  it("fails closed at capacity and never returns an ACK if persistence planning fails", async () => {
    await setConsent(); await send(body());
    current().resultSyncState!.receipts = Array.from({length:512},(_,i)=>({...current().resultSyncState!.receipts[0],opId:`old-${i}`}));
    const before = state();
    await expect(syncSessionResults("sync-session","guest-user",body("overflow",2))).rejects.toMatchObject({code:"result_sync_receipt_capacity"});
    expect(state()).toEqual(before);
  });
});

function session(): SessionRecord {
  return {id:"sync-session", userId:"guest-user", mode:"conversation", status:"active",consumedSeconds:17,
    createdAt:new Date().toISOString(),lastActivityAt:new Date().toISOString(),segments:[],version:1,
    processingDeploymentId:"public-test", processingAuthorization:{contractVersion:1,processingMode:"online",
      modelPolicyRevision:"policy-v1", languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},
      executionPlan:{asr:{execution:"public",scopeKey:"asr",reason:"online_selected"},
        translation:{execution:"public",scopeKey:"mt",reason:"online_selected"},tts:{execution:"disabled"}},
      syncPermission:{allowed:false}}};
}
