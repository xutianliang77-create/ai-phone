import { describe, expect, it, vi } from "vitest";
import {
  airGatewayCarrierEventRequest,
  airGatewayLiveKitEventRequest,
  airGatewayHeartbeatRequest,
  AirGatewayCarrierStateRegistry,
  HttpAirGatewayCarrierEventClient,
} from "./air-gateway-carrier-client.js";

describe("Air Gateway carrier event client", () => {
  it("builds a stable boot-bound event id and posts no phone or room secret", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: "accepted",
      call: { carrierState: "connected" },
    }), { status: 200 }));
    const client = new HttpAirGatewayCarrierEventClient({
      apiBaseUrl: "https://api.example.cn",
      apiSecret: secret,
      timeoutMs: 1_000,
    }, fetchFn);
    const event = airGatewayCarrierEventRequest(carrier, "boot-1",
      new Date("2026-08-04T12:00:00.000Z"));

    await client.publish(event);

    expect(event.eventId).toMatch(/^air_evt_[0-9a-f]{48}$/);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.cn/internal/device-calls/carrier-events",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(event),
      }),
    );
    expect(JSON.stringify(event)).not.toContain("room-token");
  });

  it("uses carrier state as reconcile authority with terminal mapping", () => {
    const registry = new AirGatewayCarrierStateRegistry();
    registry.observe(carrier);
    expect(registry.reconcile(carrier)).toMatchObject({ state: "connected" });

    registry.observe({
      ...carrier,
      carrierState: "busy",
      carrierCause: "busy",
      eventSequence: 11,
    });
    expect(registry.reconcile(carrier)).toMatchObject({ state: "failed" });
    expect(registry.reconcile({ ...carrier, callGeneration: 2 })).toBeNull();
  });

  it("posts LiveKit state independently from carrier state", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: "accepted",
      call: { liveKitParticipantState: "joined" },
    }), { status: 200 }));
    const client = new HttpAirGatewayCarrierEventClient({
      apiBaseUrl: "https://api.example.cn",
      apiSecret: secret,
      timeoutMs: 1_000,
    }, fetchFn);
    const event = airGatewayLiveKitEventRequest({
      ...carrier,
      liveKitParticipantState: "joined",
      eventSequence: 2,
    }, "boot-1", new Date("2026-08-04T12:00:00.000Z"));

    await client.publishLiveKit(event);

    expect(event.eventId).toMatch(/^air_lk_evt_[0-9a-f]{48}$/);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.cn/internal/device-calls/livekit-events",
      expect.objectContaining({ body: JSON.stringify(event) }),
    );
    expect(event).not.toHaveProperty("carrierState");
  });

  it("posts a token-free board heartbeat for registration and lease renewal", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: "accepted",
      leaseRenewed: true,
    }), { status: 200 }));
    const client = new HttpAirGatewayCarrierEventClient({
      apiBaseUrl: "https://api.example.cn",
      apiSecret: secret,
      timeoutMs: 1_000,
    }, fetchFn);
    const heartbeat = airGatewayHeartbeatRequest({
      state: "admitted",
      bootId: "boot-1",
      hello: {
        deviceId: "air-780-1",
        bootId: "boot-1",
        firmwareVersion: "production-r2",
        protocolVersion: 1,
        capabilityFlags: 3,
        maxPayloadBytes: 6461,
      },
      heartbeat: {
        deviceId: "air-780-1",
        bootId: "boot-1",
        heartbeatSequence: 2,
        uptimeMs: 2000n,
        deviceState: "in_call",
        activeBinding: carrier,
      },
      bootChanges: 0,
      staleBootFrames: 0,
      staleHeartbeats: 0,
      invalidFrames: 0,
      reconcileCompletions: 1,
      disconnects: 0,
    }, new Date("2026-08-04T12:00:02.000Z"));

    await client.publishHeartbeat(heartbeat);

    expect(heartbeat.eventId).toMatch(/^air_hb_[0-9a-f]{48}$/);
    expect(heartbeat.uptimeMs).toBe("2000");
    expect(heartbeat.activeBinding).toEqual({
      communicationSessionId: carrier.communicationSessionId,
      providerCallId: carrier.providerCallId,
      deviceId: carrier.deviceId,
      leaseId: carrier.leaseId,
      fencingToken: carrier.fencingToken,
      callGeneration: carrier.callGeneration,
    });
    expect(JSON.stringify(heartbeat)).not.toContain("carrierState");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.cn/internal/device-calls/heartbeats",
      expect.objectContaining({ body: JSON.stringify(heartbeat) }),
    );
  });

  it("accepts only an exact server-fenced TTS track admission", async () => {
    const request = trackAdmissionRequest();
    const { roomName: _roomName, fencingToken: _fence, ...admission } = request;
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: "accepted",
      admission,
    }), { status: 200 }));
    const client = new HttpAirGatewayCarrierEventClient({
      apiBaseUrl: "https://api.example.cn",
      apiSecret: secret,
      timeoutMs: 1_000,
    }, fetchFn);

    await expect(client.admitTrack(request)).resolves.toEqual(admission);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.cn/internal/device-calls/track-admissions",
      expect.objectContaining({ body: JSON.stringify(request) }),
    );
  });
});

function trackAdmissionRequest() {
  const targetParticipantIdentity = "comm-1:guest:air:air-780-1";
  return {
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
}

const secret = "event-secret-123456789012345678901";

const carrier = {
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
  carrierState: "connected" as const,
  carrierCause: "none" as const,
  eventSequence: 10,
  deviceTimestampMs: 1_000n,
};
