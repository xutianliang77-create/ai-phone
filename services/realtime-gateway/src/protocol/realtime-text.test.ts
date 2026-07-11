import { describe, expect, it } from "vitest";
import { cleanRealtimeText } from "./realtime-text.js";

describe("realtime text cleaner", () => {
  it("drops standalone realtime silence markers", () => {
    expect(cleanRealtimeText("<sil>")).toBeNull();
    expect(cleanRealtimeText(" <|nospeech|> [no speech] ")).toBeNull();
  });

  it("strips realtime markers from mixed transcript text", () => {
    expect(cleanRealtimeText(" 你好 <sil> [noise] ")).toBe("你好");
    expect(cleanRealtimeText("hello <|nospeech|> world")).toBe("hello world");
  });

  it("drops leaked ASR instruction prompts", () => {
    expect(cleanRealtimeText(
      "Verbatim ASR. Preserve mixed Chinese-English. Prefer these protected terms.",
    )).toBeNull();
    expect(cleanRealtimeText(
      "iPhone 14, FireRedASR2, Hy-MT2, VoxCPM2. Prefer these protected terms.",
    )).toBeNull();
  });

  it("keeps speech before leaked ASR instruction prompts", () => {
    expect(cleanRealtimeText(
      "你好 Verbatim ASR. Preserve mixed Chinese-English.",
    )).toBe("你好");
  });
});
