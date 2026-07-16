import { describe, expect, it } from "vitest";

import {
  languagePromptForText,
  nextTurnPrompt,
} from "./nemotron_language_routing.mjs";

describe("Nemotron turn language routing", () => {
  it("keeps mixed language turns on auto", () => {
    expect(languagePromptForText("访问 M 并保留 AR")).toBe("auto");
    expect(nextTurnPrompt("FireRedASR2 在线模型")).toBe("auto");
  });

  it("routes pure turns by script", () => {
    expect(languagePromptForText("今天下午三点开会")).toBe("zh-CN");
    expect(languagePromptForText("What is your name")).toBe("en-US");
  });

  it("alternates prompts for conversation mode", () => {
    expect(nextTurnPrompt("你好", "alternate")).toBe("en-US");
    expect(nextTurnPrompt("Hello", "alternate")).toBe("zh-CN");
  });

  it("keeps prompts sticky for listening mode", () => {
    expect(nextTurnPrompt("你好", "sticky")).toBe("zh-CN");
    expect(nextTurnPrompt("Hello", "sticky")).toBe("en-US");
  });
});
