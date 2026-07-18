import type { CallRoomDataEvent } from "@translation/contracts";
import { participantTrackSpeaker } from "@translation/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../sessions/session-record.js";

const mocks = vi.hoisted(() => ({ mutateSessionRecord: vi.fn() }));

vi.mock("../sessions/sessions-runtime.repository.js", () => ({
  mutateSessionRecord: mocks.mutateSessionRecord,
}));

import {
  applyCallBargeInEvent,
  applyCallPlaybackEvent,
} from "./call-playbacks-runtime.repository.js";

describe("call playback runtime repository", () => {
  let current: SessionRecord;

  beforeEach(() => {
    current = session();
    mocks.mutateSessionRecord.mockReset();
    mocks.mutateSessionRecord.mockImplementation(async (
      _sessionId: string,
      _operation: string,
      _payload: unknown,
      plan: (record: SessionRecord) => {
        next: SessionRecord | null;
        result: unknown | ((saved: SessionRecord) => unknown);
      },
    ) => {
      const mutation = plan(structuredClone(current));
      if (mutation.next) {
        mutation.next.version = (current.version ?? 1) + 1;
        current = mutation.next;
      }
      return typeof mutation.result === "function"
        ? mutation.result(current) : mutation.result;
    });
  });

  it("applies playback state through the fenced session mutation callback", async () => {
    await applyCallPlaybackEvent("call-1", event("playback.queued", 1));
    await applyCallPlaybackEvent("call-1", event("playback.started", 2));
    expect(current.playbacks?.[0]).toMatchObject({
      id: "pb-1", status: "streaming", generation: 1,
      startedAt: new Date(2).toISOString(),
    });
    expect(mocks.mutateSessionRecord).toHaveBeenNthCalledWith(
      1, "call-1", "playback-event", expect.anything(),
      expect.any(Function), expect.any(Function),
    );
  });

  it("persists barge-in evidence on the same session aggregate", async () => {
    await applyCallPlaybackEvent("call-1", event("playback.queued", 1));
    await applyCallBargeInEvent("call-1", event("barge_in.detected", 2, {
      speechDurationMs: 300,
      vadProvider: "marblenet",
      vadProbability: 0.8,
    }));
    expect(current.playbacks?.[0]?.bargeIn).toMatchObject({
      detectedAt: new Date(2).toISOString(),
      speechDurationMs: 300,
      vadProvider: "marblenet",
      vadProbability: 0.8,
    });
  });
});

function session(): SessionRecord {
  return {
    id: "call-1", userId: "user-1", mode: "call_link", status: "active",
    consumedSeconds: 0, createdAt: new Date(0).toISOString(),
    segments: [], callLegs: [], playbacks: [], version: 1,
  };
}

function event(
  type: CallRoomDataEvent["type"],
  timestampMs: number,
  overrides: Partial<CallRoomDataEvent> = {},
): CallRoomDataEvent {
  return {
    type, callId: "call-1", roomName: "call_call-1", segmentId: "segment-1",
    sourceLegId: "host-leg", targetLegId: "guest-leg", playbackId: "pb-1",
    generation: 1, speakerRole: "host", speaker: participantTrackSpeaker("host"),
    sourceLanguage: "zh", targetLanguage: "en", text: "hello", timestampMs,
    ...overrides,
  };
}
