import { describe, expect, it } from "vitest";
import { RecentTtsEchoFilter } from "./recent-tts-echo-filter.js";

describe("RecentTtsEchoFilter", () => {
  it("matches exact and partial TTS recapture only for the target participant", () => {
    const filter = new RecentTtsEchoFilter();
    filter.remember("call_1", "guest", "Can you see my screen?", 20_000);

    expect(filter.matches("call_1", "guest", "Can you see my screen.", 10_000))
      .toBe(true);
    expect(filter.matches("call_1", "guest", "See my screen?", 10_000))
      .toBe(true);
    expect(filter.matches("call_1", "host", "Can you see my screen?", 10_000))
      .toBe(false);
  });

  it("expires entries and keeps short acknowledgements", () => {
    const filter = new RecentTtsEchoFilter();
    filter.remember("call_1", "guest", "Hello", 20_000);

    expect(filter.matches("call_1", "guest", "Hello", 10_000)).toBe(false);
    expect(filter.matches("call_1", "guest", "Can you see my screen?", 20_001))
      .toBe(false);
  });
});
