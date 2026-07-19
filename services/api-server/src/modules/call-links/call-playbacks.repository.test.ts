import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createSession } from "../sessions/sessions.repository.js";
import {
  applyCallPlaybackEvent,
  applyCallBargeInEvent,
  CallPlaybackConflictError,
  interruptActiveCallPlaybacks,
} from "./call-playbacks.repository.js";
import { participantTrackSpeaker, type CallRoomDataEvent } from "@translation/contracts";

describe("call playback repository", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    createSession({
      id: "call-1",
      userId: "user-1",
      mode: "call_link",
      status: "active",
      consumedSeconds: 0,
      createdAt: new Date(0).toISOString(),
      segments: [],
      callLegs: [],
      playbacks: [],
    });
  });

  it("applies a legal playback lifecycle and keeps its terminal state", () => {
    applyCallPlaybackEvent("call-1", event("playback.queued", 1));
    applyCallPlaybackEvent("call-1", event("playback.started", 2));
    applyCallPlaybackEvent("call-1", event("playback.ended", 3));
    const playback = getStoreSnapshot().sessions[0]?.playbacks?.[0];

    expect(playback).toMatchObject({
      id: "pb-1",
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
      generation: 1,
      status: "completed",
      queuedAt: new Date(1).toISOString(),
      startedAt: new Date(2).toISOString(),
      endedAt: new Date(3).toISOString(),
    });
    expect(() => applyCallPlaybackEvent(
      "call-1",
      event("playback.failed", 4),
    )).toThrow(CallPlaybackConflictError);
    expect(playback?.status).toBe("completed");
  });

  it("isolates active playback and generation by target leg", () => {
    applyCallPlaybackEvent("call-1", event("playback.queued", 1));
    expect(() => applyCallPlaybackEvent(
      "call-1",
      event("playback.queued", 2, { playbackId: "pb-2", generation: 2 }),
    )).toThrow(CallPlaybackConflictError);
    applyCallPlaybackEvent("call-1", event("playback.started", 3));
    applyCallPlaybackEvent("call-1", event("playback.ended", 4));
    expect(() => applyCallPlaybackEvent(
      "call-1",
      event("playback.queued", 5, { playbackId: "pb-3", generation: 1 }),
    )).toThrow(CallPlaybackConflictError);
  });

  it("interrupts only non-terminal playbacks when a session ends", () => {
    applyCallPlaybackEvent("call-1", event("playback.queued", 1));
    interruptActiveCallPlaybacks("call-1", "session_end", new Date(5).toISOString());
    interruptActiveCallPlaybacks("call-1", "recovery", new Date(6).toISOString());

    expect(getStoreSnapshot().sessions[0]?.playbacks?.[0]).toMatchObject({
      status: "interrupted",
      interruptReason: "session_end",
      endedAt: new Date(5).toISOString(),
    });
  });

  it("binds barge-in evidence to the exact playback generation", () => {
    applyCallPlaybackEvent("call-1", event("playback.queued", 1));
    applyCallPlaybackEvent("call-1", event("playback.started", 2));
    applyCallPlaybackEvent("call-1", event("playback.interrupted", 3, {
      playbackReason: "barge_in",
    }));
    applyCallBargeInEvent("call-1", event("barge_in.detected", 4, {
      speechDurationMs: 300,
      vadProvider: "marblenet",
      vadProbability: 0.8,
      preRollMs: 400,
    }));
    applyCallBargeInEvent("call-1", event("barge_in.confirmed", 5, {
      stopLatencyMs: 120,
    }));

    expect(getStoreSnapshot().sessions[0]?.playbacks?.[0]).toMatchObject({
      interruptReason: "barge_in",
      bargeIn: {
        detectedAt: new Date(4).toISOString(),
        confirmedAt: new Date(5).toISOString(),
        stopLatencyMs: 120,
        speechDurationMs: 300,
        vadProvider: "marblenet",
        vadProbability: 0.8,
        preRollMs: 400,
      },
    });
  });
});

function event(
  type: CallRoomDataEvent["type"],
  timestampMs: number,
  overrides: Partial<CallRoomDataEvent> = {},
): CallRoomDataEvent {
  return {
    type,
    callId: "call-1",
    roomName: "call_call-1",
    segmentId: "segment-1",
    sourceLegId: "host-leg",
    targetLegId: "guest-leg",
    playbackId: "pb-1",
    generation: 1,
    speakerRole: "host",
    speaker: participantTrackSpeaker("host"),
    sourceLanguage: "zh",
    targetLanguage: "en",
    text: "hello",
    timestampMs,
    ...overrides,
  };
}
