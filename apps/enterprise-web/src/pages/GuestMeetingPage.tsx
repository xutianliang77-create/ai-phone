import { useState } from "react";
import { useParams } from "react-router-dom";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { enterpriseIcons } from "../icon-registry.js";
import { consumeGuestInvitation } from "../guest/guest-invitation.js";

type MicrophoneState = "idle" | "checking" | "ready" | "denied" | "unavailable";

export function GuestMeetingPage() {
  const { meetingId } = useParams();
  const [invitation] = useState(() => consumeGuestInvitation(meetingId));
  const [microphone, setMicrophone] = useState<MicrophoneState>("idle");
  const invitationReady = invitation.status === "ready";
  const mediaSupported = Boolean(navigator.mediaDevices?.getUserMedia);
  const screenShareSupported = Boolean(navigator.mediaDevices?.getDisplayMedia);

  async function checkMicrophone() {
    if (!invitationReady || !mediaSupported) {
      setMicrophone("unavailable");
      return;
    }
    setMicrophone("checking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophone("ready");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setMicrophone(name === "NotAllowedError" ? "denied" : "unavailable");
    }
  }

  return (
    <main className="guest-meeting-shell">
      <header className="guest-meeting-header">
        <div>
          <span className="eyebrow">无界AI企业会议</span>
          <h1>访客参会</h1>
        </div>
        <span className="guest-meeting-header__privacy">
          <MaterialIcon name={enterpriseIcons.guest.privateMeeting} />
          受限会议邀请
        </span>
      </header>

      <section className="guest-meeting-grid" aria-label="入会前检查">
        <div className="guest-meeting-main">
          <InvitationStatus status={invitation.status} />
          <section className="guest-meeting-card" aria-labelledby="device-check-title">
            <div className="guest-meeting-card__heading">
              <MaterialIcon name={enterpriseIcons.guest.devices} />
              <div>
                <h2 id="device-check-title">设备检查</h2>
                <p>只检查当前浏览器能力；不会在未入会时采集或上传音频。</p>
              </div>
            </div>
            <div className="guest-capability-list">
              <CapabilityRow
                icon={enterpriseIcons.guest.microphone}
                label="麦克风"
                value={invitationReady
                  ? microphoneLabel(microphone, mediaSupported)
                  : "等待有效会议邀请"}
                state={microphone === "ready" ? "ready" : "neutral"}
                action={
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={checkMicrophone}
                    disabled={!invitationReady || microphone === "checking"}
                  >
                    {microphone === "checking" ? "检查中" : "检查麦克风"}
                  </button>
                }
              />
              <CapabilityRow
                icon={enterpriseIcons.action.shareScreen}
                label="屏幕共享"
                value={screenShareSupported ? "浏览器支持，入会后仍需服务端租约" : "当前浏览器不支持"}
                state="neutral"
              />
            </div>
          </section>
        </div>

        <aside className="guest-meeting-side" aria-label="会议能力">
          <GuestFeature
            icon={enterpriseIcons.guest.captions}
            title="实时字幕"
            description="建立受限 meeting session 后才会订阅字幕，不读取其他会议。"
          />
          <GuestFeature
            icon={enterpriseIcons.action.shareScreen}
            title="共享屏幕"
            description="需要参会身份、主持人策略与短期共享租约，当前不提前请求屏幕权限。"
          />
        </aside>
      </section>
    </main>
  );
}

function InvitationStatus({ status }: { status: "ready" | "missing" | "invalid" }) {
  if (status === "ready") {
    return (
      <StatusPanel
        state="not_ready"
        title="访客入会尚未接通"
        description="邀请凭据已从地址栏移除并只保留在页面内存。企业 guest session API 尚未实现，未连接会议、字幕或共享。"
      />
    );
  }
  return (
    <StatusPanel
      state="forbidden"
      title={status === "missing" ? "缺少会议邀请" : "会议邀请无效"}
      description="请让会议主持人重新发送完整邀请链接。凭据只接受 URL fragment，不接受 query 参数。"
    />
  );
}

function CapabilityRow({
  icon,
  label,
  value,
  state,
  action,
}: {
  icon: string;
  label: string;
  value: string;
  state: "ready" | "neutral";
  action?: React.ReactNode;
}) {
  return (
    <div className="guest-capability-row" data-capability-state={state}>
      <MaterialIcon name={icon} />
      <div>
        <strong>{label}</strong>
        <span aria-live="polite">{value}</span>
      </div>
      {action}
    </div>
  );
}

function GuestFeature({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <section className="guest-feature">
      <MaterialIcon name={icon} />
      <h2>{title}</h2>
      <p>{description}</p>
      <button className="button button--secondary button--full" type="button" disabled>
        等待会议会话
      </button>
    </section>
  );
}

function microphoneLabel(state: MicrophoneState, supported: boolean) {
  if (!supported) return "当前浏览器不支持";
  return {
    idle: "尚未检查",
    checking: "正在请求浏览器权限",
    ready: "可用，媒体轨道已立即停止",
    denied: "未获得麦克风权限",
    unavailable: "设备不可用或被占用",
  }[state];
}
