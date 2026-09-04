import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileAirGatewayEventOutbox } from
  "./file-air-gateway-event-outbox.js";

describe("Air Gateway durable event outbox file", () => {
  let directory = "";
  let path = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "air-gateway-outbox-"));
    path = join(directory, "events.json");
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("persists, reloads and removes exact events with private permissions", async () => {
    const outbox = new FileAirGatewayEventOutbox<typeof event>(path);
    expect(await outbox.load()).toEqual([]);
    await outbox.put(event);

    const restarted = new FileAirGatewayEventOutbox<typeof event>(path);
    expect(await restarted.load()).toEqual([event]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    await restarted.remove(event.eventId);
    expect(await new FileAirGatewayEventOutbox(path).load()).toEqual([]);
  });
});

const event = {
  eventId: "air_evt_123",
  communicationSessionId: "comm-1",
  carrierState: "connected",
};
