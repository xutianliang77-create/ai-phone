import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../sessions/session-record.js";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  mutateSessionRecord: vi.fn(),
}));

vi.mock("../sessions/sessions-runtime.repository.js", () => ({
  findSession: mocks.findSession,
  mutateSessionRecord: mocks.mutateSessionRecord,
}));

import {
  beginCallLinkUplinkControl,
  configureCallLinkTranslationState,
  prepareCallLinkUplinkResume,
  recordCallLinkDiagnosticMarker,
  settleCallLinkUplinkControl,
} from "./call-link-translation-state.repository.js";

describe("call link translation state", () => {
  let current: SessionRecord;

  beforeEach(() => {
    current = session();
    mocks.findSession.mockReset();
    mocks.findSession.mockImplementation(async () => structuredClone(current));
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
      if (mutation.next) current = mutation.next;
      return typeof mutation.result === "function"
        ? mutation.result(current) : mutation.result;
    });
  });

  it("fails closed during pause and resumes only after a successful ACK", async () => {
    await configure();
    const pause = await beginCallLinkUplinkControl({
      sessionId: "session-1",
      operationId: "pause-1",
      idempotencyKey: "pause-key-1",
      paused: true,
      dispatchGeneration: 7,
    });
    expect(pause).toMatchObject({
      status: "updated",
      state: { uplinkPaused: true, controlGeneration: 2 },
    });
    await expect(beginCallLinkUplinkControl({
      sessionId: "session-1",
      operationId: "pause-1",
      idempotencyKey: "changed-key-1",
      paused: true,
      dispatchGeneration: 7,
      controlGeneration: 2,
    })).resolves.toMatchObject({ status: "pending_conflict" });
    await settleCallLinkUplinkControl({
      sessionId: "session-1",
      operationId: "pause-1",
      controlGeneration: 2,
      dispatchGeneration: 7,
      succeeded: true,
    });
    const resume = await beginCallLinkUplinkControl({
      sessionId: "session-1",
      operationId: "resume-1",
      idempotencyKey: "resume-key-1",
      paused: false,
      dispatchGeneration: 7,
    });
    expect(resume).toMatchObject({
      state: { uplinkPaused: true, controlGeneration: 3 },
    });
    await expect(prepareCallLinkUplinkResume({
      sessionId: "session-1",
      operationId: "resume-1",
      controlGeneration: 3,
      dispatchGeneration: 8,
    })).resolves.toMatchObject({ status: "binding_conflict" });
    await expect(prepareCallLinkUplinkResume({
      sessionId: "session-1",
      operationId: "resume-1",
      controlGeneration: 3,
      dispatchGeneration: 7,
    })).resolves.toMatchObject({
      status: "updated",
      state: { uplinkPaused: true,
        pending: { resumePreparedAt: expect.any(String) } },
    });
    await settleCallLinkUplinkControl({
      sessionId: "session-1",
      operationId: "resume-1",
      controlGeneration: 3,
      dispatchGeneration: 7,
      succeeded: true,
    });
    expect(current.callLink?.translationControl).toMatchObject({
      uplinkPaused: false,
      lastSettledOperationId: "resume-1",
      lastSettledSucceeded: true,
    });
  });

  it("rejects a contradictory status replay for one control operation", async () => {
    await configure();
    await beginCallLinkUplinkControl({
      sessionId: "session-1",
      operationId: "pause-1",
      idempotencyKey: "pause-key-1",
      paused: true,
      dispatchGeneration: 7,
    });
    await expect(settleCallLinkUplinkControl({
      sessionId: "session-1",
      operationId: "pause-1",
      controlGeneration: 2,
      dispatchGeneration: 8,
      succeeded: true,
    })).resolves.toMatchObject({ status: "binding_conflict" });
    await settleCallLinkUplinkControl({
      sessionId: "session-1",
      operationId: "pause-1",
      controlGeneration: 2,
      dispatchGeneration: 7,
      succeeded: true,
    });

    await expect(settleCallLinkUplinkControl({
      sessionId: "session-1",
      operationId: "pause-1",
      controlGeneration: 2,
      dispatchGeneration: 7,
      succeeded: false,
    })).resolves.toMatchObject({ status: "binding_conflict" });
  });

  it("deduplicates redacted diagnostic markers and rejects changed payloads", async () => {
    const marker = {
      id: "diag-1",
      category: "unexpected_audio" as const,
      createdAt: "2026-08-13T08:00:00.000Z",
      controlGeneration: 2,
    };
    await expect(recordCallLinkDiagnosticMarker({
      sessionId: "session-1",
      marker,
    })).resolves.toMatchObject({ status: "recorded" });
    await expect(recordCallLinkDiagnosticMarker({
      sessionId: "session-1",
      marker,
    })).resolves.toMatchObject({ status: "replayed" });
    await expect(recordCallLinkDiagnosticMarker({
      sessionId: "session-1",
      marker: { ...marker, category: "translation_incorrect" },
    })).resolves.toMatchObject({ status: "payload_conflict" });
  });

  function configure() {
    return configureCallLinkTranslationState({
      sessionId: "session-1",
      sourceLanguage: "zh",
      targetLanguage: "en",
    });
  }
});

function session(): SessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    mode: "call_link",
    status: "active",
    consumedSeconds: 0,
    createdAt: "2026-08-13T08:00:00.000Z",
    segments: [],
    version: 1,
    callLink: {
      roomName: "call-call-1",
      roomProvider: "livekit",
      joinUrl: "https://example.test/join/call-1",
      hostUrl: "https://example.test/host/call-1",
      expiresAt: "2026-08-13T09:00:00.000Z",
      purpose: "human_call",
    },
  };
}
