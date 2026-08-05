import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { DeviceCallBindingConflict } from
  "./postgres-air-device-calls.repository.js";
import { setAirDeviceTrackAdmissionProcessorForTests } from
  "./air-device-track-admission.routes.js";

describe("Air device track admission route", () => {
  const previousSecret = process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET;

  beforeEach(() => {
    process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET = secret;
  });

  afterEach(() => {
    setAirDeviceTrackAdmissionProcessorForTests(null);
    if (previousSecret === undefined) {
      delete process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET;
    } else {
      process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET = previousSecret;
    }
  });

  it("admits only one strict fully fenced target track request", async () => {
    const admit = vi.fn(async () => admission);
    setAirDeviceTrackAdmissionProcessorForTests({ admit });
    const app = await buildApp();

    const accepted = await app.inject({
      method: "POST",
      url: "/internal/device-calls/track-admissions",
      headers: { authorization: `Bearer ${secret}` },
      payload: request,
    });
    const conflated = await app.inject({
      method: "POST",
      url: "/internal/device-calls/track-admissions",
      headers: { authorization: `Bearer ${secret}` },
      payload: { ...request, carrierState: "connected" },
    });
    await app.close();

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ status: "accepted", admission });
    expect(conflated.statusCode).toBe(400);
    expect(admit).toHaveBeenCalledWith(request);
  });

  it("rejects an old lease or generation as a binding conflict", async () => {
    setAirDeviceTrackAdmissionProcessorForTests({
      admit: vi.fn().mockRejectedValue(new DeviceCallBindingConflict()),
    });
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/internal/device-calls/track-admissions",
      headers: { authorization: `Bearer ${secret}` },
      payload: request,
    });
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("air_device_call_binding_conflict");
  });
});

const secret = "event-secret-123456789012345678901";
const targetParticipantIdentity = "comm-1:guest:air:air-780-1";
const request = {
  communicationSessionId: "comm-1",
  roomName: "call_comm-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
  targetParticipantIdentity,
  trackSid: "TR_tts_1",
  trackName: `translation-tts-guest-1.${Buffer.from(
    targetParticipantIdentity,
  ).toString("base64url")}`,
  publisherIdentity: "comm-1:worker:voice-agent-1",
};
const { roomName: _roomName, fencingToken: _fencingToken, ...admission } = request;
