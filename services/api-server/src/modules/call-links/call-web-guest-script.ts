import { renderCallWebTtsCaptureFunctions } from "./call-web-tts-capture-script.js";
import { renderCallWebRoomConfirmationFunctions } from "./call-web-room-confirmation-script.js";
import { renderCallWebPageActionFunctions } from "./call-web-page-actions-script.js";
import { renderCallWebActivationFunctions } from "./call-web-activation-script.js";
import { renderCallWebEnvironmentFunctions } from "./call-web-environment-script.js";

export function renderCallGuestScript() {
  return String.raw`(() => {
  const config = window.__CALL_LINK__ || {};
  const callId = config.callId || "";
  const state = {
    room: null,
    localRole: "guest",
    localParticipantIdentity: "",
    captions: new Map(),
    followLatest: true,
    captionsOnly: false,
    audioUnlocked: false,
    fullDuplexEnabled: false,
    duplexDegraded: false,
    captureBlockedUntil: 0,
    captureTimer: null,
    activationTimer: null,
    gatedTtsSegments: new Set(),
  };
  const $ = (id) => document.getElementById(id);
  $("call-id").textContent = callId;

  function status(message, kind = "") {
    const el = $("status");
    el.textContent = message;
    el.className = kind ? "status " + kind : "status";
  }

  function updateJoinButton() {
    $("join").disabled = Boolean(state.room) || !$("consent").checked;
  }

${renderCallWebActivationFunctions()}
${renderCallWebEnvironmentFunctions()}

  function speakerLabel(role) {
    if (role === state.localRole) return "我";
    if (role === "worker") return "系统";
    return "对方";
  }

  function updateCaption(event) {
    if (event.type === "worker.status") {
      status(workerStatusMessage(event), event.retryable ? "warn" : "ready");
      return;
    }
    const segmentId = event.segmentId || "segment-" + Date.now();
    const caption = state.captions.get(segmentId) || {
      segmentId,
      speakerRole: event.speakerRole || "guest",
    };
    caption.speakerRole = event.speakerRole || caption.speakerRole;
    if (event.type === "transcript.final") {
      const sourceText = cleanCaptionText(event.sourceText || event.text);
      if (!sourceText) return;
      caption.sourceText = sourceText;
    }
    if (event.type === "translation.final") {
      caption.sourceText = cleanCaptionText(event.sourceText) || caption.sourceText || "";
      caption.translatedText = cleanCaptionText(event.translatedText || event.translation || event.text) || "";
      if (!caption.sourceText && !caption.translatedText) return;
    }
    if (event.type === "tts.ready") {
      caption.sourceText = cleanCaptionText(event.sourceText) || caption.sourceText || "";
      caption.translatedText = cleanCaptionText(event.translatedText || event.translation || event.text) || caption.translatedText || "";
      if (!caption.sourceText && !caption.translatedText) return;
      caption.ttsReady = true;
      caption.ttsProvider = event.provider || caption.ttsProvider || "";
      caption.ttsModel = event.model || caption.ttsModel || "";
      blockMicrophoneForTts(event);
    }
    state.captions.set(segmentId, caption);
    renderCaption(caption);
  }

  function handlePipelineEvent(event) {
    if (event.type === "pipeline.degraded") {
      state.duplexDegraded = true;
      status("全双工抢话已降级为半双工", "warn");
      return true;
    }
    if (event.type === "pipeline.restored") {
      state.duplexDegraded = false;
      status("全双工抢话已恢复", "ready");
      return true;
    }
    return false;
  }

  function renderCaption(caption) {
    const timeline = $("timeline");
    const shouldFollow = state.followLatest || distanceFromTimelineBottom() <= 120;
    if (timeline.firstElementChild?.className === "subtle") timeline.textContent = "";
    let item = Array.from(timeline.children).find((child) => child.dataset.segmentId === caption.segmentId);
    if (!item) {
      item = document.createElement("div");
      item.className = "segment";
      item.dataset.segmentId = caption.segmentId;
      item.innerHTML = '<div class="speaker"></div><div class="source"></div><div class="translation"></div><div class="tts"></div>';
      timeline.appendChild(item);
    }
    item.querySelector(".speaker").textContent = speakerLabel(caption.speakerRole);
    item.querySelector(".source").textContent = caption.sourceText || "";
    item.querySelector(".translation").textContent = caption.translatedText || "";
    item.querySelector(".tts").textContent = caption.ttsReady
      ? "翻译语音已准备" + (caption.ttsProvider ? "：" + caption.ttsProvider : "")
      : "";
    if (shouldFollow) scrollToLatest();
    else updateLatestButton();
  }

  function distanceFromTimelineBottom() {
    const timelineBottom = $("timeline").getBoundingClientRect().bottom;
    const controlsHeight = document.querySelector(".bottom")?.offsetHeight || 0;
    return timelineBottom - (window.innerHeight - controlsHeight - 12);
  }

  function updateLatestButton() {
    $("back-to-latest").classList.toggle("visible", !state.followLatest);
  }

  function updateFollowLatestFromScroll() {
    state.followLatest = distanceFromTimelineBottom() <= 120;
    updateLatestButton();
  }

  function scrollToLatest() {
    state.followLatest = true;
    updateLatestButton();
    const controlsHeight = document.querySelector(".bottom")?.offsetHeight || 0;
    const timelineBottom = $("timeline").getBoundingClientRect().bottom;
    const target = window.scrollY + timelineBottom - window.innerHeight + controlsHeight + 12;
    window.scrollTo({ top: Math.max(0, target), behavior: "auto" });
  }

  function workerStatusMessage(event) {
    const stageLabels = { worker: "通话 Worker", asr: "ASR", translation: "翻译", tts: "TTS" };
    const text = cleanCaptionText(event.text) || "状态更新";
    const body = event.stage && stageLabels[event.stage]
      ? stageLabels[event.stage] + "：" + text
      : text;
    const meta = [event.provider, event.model, event.retryable ? "可重试" : ""]
      .filter(Boolean)
      .join("，");
    return meta ? body + "（" + meta + "）" : body;
  }

  function cleanCaptionText(value) {
    if (typeof value !== "string") return "";
    const collapsed = value.replace(/\s+/g, " ").trim();
    const compact = collapsed
      .toLowerCase()
      .replace(/(?:<|\[|\()(?:sil|noise|blank|unk)(?:>|\]|\))/g, "")
      .replace(/[\s,，.。!！?？;；:：、\-_\/]+/g, "");
    return compact ? collapsed : "";
  }

  function ttsTrackTargetRole(trackName) {
    const match = /^translation-tts-(host|guest)-([1-9][0-9]*)(?:\.([A-Za-z0-9_-]+))?$/.exec(trackName || "");
    return match ? match[1] : null;
  }

  function ttsTrackTargetLegToken(trackName) {
    const match = /^translation-tts-(host|guest)-([1-9][0-9]*)(?:\.([A-Za-z0-9_-]+))?$/.exec(trackName || "");
    return match ? match[3] || "" : null;
  }
  function legToken(identity) { return btoa(identity).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function audioTrackName(track, publication) {
    return publication?.name || publication?.trackName || track?.name || "";
  }
  function shouldAttachAudioTrack(track, publication) {
    const trackName = audioTrackName(track, publication);
    const targetRole = ttsTrackTargetRole(trackName);
    if (!targetRole) return false;
    if (targetRole !== state.localRole) return false;
    const targetLeg = ttsTrackTargetLegToken(trackName);
    return !targetLeg || targetLeg === legToken(state.localParticipantIdentity);
  }
${renderCallWebTtsCaptureFunctions()}
${renderCallWebRoomConfirmationFunctions()}
${renderCallWebPageActionFunctions()}

  function bindRoom(room) {
    const lk = window.LivekitClient;
    room.on(lk.RoomEvent.Disconnected, () => {
      stopActivationPolling();
      resetTtsCaptureGate();
      state.room = null;
      status("通话已断开", "error");
      $("leave").disabled = true;
      $("remote-audio").textContent = "";
      updateJoinButton();
    });
    room.on(lk.RoomEvent.TrackSubscribed, (track, publication) => {
      if (track.kind !== "audio") return;
      if (!shouldAttachAudioTrack(track, publication)) return;
      const element = track.attach();
      element.autoplay = true;
      element.dataset.trackName = audioTrackName(track, publication);
      $("remote-audio").appendChild(element);
    });
    room.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => element.remove());
    });
    room.on(lk.RoomEvent.DataReceived, (payload) => {
      try {
        const event = JSON.parse(new TextDecoder().decode(payload));
        if (handlePipelineEvent(event)) return;
        if (isCaptionEvent(event)) updateCaption(event);
      } catch {
        // Ignore non-caption data packets.
      }
    });
  }

  function isCaptionEvent(event) {
    return event.type?.includes("transcript") ||
      event.type?.includes("translation") ||
      event.type === "worker.status" ||
      event.type === "tts.ready";
  }

  async function join() {
    if (!$("consent").checked) {
      status("请先确认通话转写和翻译授权", "warn");
      return;
    }
    $("join").disabled = true;
    state.captionsOnly = $("captions-only").checked;
    try {
      await unlockAudioPlayback();
      status("正在检查通话链接");
      const linkResponse = await fetch("/call-links/" + encodeURIComponent(callId));
      if (!linkResponse.ok) throw new Error("通话链接不存在或已过期");
      const link = await linkResponse.json();
      $("room-name").textContent = link.roomName || "未配置";

      status("正在申请入会凭证");
      const tokenResponse = await fetch("/call-links/" + encodeURIComponent(callId) + "/room-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantRole: "guest",
          participantName: $("name").value.trim() || "guest",
        }),
      });
      if (!tokenResponse.ok) throw new Error("通话房间暂未配置");
      const token = await tokenResponse.json();
      state.localParticipantIdentity = token.participantIdentity || "";
      state.fullDuplexEnabled = token.fullDuplexEnabled === true;
      state.duplexDegraded = false;
      if (!window.LivekitClient?.Room) throw new Error("通话 SDK 未加载");

      if (!state.captionsOnly) {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("当前浏览器无法使用麦克风，可勾选仅字幕模式后加入");
        }
        status("正在申请麦克风权限");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: callAudioCaptureOptions(),
          video: false,
        });
        stream.getTracks().forEach((track) => track.stop());
      }

      status("正在连接房间");
      const room = new window.LivekitClient.Room({ adaptiveStream: true, dynacast: true });
      bindRoom(room);
      await room.connect(token.wsUrl, token.token);
      try {
        const activation = await confirmRoomConnection(token);
        if (!state.captionsOnly) {
          await room.localParticipant.setMicrophoneEnabled(
            true,
            callAudioCaptureOptions(),
          );
        }
        state.room = room;
        showActivationState(activation);
      } catch (error) {
        room.disconnect();
        throw error;
      }
      $("leave").disabled = false;
    } catch (error) {
      status(error.message || "加入失败", "error");
      updateJoinButton();
    }
  }

  async function unlockAudioPlayback() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor || state.audioUnlocked) return;
    const context = new AudioContextCtor();
    try {
      if (context.state === "suspended") await context.resume();
      state.audioUnlocked = context.state === "running";
    } finally {
      await context.close?.();
      detectEnvironment();
    }
  }

  function leave() {
    stopActivationPolling();
    resetTtsCaptureGate();
    state.room?.disconnect();
    state.room = null;
    state.fullDuplexEnabled = false;
    state.duplexDegraded = false;
    $("remote-audio").textContent = "";
    $("leave").disabled = true;
    updateJoinButton();
    status("已离开通话");
  }

  detectEnvironment();
  updateJoinButton();
  $("join").addEventListener("click", join);
  $("leave").addEventListener("click", leave);
  $("consent").addEventListener("change", updateJoinButton);
  $("captions-only").addEventListener("change", () => {
    state.captionsOnly = $("captions-only").checked;
  });
  $("report").addEventListener("click", reportCall);
  $("copy-link").addEventListener("click", copyCallLink);
  $("back-to-latest").addEventListener("click", scrollToLatest);
  window.addEventListener("scroll", updateFollowLatestFromScroll, { passive: true });
})();`;
}
