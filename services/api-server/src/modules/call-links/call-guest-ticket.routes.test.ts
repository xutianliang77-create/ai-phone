import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  setCallRoomDataPublisherForTests,
  type CallRoomDataPublisher,
} from "./call-room-worker.js";

describe("call guest one-time ticket", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureCallRoomEnv();
    resetStore();
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async publish() {},
    } satisfies CallRoomDataPublisher);
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    restoreEnv(previousEnv);
  });

  it("stores only ticket digests and rejects a replay", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const ticket = guestTicketFrom(created);
    const stored = getStoreSnapshot().sessions[0]?.callLink?.guestTicket;

    expect(ticket).toMatch(/^g1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(stored).toMatchObject({ callId, sessionId: callId, role: "guest" });
    expect(JSON.stringify(stored)).not.toContain(ticket);

    const accepted = await redeem(app, callId, ticket);
    const replayed = await redeem(app, callId, ticket);
    await app.close();

    expect(accepted.statusCode).toBe(200);
    expect(replayed.statusCode).toBe(409);
    expect(replayed.json().error.code).toBe("guest_ticket_already_used");
  });

  it("atomically accepts only one concurrent redemption", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const ticket = guestTicketFrom(created);

    const responses = await Promise.all([
      redeem(app, callId, ticket),
      redeem(app, callId, ticket),
      redeem(app, callId, ticket),
    ]);
    await app.close();

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200,
      409,
      409,
    ]);
  });

  it("rejects missing, expired, and cross-call tickets", async () => {
    const app = await buildApp();
    const first = await app.inject({ method: "POST", url: "/call-links" });
    const second = await app.inject({ method: "POST", url: "/call-links" });
    const firstCallId = first.json().callId as string;
    const secondCallId = second.json().callId as string;
    const missing = await redeem(app, firstCallId, "");
    const crossCall = await redeem(app, secondCallId, guestTicketFrom(first));
    const ticketState = getStoreSnapshot().sessions.find(
      (session) => session.id === firstCallId,
    )?.callLink?.guestTicket;
    if (!ticketState) throw new Error("missing guest ticket fixture");
    ticketState.expiresAt = new Date(Date.now() - 1000).toISOString();
    const expired = await redeem(app, firstCallId, guestTicketFrom(first));
    await app.close();

    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe("invalid_guest_ticket");
    expect(crossCall.statusCode).toBe(403);
    expect(crossCall.json().error.code).toBe("invalid_guest_ticket");
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe("guest_ticket_expired");
  });

  it("lets the owner rotate a ticket and invalidates the previous secret", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const oldTicket = guestTicketFrom(created);
    const rotated = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/guest-ticket`,
    });
    const newTicket = guestTicketFrom(rotated);
    const oldResponse = await redeem(app, callId, oldTicket);
    const newResponse = await redeem(app, callId, newTicket);
    await app.close();

    expect(rotated.statusCode).toBe(200);
    expect(newTicket).not.toBe(oldTicket);
    expect(oldResponse.statusCode).toBe(403);
    expect(newResponse.statusCode).toBe(200);
  });

  it("rejects an oversized participant name without consuming the ticket", async () => {
    process.env.CALL_ROOM_MAX_PARTICIPANT_NAME_CHARACTERS = "4";
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const ticket = guestTicketFrom(created);
    const oversized = await redeem(app, callId, ticket, "12345");
    const accepted = await redeem(app, callId, ticket, "1234");
    await app.close();

    expect(oversized.statusCode).toBe(400);
    expect(oversized.json().error.code).toBe(
      "invalid_call_room_participant_name",
    );
    expect(accepted.statusCode).toBe(200);
  });

  it("caps the call link and ticket at the configured session duration", async () => {
    process.env.CALL_ROOM_MAX_SESSION_SECONDS = "60";
    const before = Date.now();
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    await app.close();

    const linkExpiresAt = Date.parse(created.json().expiresAt);
    const ticketExpiresAt = Date.parse(created.json().guestTicketExpiresAt);
    expect(linkExpiresAt - before).toBeGreaterThanOrEqual(59_000);
    expect(linkExpiresAt - before).toBeLessThanOrEqual(61_000);
    expect(ticketExpiresAt).toBeLessThanOrEqual(linkExpiresAt);
  });
});

function redeem(
  app: Awaited<ReturnType<typeof buildApp>>,
  callId: string,
  guestTicket: string,
  participantName = "Guest",
) {
  return app.inject({
    method: "POST",
    url: `/call-links/${callId}/room-token`,
    payload: { participantRole: "guest", participantName, guestTicket },
  });
}

function guestTicketFrom(response: { json(): Record<string, unknown> }) {
  return new URL(String(response.json().joinUrl ?? ""))
    .searchParams.get("ticket") ?? "";
}

const envKeys = [
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_ROOM_TOKEN_TTL_SECONDS",
  "INTERNAL_API_SECRET",
  "CALL_ROOM_MAX_PARTICIPANT_NAME_CHARACTERS",
  "CALL_ROOM_MAX_SESSION_SECONDS",
];

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function configureCallRoomEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "120";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
  delete process.env.CALL_ROOM_MAX_PARTICIPANT_NAME_CHARACTERS;
  delete process.env.CALL_ROOM_MAX_SESSION_SECONDS;
}

function resetStore() {
  const store = getStoreSnapshot();
  store.sessions = [];
  store.usageBalances = {};
  store.usageHolds = [];
  store.billingLedger = [];
}
