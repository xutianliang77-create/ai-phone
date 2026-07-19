import { describe, expect, it } from "vitest";
import { createEnterpriseSupportInboundTicketService } from
  "./enterprise-support-inbound-ticket.js";

const route = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  channelId: "22222222-2222-4222-8222-222222222222",
  channelType: "pstn" as const,
  homeRegion: "ap-southeast",
  cellId: "cell-sg-1",
  routeEpoch: 7,
};

describe("enterprise support inbound ticket", () => {
  it("binds the tenant channel and route snapshot", () => {
    const service = createEnterpriseSupportInboundTicketService({
      signingSecret: "support-ingress-signing-secret-32-bytes",
      now: () => Date.parse("2026-07-19T10:00:00.000Z"),
    });
    const issued = service.issue(route);
    expect(issued.status).toBe("ready");
    if (issued.status !== "ready") return;
    expect(service.verify(issued.ticket)).toEqual({
      status: "verified",
      payload: { ...route, issuedAt: "2026-07-19T10:00:00.000Z",
        expiresAt: "2026-07-19T10:05:00.000Z" },
    });
  });

  it("rejects tampering and expired tickets", () => {
    let now = Date.parse("2026-07-19T10:00:00.000Z");
    const service = createEnterpriseSupportInboundTicketService({
      signingSecret: "support-ingress-signing-secret-32-bytes", now: () => now,
    });
    const issued = service.issue(route);
    if (issued.status !== "ready") throw new Error("ticket not ready");
    expect(service.verify(`${issued.ticket}x`).status).toBe("invalid");
    now += 301_000;
    expect(service.verify(issued.ticket).status).toBe("expired");
  });

  it("fails closed without a strong signing secret", () => {
    const service = createEnterpriseSupportInboundTicketService({
      signingSecret: "short",
    });
    expect(service.issue(route)).toEqual({ status: "not_ready" });
    expect(service.verify("payload.signature")).toEqual({ status: "not_ready" });
  });
});
