import { describe, expect, it } from "vitest";
import { normalizeClientTextLanguage } from "./websocket-server.js";

describe("websocket server text segment language normalization", () => {
  it("normalizes mobile ASR language tags to gateway translation languages", () => {
    expect(normalizeClientTextLanguage("en-US", "zh")).toBe("en");
    expect(normalizeClientTextLanguage("zh-CN", "en")).toBe("zh");
    expect(normalizeClientTextLanguage("cmn-Hans-CN", "en")).toBe("zh");
    expect(normalizeClientTextLanguage("fr-FR", "zh")).toBe("fr");
    expect(normalizeClientTextLanguage("zh-Hant", "en")).toBe("zh-Hant");
  });

  it("falls back to the opposite of the session target for auto segments", () => {
    expect(normalizeClientTextLanguage("auto", "zh")).toBe("en");
    expect(normalizeClientTextLanguage("auto", "en")).toBe("zh");
  });
});
