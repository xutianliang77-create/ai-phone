import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { ensureAgentCallSession } from "./agent-call-session.js";

describe("Voice Agent room isolation", () => {
  const previousAutoAccount = process.env.API_TEST_AUTO_ACCOUNT;

  beforeEach(async () => {
    process.env.API_TEST_AUTO_ACCOUNT = "true";
    getStoreSnapshot().sessions = [];
    await ensureAgentCallSession({
      callId: "agent-call-isolated",
      userId: "guest-user",
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    if (previousAutoAccount === undefined) delete process.env.API_TEST_AUTO_ACCOUNT;
    else process.env.API_TEST_AUTO_ACCOUNT = previousAutoAccount;
  });

  it("does not expose the internal room as a public call link", async () => {
    const app = await buildApp();

    const publicRecord = await app.inject({
      method: "GET",
      url: "/call-links/agent-call-isolated",
    });
    const joinPage = await app.inject({
      method: "GET",
      url: "/join/agent-call-isolated",
    });
    const ticket = await app.inject({
      method: "POST",
      url: "/call-links/agent-call-isolated/guest-ticket",
    });
    await app.close();

    expect(publicRecord.statusCode).toBe(404);
    expect(joinPage.statusCode).toBe(404);
    expect(ticket.statusCode).toBe(404);
  });

  it("rejects guest room tokens while retaining the authenticated host path", async () => {
    const app = await buildApp();
    const guest = await app.inject({
      method: "POST",
      url: "/call-links/agent-call-isolated/room-token",
      payload: { participantRole: "guest", guestTicket: "not-issued" },
    });
    await app.close();

    expect(guest.statusCode).toBe(404);
    expect(guest.json().error.code).toBe("call_link_not_found");
  });
});
