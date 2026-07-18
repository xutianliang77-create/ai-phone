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
    expect(script).toContain("/room-connected");
    expect(script).toContain("await confirmRoomConnection(token)");
    expect(script).toContain("已进入房间，等待发起方加入");
    expect(script).toContain('link.status === "active"');
    expect(script).toContain("shouldAttachAudioTrack");
    expect(script).toContain("setTrackSubscriptionPermissions(false");
    expect(script).toContain("{ autoSubscribe: false }");
    expect(script).toContain('participantRole(participant.identity) === "worker"');
    expect(script).toContain("publication.setSubscribed(shouldAttachAudioTrack");
    expect(script).toContain("syncRemoteAudioSubscriptions(room)");
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
    expect(script).toContain("token.fullDuplexEnabled === true");
    expect(script).toContain("state.fullDuplexEnabled && !state.duplexDegraded");
    expect(script).toContain('event.type === "pipeline.degraded"');
    expect(script).toContain("echoCancellation: true");
    expect(script).toContain("topic !== callRoomCaptionTopic || participant");
    expect(script).toContain("event.callId !== callId");
    expect(script).toContain("event.roomName !== state.expectedRoomName");
    expect(script).toContain('"translation.captions"');
    expect(script).toContain('get("ticket")');
    expect(script).toContain("guestTicket,");
    expect(script).toContain("guest_ticket_already_used");
    expect(script).toContain("clearGuestTicketFromAddress");
    expect(script).toContain("window.history.replaceState");
  });
});
