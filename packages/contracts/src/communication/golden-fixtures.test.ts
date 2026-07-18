import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseCommunicationCommand,
  parseCommunicationEvent,
} from "./codec.js";

describe("communication v1 golden fixtures", () => {
  it("decodes the shared command and event fixtures", () => {
    const command = parseCommunicationCommand(fixture("command.json"));
    const event = parseCommunicationEvent(fixture("event.json"));

    expect(command).toMatchObject({
      contractVersion: 1,
      kind: "command",
      sessionId: "session_001",
      expectedVersion: 7,
    });
    expect(event).toMatchObject({
      contractVersion: 1,
      kind: "event",
      sessionId: "session_001",
      playbackId: "playback_001",
      sequence: 42,
    });
  });

  it("allows additive fields but rejects breaking contract versions", () => {
    expect(parseCommunicationEvent({
      ...fixture("event.json"),
      additiveField: "ignored by v1 consumers",
    }).eventId).toBe("evt_playback_started_001");
    expect(() => parseCommunicationEvent({
      ...fixture("event.json"),
      contractVersion: 2,
    })).toThrow("contractVersion");
  });
});

function fixture(name: string) {
  return JSON.parse(readFileSync(
    new URL(`../../fixtures/communication-v1/${name}`, import.meta.url),
    "utf8",
  ));
}
