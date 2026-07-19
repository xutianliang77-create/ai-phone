import { useEffect, useRef, useState } from "react";
import type {
  EnterpriseMeetingScreenShareQuality,
  EnterpriseMeetingScreenShareSource,
} from "@translation/contracts";
import type { RemoteVideoTrack } from "livekit-client";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { enterpriseIcons } from "../icon-registry.js";
import {
  EnterpriseMeetingScreenShareController,
  type EnterpriseMeetingScreenShareSnapshot,
} from "./enterprise-meeting-screen-share-controller.js";
import type {
  EnterpriseMeetingRoomClient,
  EnterpriseMeetingRoomSnapshot,
} from "./enterprise-meeting-room.js";

const emptySnapshot: EnterpriseMeetingScreenShareSnapshot = {
  operation: "idle",
  share: null,
  localTrack: null,
  localSystemAudioAvailable: false,
  revocation: "not_required",
};

export function MeetingScreenSharePanel(props: {
  api: EnterpriseApi;
  context: EnterpriseContentRequestContext;
  meetingId: string;
  participantId: string;
  canShare: boolean;
  room: EnterpriseMeetingRoomSnapshot;
  roomClient: EnterpriseMeetingRoomClient;
}) {
  const [quality, setQuality] = useState<EnterpriseMeetingScreenShareQuality>("auto");
  const [includesSystemAudio, setIncludesSystemAudio] = useState(false);
  const [state, setState] = useState(emptySnapshot);
  const controller = useRef<EnterpriseMeetingScreenShareController | null>(null);

  useEffect(() => {
    const value = new EnterpriseMeetingScreenShareController(
      props.api, props.context, props.meetingId, props.participantId, setState,
    );
    controller.current = value;
    value.startPolling();
    return () => {
      controller.current = null;
      value.dispose();
    };
  }, [props.api, props.context, props.meetingId, props.participantId]);

  const share = state.share;
  const ownShare = share?.participantId === props.participantId;
  const expectedIdentity = share?.status === "active" ? share.publisherIdentity : null;
  useEffect(() => {
    props.roomClient.setExpectedScreenSharePublisherIdentity(expectedIdentity);
    return () => props.roomClient.setExpectedScreenSharePublisherIdentity(null);
  }, [expectedIdentity, props.roomClient]);

  const localTrack = share?.status === "active" && ownShare ? state.localTrack : null;
  const remoteTrack = share?.status === "active" && !ownShare
    ? props.room.screenShareTrack : null;
  const visibleTrack = localTrack !== null || remoteTrack !== null;
  const occupied = share?.status === "active" || share?.status === "paused";

  return <section className="meeting-screen-share" aria-label="会议屏幕共享">
    <header>
      <MaterialIcon name={enterpriseIcons.action.shareScreen} outlined />
      <div><h2>屏幕共享</h2>
        <p>{screenShareSummary(state, ownShare)}</p></div>
      <span className={`meeting-screen-share__state state--${state.operation}`}>
        {operationLabel(state)}
      </span>
    </header>

    {visibleTrack ? <ScreenShareVideo localTrack={localTrack}
      remoteTrack={remoteTrack} own={ownShare} /> :
      <div className="meeting-screen-share__empty">
        <MaterialIcon name={share?.status === "paused" ? "pause_circle" :
          enterpriseIcons.action.shareScreen}
          outlined />
        <span>{share?.status === "paused" ? "演示者已暂停共享" :
          occupied ? "正在等待当前代际的视频轨道" : "当前没有人共享屏幕"}</span>
      </div>}

    {share?.status === "active" && share.includesSystemAudio ?
      <ScreenShareAudio track={props.room.screenShareAudioTrack} own={ownShare}
        available={ownShare ? state.localSystemAudioAvailable :
          props.room.screenShareAudioTrack !== null} /> : null}

    <div className="meeting-screen-share__controls">
      {!occupied ? <>
        <label>画面质量
          <select value={quality} disabled={!props.canShare ||
            !["idle", "failed"].includes(state.operation)}
            onChange={(event) => setQuality(
              event.target.value as EnterpriseMeetingScreenShareQuality,
            )}>
            <option value="auto">自动</option>
            <option value="smooth">流畅优先</option>
            <option value="high">清晰优先</option>
          </select>
        </label>
        <label className="meeting-screen-share__audio-option">
          <span><input type="checkbox" checked={includesSystemAudio}
            disabled={!props.canShare || !["idle", "failed"].includes(state.operation)}
            onChange={(event) => setIncludesSystemAudio(event.target.checked)} />
            共享系统音频</span>
          <small>仅浏览器实际返回独立音轨时发布；不会作为麦克风送入会议 ASR。</small>
        </label>
        <button className="button button--primary" type="button"
          disabled={!props.canShare || !["idle", "failed"].includes(state.operation)}
          onClick={() => void controller.current?.start(quality, includesSystemAudio)}>
          <MaterialIcon name={enterpriseIcons.action.shareScreen} />共享屏幕
        </button>
      </> : null}
      {ownShare && share?.status === "active" ? <button
        className="button button--secondary" type="button"
        disabled={state.operation !== "active"}
        onClick={() => void controller.current?.pause()}>
        <MaterialIcon name="pause" />暂停共享
      </button> : null}
      {ownShare && share?.status === "paused" ? <button
        className="button button--primary" type="button"
        disabled={state.operation !== "paused"}
        onClick={() => void controller.current?.resume()}>
        <MaterialIcon name="play_arrow" />继续共享
      </button> : null}
      {ownShare && occupied ? <button className="button button--secondary" type="button"
        disabled={!['active', 'paused', 'failed'].includes(state.operation)}
        onClick={() => void controller.current?.stop()}>
        <MaterialIcon name={enterpriseIcons.action.stopShare} />停止共享
      </button> : null}
    </div>
    {!props.canShare && !occupied ? <p className="meeting-screen-share__hint">
      当前会议策略仅允许主持人共享屏幕。
    </p> : null}
    {state.errorCode ? <p className="meeting-screen-share__error" role="status">
      {errorLabel(state.errorCode)}
    </p> : null}
  </section>;
}

function ScreenShareAudio(props: {
  track: MediaStreamTrack | null;
  own: boolean;
  available: boolean;
}) {
  const element = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const audio = element.current;
    if (!audio || !props.track || props.own) return;
    audio.srcObject = new MediaStream([props.track]);
    void audio.play().catch(() => undefined);
    return () => { audio.srcObject = null; };
  }, [props.track, props.own]);
  return <div className="meeting-screen-share__audio">
    <MaterialIcon name={props.available ? "volume_up" : "volume_off"} outlined />
    <span>{props.own ? props.available ?
      "系统音频已独立发布；本机不回放，避免形成回声。" :
      "系统音频已停止，共享画面继续。" : props.track ?
        "正在播放演示者共享的系统音频。" : "系统音频暂不可用，共享画面继续。"}</span>
    {!props.own && props.track ? <audio ref={element} autoPlay controls /> : null}
  </div>;
}

function ScreenShareVideo(props: {
  localTrack: MediaStreamTrack | null;
  remoteTrack: RemoteVideoTrack | null;
  own: boolean;
}) {
  const element = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = element.current;
    if (!video) return;
    if (props.remoteTrack) {
      props.remoteTrack.attach(video);
    } else if (props.localTrack) {
      video.srcObject = new MediaStream([props.localTrack]);
    }
    void video.play().catch(() => undefined);
    return () => {
      if (props.remoteTrack) props.remoteTrack.detach(video);
      video.srcObject = null;
    };
  }, [props.localTrack, props.remoteTrack]);
  return <div className="meeting-screen-share__video">
    <video ref={element} autoPlay playsInline muted={props.own} />
    <span>{props.own ? "你的共享画面" : "当前共享画面"}</span>
  </div>;
}

function screenShareSummary(
  state: EnterpriseMeetingScreenShareSnapshot,
  ownShare: boolean,
) {
  const share = state.share;
  if (!share || ["ended", "expired"].includes(share.status)) {
    return "浏览器选择内容后，系统按实际的屏幕、窗口或标签页建立独立发布租约。";
  }
  return `${ownShare ? "你" : "另一位参会者"}正在共享${sourceLabel(share.sourceType)}` +
    ` · ${qualityLabel(share.qualityMode)} · ${share.includesSystemAudio ?
      "已请求系统音频" : "不含系统音频"} · 第 ${share.generation} 代`;
}

function operationLabel(state: EnterpriseMeetingScreenShareSnapshot) {
  if (state.revocation === "pending" && state.operation === "stopping") return "正在停止";
  if (state.revocation === "pending" && state.operation === "pausing") return "正在暂停";
  return ({
    idle: "未共享", capturing: "等待选择", starting: "正在发布", active: "共享中",
    pausing: "正在暂停", paused: "已暂停", resuming: "正在恢复",
    stopping: "正在停止", failed: "需要处理",
  })[state.operation];
}

function sourceLabel(value: EnterpriseMeetingScreenShareSource) {
  return ({ screen: "整个屏幕", window: "应用窗口", tab: "浏览器标签页" })[value];
}
function qualityLabel(value: EnterpriseMeetingScreenShareQuality) {
  return ({ auto: "自动质量", smooth: "流畅优先", high: "清晰优先" })[value];
}
function errorLabel(code: string) {
  return ({
    screen_capture_unsupported: "当前浏览器不支持安全的屏幕采集。",
    screen_capture_missing_video: "浏览器没有返回可共享的视频轨道。",
    screen_capture_audio_unavailable: "浏览器未返回系统音频；请选择支持音频的标签页或关闭系统音频选项。",
    screen_capture_source_unknown: "浏览器未报告实际共享类型，未建立租约。",
    screen_capture_not_allowed: "你取消了屏幕选择，未建立共享租约。",
    screen_share_capture_ended: "浏览器已结束屏幕采集，服务端租约正在收敛。",
    screen_share_busy: "已有参会者正在共享；正在读取当前共享状态。",
    screen_share_conflict: "共享状态已变化；正在重新读取服务端状态。",
    screen_share_forbidden: "当前参会身份或会议策略不允许共享屏幕。",
    screen_share_not_ready: "屏幕共享服务尚未就绪，未发布本地画面。",
    screen_share_provider_not_ready: "LiveKit 屏幕发布能力未就绪，未伪造共享成功。",
    enterprise_postgres_required: "企业 PostgreSQL 运行时未就绪，屏幕共享保持关闭。",
    screen_share_revocation_pending: "旧发布身份仍在撤销中；服务端会继续重试。",
    screen_share_grant_missing: "屏幕发布凭证未就绪，未伪造共享成功。",
    screen_share_grant_mismatch: "系统音频权限与采集结果不一致，已停止本次共享。",
    screen_share_audio_ended: "系统音频已结束，共享画面继续。",
    screen_share_request_failed: "屏幕共享请求失败，请刷新会议状态后重试。",
  } as Record<string, string>)[code] ?? "屏幕共享状态发生变化，请刷新后重试。";
}
