import { describe, expect, it } from "vitest";
import { TurnCoordinator } from "./turn-coordinator.js";

describe("TurnCoordinator", () => {
  it("requires two consecutive ambiguous tokens before switching a leg language", () => {
    const coordinator = new TurnCoordinator();
    expect(language(coordinator, "我们先检查服务。", "zh")).toBe("zh");
    expect(language(coordinator, "API", "en")).toBe("zh");
    expect(language(coordinator, "RTC", "en")).toBe("en");
  });

  it("keeps the stable language for mixed Chinese and English turns", () => {
    const coordinator = new TurnCoordinator();
    expect(language(coordinator, "我们开始测试。", "zh")).toBe("zh");
    expect(language(coordinator, "请检查 LiveKit room status", "en")).toBe("zh");
  });

  it("trusts the mixed-turn dominant language when ASR metadata conflicts", () => {
    const coordinator = new TurnCoordinator();
    expect(language(coordinator, "the service is ready", "en")).toBe("en");
    expect(language(
      coordinator,
      "我们要测试 Queen Three ASR、Hy-MT2 和 Voice CPM Two 的在线模型链路。",
      "en",
    )).toBe("zh");
    expect(language(coordinator, "the trunk is connected", "en")).toBe("en");
  });

  it("trusts an unambiguous monolingual turn when ASR metadata conflicts", () => {
    const coordinator = new TurnCoordinator();
    expect(language(coordinator, "What's your name?", "en")).toBe("en");
    expect(language(coordinator, "你叫什么名字？", "zh")).toBe("zh");
    expect(language(coordinator, "the service is ready", "zh")).toBe("en");
  });

  it("classifies explicit boundaries but keeps max-duration continuations", () => {
    const coordinator = new TurnCoordinator();
    expect(coordinator.isHardBoundary({
      segmentId: "seg_1",
      text: "unfinished",
      endpointReason: "max_duration",
    })).toBe(false);
    expect(coordinator.isHardBoundary({
      segmentId: "seg_2",
      text: "finished",
      endpointReason: "silence",
    })).toBe(false);
    expect(coordinator.isHardBoundary({
      segmentId: "seg_3",
      text: "boundary",
      endpointReason: "speaker_boundary",
    })).toBe(true);
  });
});

function language(
  coordinator: TurnCoordinator,
  text: string,
  fallbackLanguage: "zh" | "en",
) {
  return coordinator.stabilizeLanguage({
    callId: "call_1",
    speakerRole: "host",
    text,
    fallbackLanguage,
  });
}
