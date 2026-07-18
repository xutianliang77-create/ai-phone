import { MaterialIcon } from "../components/MaterialIcon.js";
import type { EnterpriseMeetingRoomSnapshot } from
  "./enterprise-meeting-room.js";

export function MeetingTranslationPanel(props: {
  room: EnterpriseMeetingRoomSnapshot;
  captionLanguage: "zh" | "en";
  translatedAudioEnabled: boolean;
  editable: boolean;
  onCaptionLanguage(value: "zh" | "en"): void;
  onTranslatedAudioEnabled(value: boolean): void;
}) {
  return <section className="meeting-translation" aria-label="会议翻译">
    <header><MaterialIcon name="translate" /><div>
      <h2>实时双语字幕</h2>
      <p>{translationState(props.room)}</p>
    </div></header>
    <div className="meeting-translation__preferences">
      <label>我阅读的字幕语言
        <select value={props.captionLanguage} disabled={!props.editable}
          onChange={(event) => props.onCaptionLanguage(
            event.target.value as "zh" | "en",
          )}>
          <option value="zh">中文</option><option value="en">English</option>
        </select>
      </label>
      <label className="meeting-translation__audio">
        <input type="checkbox" checked={props.translatedAudioEnabled}
          disabled={!props.editable}
          onChange={(event) => props.onTranslatedAudioEnabled(event.target.checked)} />
        <span><strong>请求译音</strong>
          <small>定向 TTS 尚未就绪；开启只保存偏好，不会播放全局译音。</small></span>
      </label>
    </div>
    <div className="meeting-caption-feed" aria-live="polite" aria-relevant="additions">
      {props.room.captions.length === 0 ? <p className="meeting-caption-feed__empty">
        {props.room.translationStatus === "not_ready"
          ? "翻译运行时尚未就绪，不显示模拟字幕。"
          : "正在等待参会者发言。"}
      </p> : props.room.captions.slice(-8).map((caption) =>
        <article key={caption.eventId}>
          <div><strong>{caption.sourceDisplayName}</strong>
            <span>{caption.translated ? "译文" : "原文"}</span></div>
          <p lang={caption.type === "transcript.final"
            ? caption.sourceLanguage : caption.targetLanguage}>{caption.text}</p>
        </article>)}
    </div>
  </section>;
}

function translationState(room: EnterpriseMeetingRoomSnapshot) {
  if (room.status === "disconnected") return "入会时按个人偏好申请独立字幕流。";
  if (room.translationStatus === "ready") return "字幕 Worker 已就绪。";
  if (room.translationStatus === "captions_only") return "字幕已就绪，译音保持关闭。";
  return `字幕未就绪（${room.translationReasonCode}）。`;
}
