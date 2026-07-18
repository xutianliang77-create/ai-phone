import { describe, expect, it } from "vitest";
import {
  issueEnterpriseWorkerDispatchTicket,
  verifyEnterpriseWorkerDispatchTicket,
  type EnterpriseWorkerDispatchTicketPayload,
} from "./enterprise-worker-dispatch-ticket.js";

const secret = "enterprise-worker-dispatch-secret-32-bytes";
const issuedAt = "2026-07-18T04:00:00.000Z";

describe("enterprise worker dispatch ticket", () => {
  it("signs every tenant, session, cell, route, generation and capability field", () => {
    const ticket = issueEnterpriseWorkerDispatchTicket({
      payload: payload(),
      signingSecret: secret,
    });

    expect(verifyEnterpriseWorkerDispatchTicket({
      ticket,
      signingSecret: secret,
      now: new Date("2026-07-18T04:01:00.000Z"),
    })).toEqual(payload());

    for (const field of [
      "tenantId", "communicationSessionId", "cellId", "routeEpoch",
      "generation", "capability", "expiresAt",
    ] as const) {
      const [encoded, signature] = ticket.split(".");
      const changed = JSON.parse(
        Buffer.from(encoded!, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      changed[field] = field === "routeEpoch" || field === "generation"
        ? 99
        : `${String(changed[field])}-forged`;
      const forged = `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`;
      expect(verifyEnterpriseWorkerDispatchTicket({
        ticket: forged,
        signingSecret: secret,
      })).toBeNull();
    }
  });

  it("rejects expired, oversized TTL and weak-secret tickets", () => {
    const ticket = issueEnterpriseWorkerDispatchTicket({
      payload: payload(),
      signingSecret: secret,
    });
    expect(verifyEnterpriseWorkerDispatchTicket({
      ticket,
      signingSecret: secret,
      now: new Date("2026-07-18T04:05:00.000Z"),
    })).toBeNull();
    expect(() => issueEnterpriseWorkerDispatchTicket({
      payload: { ...payload(), expiresAt: "2026-07-18T04:05:01.000Z" },
      signingSecret: secret,
    })).toThrow("Invalid enterprise worker dispatch ticket payload");
    expect(() => issueEnterpriseWorkerDispatchTicket({
      payload: payload(),
      signingSecret: "weak",
    })).toThrow("at least 32 bytes");
  });
});

function payload(): EnterpriseWorkerDispatchTicketPayload {
  return {
    v: 1,
    ticketId: "00000000-0000-4000-8000-000000000011",
    tenantId: "00000000-0000-4000-8000-000000000001",
    communicationSessionId: "enterprise-session-1",
    cellId: "cn-cell-01",
    routeEpoch: 7,
    generation: 3,
    capability: "translation_runtime",
    issuedAt,
    expiresAt: "2026-07-18T04:05:00.000Z",
  };
}
