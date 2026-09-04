import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelephonyProvider } from "@translation/contracts";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { setAir780CallLinkTelephonyRuntimeForTests } from
  "./air780-call-link-outbound-coordinator.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";
import { setCallLinkWorkerSupervisorForTests } from
  "./call-link-worker-supervisor.js";
import {
  air780DialPayload,
  air780DialResult,
  captureAir780TestEnv,
  configureAir780TestEnv,
  createHostReadyAir780Call,
  fakeAir780Runtime,
  ReadyAir780Worker,
  resetAir780TestStore,
  restoreAir780TestEnv,
} from "./call-link-air780.routes.test-support.js";

describe("Call Link Air780 hangup binding recovery", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureAir780TestEnv();
    configureAir780TestEnv();
    resetAir780TestStore();
    setCallRoomDataPublisherForTests({ async ensureRoom() {} });
    setCallLinkWorkerSupervisorForTests(new ReadyAir780Worker());
  });

  afterEach(() => {
    setAir780CallLinkTelephonyRuntimeForTests(null);
    setCallRoomDataPublisherForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    restoreAir780TestEnv(previousEnv);
  });

  it("retries the same undispatched operation after its binding recovers", async () => {
    const hangupPhoneCall = vi.fn<TelephonyProvider["hangupPhoneCall"]>(
      async (request) => ({
        ok: true,
        provider: "air780_volte" as const,
        externalOperationId: request.operationId,
        externalResourceId: request.payload.providerCallId,
        capabilities: ["hangup"],
        result: {
          communicationSessionId: request.payload.communicationSessionId,
          providerCallId: request.payload.providerCallId,
          state: "ending" as const,
        },
      }),
    );
    const runtime = fakeAir780Runtime({
      placePhoneCall: vi.fn(async (request) => air780DialResult(request.payload)),
      hangupPhoneCall,
    });
    const resolveBinding = runtime.resolveControlPayload.bind(runtime);
    let bindingAvailable = false;
    runtime.resolveControlPayload = async (input) => {
      if (!bindingAvailable) throw new Error("binding unavailable");
      return resolveBinding(input);
    };
    setAir780CallLinkTelephonyRuntimeForTests(runtime);
    const app = await buildApp();
    const callId = await createHostReadyAir780Call(app);
    await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-outbound`,
      payload: air780DialPayload(),
    });

    const first = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-hangup`,
      payload: {},
    });
    const firstOperation = getStoreSnapshot().providerOperations.find(
      (operation) => operation.operationType === "phone_hangup",
    );
    expect(first.statusCode).toBe(409);
    expect(first.json()).toMatchObject({
      error: { code: "air780_call_binding_missing" },
    });
    expect(firstOperation).toMatchObject({
      status: "failed",
      lastErrorClass: "unavailable",
    });
    bindingAvailable = true;
    const retry = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-hangup`,
      payload: {},
    });
    await app.close();

    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({
      operationId: firstOperation?.id,
      status: "accepted",
      replayed: true,
    });
    expect(hangupPhoneCall).toHaveBeenCalledTimes(1);
    expect(getStoreSnapshot().providerOperations.find(
      (operation) => operation.id === firstOperation?.id,
    )).toMatchObject({ status: "accepted", attempt: 2 });
  });

  it("coalesces concurrent retries after a definitely undispatched failure", async () => {
    const hangupPhoneCall = vi.fn<TelephonyProvider["hangupPhoneCall"]>(
      async (request) => ({
        ok: true,
        provider: "air780_volte" as const,
        externalOperationId: request.operationId,
        externalResourceId: request.payload.providerCallId,
        capabilities: ["hangup"],
        result: {
          communicationSessionId: request.payload.communicationSessionId,
          providerCallId: request.payload.providerCallId,
          state: "ending" as const,
        },
      }),
    );
    const runtime = fakeAir780Runtime({
      placePhoneCall: vi.fn(async (request) => air780DialResult(request.payload)),
      hangupPhoneCall,
    });
    const resolveBinding = runtime.resolveControlPayload.bind(runtime);
    let bindingAvailable = false;
    runtime.resolveControlPayload = async (input) => {
      if (!bindingAvailable) throw new Error("binding unavailable");
      return resolveBinding(input);
    };
    setAir780CallLinkTelephonyRuntimeForTests(runtime);
    const app = await buildApp();
    const callId = await createHostReadyAir780Call(app);
    await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-outbound`,
      payload: air780DialPayload(),
    });
    await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-hangup`,
      payload: {},
    });
    bindingAvailable = true;

    const responses = await Promise.all([
      app.inject({ method: "POST", url: `/call-links/${callId}/air780-hangup`, payload: {} }),
      app.inject({ method: "POST", url: `/call-links/${callId}/air780-hangup`, payload: {} }),
    ]);
    await app.close();

    expect(responses.map((response) => response.statusCode)).toEqual([202, 202]);
    expect(hangupPhoneCall).toHaveBeenCalledTimes(1);
    expect(getStoreSnapshot().providerOperations.find(
      (operation) => operation.operationType === "phone_hangup",
    )).toMatchObject({ attempt: 2 });
  });
});
