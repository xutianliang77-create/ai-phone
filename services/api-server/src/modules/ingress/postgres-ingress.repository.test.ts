import type { ExternalMediaSourceDto } from "@translation/contracts";
import { describe, expect, it, vi } from "vitest";
import { PostgresIngressRepository } from "./postgres-ingress.repository.js";

const source: ExternalMediaSourceDto = {
  id: "source_1",
  sessionId: "session_1",
  roomName: "room_1",
  provider: "livekit_ingress",
  inputType: "rtmp",
  participantIdentity: "external:participant_1",
  status: "ready",
  sourcePolicyVersion: "policy_1",
  idempotencyKey: "ingress-create-1",
  requestHash: "request-hash-at-least-sixteen-bytes",
  externalIngressId: "ingress_1",
  version: 2,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:01:00.000Z",
};

describe("PostgresIngressRepository queries", () => {
  it("finds an ingress source by external provider id", async () => {
    const fixture = repository([{ id: source.id, payload: source }]);

    await expect(fixture.repository.findByIngressId("ingress_1"))
      .resolves.toEqual(source);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("source.external_ingress_id = $1"),
      ["ingress_1"],
    );
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("finds an ingress source by session idempotency key", async () => {
    const fixture = repository([{ id: source.id, payload: source }]);

    await expect(fixture.repository.findByIdempotency(
      "session_1",
      "ingress-create-1",
    )).resolves.toEqual(source);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("source.idempotency_key = $2"),
      ["session_1", "ingress-create-1"],
    );
  });

  it("lists all ingress sources for a session in creation order", async () => {
    const fixture = repository([{ id: source.id, payload: source }]);

    await expect(fixture.repository.listSession("session_1"))
      .resolves.toEqual([source]);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY source.created_at, source.id"),
      ["session_1"],
    );
  });

  it("bounds the recoverable query and releases the connection", async () => {
    const fixture = repository([]);

    await expect(fixture.repository.listRecoverable(25)).resolves.toEqual([]);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("source.external_ingress_id IS NOT NULL"),
      [expect.any(Array), 25],
    );
    expect(fixture.release).toHaveBeenCalledOnce();
  });
});

function repository(rows: Array<{ id: string; payload: unknown }>) {
  const query = vi.fn().mockResolvedValue({ rows });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return {
    repository: new PostgresIngressRepository({ connect } as never),
    query,
    release,
  };
}
