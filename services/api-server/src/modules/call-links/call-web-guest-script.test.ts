import { describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { renderCallGuestScript } from "./call-web-guest-script.js";

describe("call web guest script", () => {
  it("serves the Web Guest browser script", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/call-web/guest.js",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/javascript",
    );
    expect(response.body).toContain("captions-only");
    expect(response.body).toContain("MicroMessenger");
    expect(response.body).toContain("capability-status");
    expect(response.body).toContain("navigator.clipboard");
  });

  it("keeps consent, captions-only, reporting, and TTS track logic together", () => {
    const script = renderCallGuestScript();

    expect(script).toContain("请先确认通话转写和翻译授权");
    expect(script).toContain("仅接收字幕和翻译语音");
    expect(script).toContain("translation-tts-(host|guest)");
    expect(script).toContain("tts.ready");
    expect(script).toContain("support@example.cn");
    expect(script).toContain("/call-links/");
    expect(script).toContain("shouldAttachAudioTrack");
    expect(script).toContain("if (!targetRole) return false;");
    expect(script).toContain("distanceFromTimelineBottom");
    expect(script).toContain('document.querySelector(".bottom")?.offsetHeight');
    expect(script).toContain('behavior: "auto"');
    expect(script).toContain("AudioContext");
    expect(script).toContain("系统浏览器");
    expect(script).toContain("copyCallLink");
    expect(script).toContain("blockMicrophoneForTts(event)");
    expect(script).toContain("event.speakerRole === state.localRole");
    expect(script).toContain("setMicrophoneEnabled(false)");
    expect(script).toContain("setMicrophoneEnabled(true)");
  });
});
