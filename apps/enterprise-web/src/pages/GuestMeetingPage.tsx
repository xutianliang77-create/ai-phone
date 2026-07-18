import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { createEnterpriseApi } from "../api/enterprise-api.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { consumeGuestInvitation } from "../guest/guest-invitation.js";
import { enterpriseIcons } from "../icon-registry.js";
import {
  EnterpriseMeetingRoomClient,
  type EnterpriseMeetingRoomSnapshot,
} from "../meeting/enterprise-meeting-room.js";
import { MeetingTranslationPanel } from
  "../meeting/MeetingTranslationPanel.js";

const disconnected: EnterpriseMeetingRoomSnapshot = {
  status: "disconnected",
  microphoneEnabled: false,
  remoteParticipantCount: 0,
  translationStatus: "not_ready",
  translationReasonCode: "not_joined",
  captionLanguage: "zh",
  translatedAudioEnabled: false,
  translatedAudioAvailable: false,
  captions: [],
  screenShareTrack: null,
  screenSharePublisherIdentity: null,
};

export function GuestMeetingPage() {
  const { meetingId } = useParams();
  const [invitation] = useState(() => consumeGuestInvitation(meetingId));
  const [room, setRoom] = useState(disconnected);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [captionLanguage, setCaptionLanguage] = useState<"zh" | "en">("zh");
  const [translatedAudioEnabled, setTranslatedAudioEnabled] = useState(false);
  const roomClient = useRef<EnterpriseMeetingRoomClient | null>(null);

  useEffect(() => {
    const client = new EnterpriseMeetingRoomClient(setRoom);
    roomClient.current = client;
    return () => { void client.disconnect(); };
  }, []);

  async function join() {
    if (invitation.status !== "ready" || busy || !roomClient.current) return;
    setBusy(true);
    setFailure(null);
    try {
      const grant = await createEnterpriseApi().joinMeetingAsGuest(
        invitation.meetingId,
        { token: invitation.token, captionLanguage, translatedAudioEnabled },
      );
      await roomClient.current.connect(grant);
    } catch {
      setFailure("邀请可能已过期、会议尚未开始，或企业 RTC Provider 尚未就绪。请联系主持人重发邀请。");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    await roomClient.current?.disconnect();
  }

  return (
    <main className="guest-meeting-shell">
      <header className="guest-meeting-header">
        <div><span className="eyebrow">无界AI企业会议</span><h1>访客参会</h1></div>
        <span className="guest-meeting-header__privacy">
          <MaterialIcon name={enterpriseIcons.guest.privateMeeting} />受限会议邀请
        </span>
      </header>
      <section className="guest-meeting-grid" aria-label="访客入会">
        <div className="guest-meeting-main">
          <InvitationStatus status={invitation.status} failure={failure} />
          {invitation.status === "ready" ? (
            <section className="guest-meeting-card" aria-labelledby="guest-room-title">
              <div className="guest-meeting-card__heading">
                <MaterialIcon name={enterpriseIcons.guest.devices} />
                <div><h2 id="guest-room-title">音频会议</h2>
                  <p>凭据只保留在当前页面内存；服务端只签发麦克风发布和音频订阅能力。</p></div>
              </div>
              <div className="guest-capability-list">
                <CapabilityRow icon={enterpriseIcons.guest.microphone} label="麦克风"
                  value={microphoneLabel(room)} ready={room.microphoneEnabled} />
                <CapabilityRow icon="groups" label="远端参会者"
                  value={`${room.remoteParticipantCount} 人`} ready={room.status === "connected"} />
              </div>
              <div className="guest-meeting-actions">
                {room.status === "disconnected" ? (
                  <button className="button button--primary" type="button"
                    disabled={busy} onClick={() => void join()}>
                    <MaterialIcon name="login" />{busy ? "正在入会" : "加入音频会议"}
                  </button>
                ) : (
                  <>
                    <button className="button button--secondary" type="button"
                      onClick={() => void roomClient.current?.setMicrophoneEnabled(
                        !room.microphoneEnabled,
                      )}>
                      <MaterialIcon name={room.microphoneEnabled ? "mic" : "mic_off"} />
                      {room.microphoneEnabled ? "静音" : "打开麦克风"}
                    </button>
                    <button className="button button--secondary" type="button"
                      onClick={() => void leave()}>离开会议</button>
                  </>
                )}
              </div>
            </section>
          ) : null}
        </div>
        <aside className="guest-meeting-side" aria-label="会议能力">
          <MeetingTranslationPanel room={room} captionLanguage={captionLanguage}
            translatedAudioEnabled={translatedAudioEnabled}
            editable={room.status === "disconnected"}
            onCaptionLanguage={setCaptionLanguage}
            onTranslatedAudioEnabled={setTranslatedAudioEnabled} />
          <GuestFeature icon={enterpriseIcons.action.shareScreen} title="共享屏幕"
            description="当前短期凭据明确禁止屏幕发布；共享能力由后续租约控制。" />
        </aside>
      </section>
    </main>
  );
}

function InvitationStatus(props: {
  status: "ready" | "missing" | "invalid";
  failure: string | null;
}) {
  if (props.failure) return <StatusPanel state="not_ready" title="暂时无法入会"
    description={props.failure} />;
  if (props.status === "ready") return <StatusPanel state="processing"
    title="邀请已验证待换票"
    description="链接中的加密邀请已移除；点击入会后才向服务端换取短期 RTC 凭据。" />;
  return <StatusPanel state="forbidden"
    title={props.status === "missing" ? "缺少会议邀请" : "会议邀请无效"}
    description="请让主持人重新发送完整邀请链接。凭据只接受 URL fragment，不接受 query 参数。" />;
}

function CapabilityRow(props: {
  icon: string;
  label: string;
  value: string;
  ready: boolean;
}) {
  return <div className="guest-capability-row"
    data-capability-state={props.ready ? "ready" : "neutral"}>
    <MaterialIcon name={props.icon} />
    <div><strong>{props.label}</strong><span aria-live="polite">{props.value}</span></div>
  </div>;
}

function GuestFeature(props: { icon: string; title: string; description: string }) {
  return <section className="guest-feature"><MaterialIcon name={props.icon} />
    <h2>{props.title}</h2><p>{props.description}</p>
    <button className="button button--secondary button--full" type="button" disabled>
      后续任务开放
    </button>
  </section>;
}

function microphoneLabel(room: EnterpriseMeetingRoomSnapshot) {
  if (room.status === "connecting") return "正在连接并请求浏览器权限";
  if (room.status === "reconnecting") return "正在重连";
  if (room.status === "connected") return room.microphoneEnabled ? "已打开" : "已静音";
  return "入会后请求权限";
}
