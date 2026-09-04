import { describe, expect, it, vi } from "vitest";
import {
  pauseVoiceAgentMedia,
  resumeVoiceAgentMedia,
} from "./voice-agent-media-control.js";

describe("Voice Agent media pause", () => {
  it("interrupts and clears playback before disabling both Agent directions", async () => {
    const events: string[] = [];
    const session = fakeSession(events);

    await pauseVoiceAgentMedia(session);

    expect(events).toEqual([
      "authorization:pause",
      "interrupt",
      "interrupt:done",
      "playback:clear",
      "output:false",
      "input:false",
    ]);
  });

  it("resumes listening silently after pause and only speaks after rejected takeover", () => {
    const events: string[] = [];
    const session = fakeSession(events);

    resumeVoiceAgentMedia(session, { returningFromTakeover: false });
    expect(events).toEqual(["input:true", "output:true", "authorization:resume"]);

    events.length = 0;
    resumeVoiceAgentMedia(session, { returningFromTakeover: true });
    expect(events).toEqual([
      "input:true",
      "output:true",
      "authorization:resume",
      "reply",
    ]);
  });
});

function fakeSession(events: string[]) {
  return {
    pauseReplyAuthorization: vi.fn(() => events.push("authorization:pause")),
    resumeReplyAuthorization: vi.fn(() => events.push("authorization:resume")),
    interrupt: vi.fn(() => {
      events.push("interrupt");
      return { await: Promise.resolve().then(() => events.push("interrupt:done")) };
    }),
    generateReply: vi.fn(() => events.push("reply")),
    input: {
      setAudioEnabled: vi.fn((enabled: boolean) => events.push(`input:${enabled}`)),
    },
    output: {
      setAudioEnabled: vi.fn((enabled: boolean) => events.push(`output:${enabled}`)),
      audio: { clearBuffer: vi.fn(() => events.push("playback:clear")) },
    },
  };
}
