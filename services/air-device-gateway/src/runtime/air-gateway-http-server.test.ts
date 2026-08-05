import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAirGatewayHttpServer } from "./air-gateway-http-server.js";

describe("Air Gateway HTTP server", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("authenticates and maps an accepted command without leaking credentials", async () => {
    const execute = vi.fn(async () => ({
      status: "ack" as const,
      providerCallId: "air-call-1",
      attempts: 1,
      replayed: false,
      ack: {},
    }));
    const runtime = await start(execute);
    close = runtime.close;

    const response = await fetch(`${runtime.baseUrl}/v1/device-commands`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "dial" }),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ status: "ack", providerCallId: "air-call-1" });
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(execute).toHaveBeenCalledWith({ type: "dial" });
  });

  it("rejects missing authorization before parsing or executing the body", async () => {
    const execute = vi.fn();
    const runtime = await start(execute);
    close = runtime.close;

    const response = await fetch(`${runtime.baseUrl}/v1/device-commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });

    expect(response.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("bounds the request body and requires JSON", async () => {
    const execute = vi.fn();
    const runtime = await start(execute, { maxBodyBytes: 32 });
    close = runtime.close;

    const wrongType = await fetch(`${runtime.baseUrl}/v1/device-commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: "{}",
    });
    const tooLarge = await fetch(`${runtime.baseUrl}/v1/device-commands`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: "x".repeat(64) }),
    });

    expect(wrongType.status).toBe(415);
    expect(tooLarge.status).toBe(413);
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps definitive, overload, and transient outcomes", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ status: "conflict", reason: "command_payload_conflict" })
      .mockResolvedValueOnce({ status: "overloaded", reason: "pending_limit",
        attempts: 0, replayed: false })
      .mockResolvedValueOnce({ status: "unavailable", reason: "room_not_ready" });
    const runtime = await start(execute);
    close = runtime.close;

    const statuses = [];
    for (let index = 0; index < 3; index += 1) {
      statuses.push((await fetch(`${runtime.baseUrl}/v1/device-commands`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ index }),
      })).status);
    }

    expect(statuses).toEqual([409, 429, 503]);
  });
});

async function start(
  execute: ReturnType<typeof vi.fn>,
  options: { maxBodyBytes?: number } = {},
) {
  const server = createAirGatewayHttpServer({
    commandService: { execute },
    apiSecret: secret,
    ...options,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())),
  };
}

const secret = "gateway-secret-12345678901234567890";
