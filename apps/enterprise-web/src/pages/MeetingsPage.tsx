import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EnterpriseMeetingAggregateDto } from "@translation/contracts";
import { useAuth } from "../auth/AuthContext.js";
import { apiErrorState } from "../business-state.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { enterpriseIcons } from "../icon-registry.js";
import {
  EnterpriseMeetingRoomClient,
  type EnterpriseMeetingRoomSnapshot,
} from "../meeting/enterprise-meeting-room.js";
import { MeetingTranslationPanel } from
  "../meeting/MeetingTranslationPanel.js";
import { MeetingMediaWorkspace } from
  "../meeting/MeetingMediaWorkspace.js";
import { MeetingScreenSharePanel } from
  "../meeting/MeetingScreenSharePanel.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; meetings: EnterpriseMeetingAggregateDto[] }
  | { status: "failed"; error: unknown };

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
  screenShareAudioTrack: null,
  screenSharePublisherIdentity: null,
};

export function MeetingsPage() {
  const { state, api } = useAuth();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [room, setRoom] = useState(disconnected);
  const [joined, setJoined] = useState<{
    meetingId: string;
    participantId: string;
    canShare: boolean;
  } | null>(null);
  const [captionLanguage, setCaptionLanguage] = useState<"zh" | "en">("zh");
  const [translatedAudioEnabled, setTranslatedAudioEnabled] = useState(false);
  const roomClient = useRef<EnterpriseMeetingRoomClient | null>(null);
  const ready = state.status === "ready" ? state : null;
  const requestContext = useMemo(() => ready ? ({
    token: ready.session.token,
    tenantId: ready.context.tenant.id,
    routeDocument: ready.routeDocument,
  }) : null, [ready]);
  const canWrite = ready?.context.scopes.includes("meeting:write") ?? false;
  const canJoin = ready !== null && ready.context.member.role !== "auditor";

  useEffect(() => {
    const client = new EnterpriseMeetingRoomClient(setRoom);
    roomClient.current = client;
    return () => { void client.disconnect(); };
  }, []);

  const refresh = useCallback(async () => {
    if (!requestContext) return;
    setLoad({ status: "loading" });
    try {
      const result = await api.listMeetings(requestContext);
      setLoad({ status: "ready", meetings: result.meetings });
    } catch (error) {
      setLoad({ status: "failed", error });
    }
  }, [api, requestContext]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createMeeting() {
    const cleanTitle = title.trim();
    if (!requestContext || !cleanTitle || busy) return;
    setBusy("create");
    setNotice(null);
    try {
      await api.createMeeting(requestContext, {
        title: cleanTitle,
        policy: {
          allowGuests: true,
          screenShareRole: "host_only",
          defaultLanguage: "zh-CN",
        },
      }, crypto.randomUUID());
      setTitle("");
      setNotice("会议已创建；统一通讯仍会按服务端状态显示 provisioning 或 ready。");
      await refresh();
    } catch (error) {
      setLoad({ status: "failed", error });
    } finally {
      setBusy(null);
    }
  }

  async function joinMeeting(meeting: EnterpriseMeetingAggregateDto) {
    if (!requestContext || busy || !roomClient.current) return;
    setBusy(`join:${meeting.meeting.id}`);
    setNotice(null);
    try {
      const grant = await api.joinMeeting(requestContext, meeting.meeting.id, {
        displayName: ready?.context.tenant.name ?? "企业成员",
        captionLanguage,
        translatedAudioEnabled,
      });
      await roomClient.current.connect(grant);
      setJoined({
        meetingId: meeting.meeting.id,
        participantId: grant.participantId,
        canShare: grant.participantRole === "host" ||
          meeting.meeting.policy.screenShareRole === "members",
      });
      setNotice(grant.translation.status === "not_ready"
        ? `已进入音频会议；字幕未就绪（${grant.translation.reasonCode}）。`
        : "已进入音频会议；字幕按个人语言偏好定向投递。");
    } catch (error) {
      setNotice(`入会失败：${errorStateLabel(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function inviteGuest(meetingId: string) {
    if (!requestContext || busy) return;
    setBusy(`invite:${meetingId}`);
    setNotice(null);
    try {
      const result = await api.createMeetingGuestInvitation(requestContext, meetingId, {
        displayName: "会议访客",
        language: "zh-CN",
      }, crypto.randomUUID());
      const url = new URL(`/join/${encodeURIComponent(meetingId)}`, window.location.origin);
      url.hash = `token=${result.invitation.token}`;
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(url.toString());
      setNotice(`访客邀请已复制；${formatTime(result.invitation.expiresAt)} 前有效。`);
    } catch (error) {
      setNotice(`邀请未创建或未复制：${errorStateLabel(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function leaveMeeting() {
    await roomClient.current?.disconnect();
    setJoined(null);
    setNotice("已离开会议，麦克风和本地屏幕采集轨道已停止。");
  }

  const translationPanel = <MeetingTranslationPanel room={room}
    captionLanguage={captionLanguage} translatedAudioEnabled={translatedAudioEnabled}
    editable={room.status === "disconnected"} onCaptionLanguage={setCaptionLanguage}
    onTranslatedAudioEnabled={setTranslatedAudioEnabled} />;

  return (
    <PageFrame title="企业会议"
      description="租户隔离的音频会议、定向字幕与代际受控屏幕共享">
      {canWrite ? (
        <form className="meeting-create" onSubmit={(event) => {
          event.preventDefault(); void createMeeting();
        }}>
          <label>会议名称
            <input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：中英项目周会" />
          </label>
          <button className="button button--primary" disabled={!title.trim() || busy !== null}>
            <MaterialIcon name={enterpriseIcons.action.create} />创建即时会议
          </button>
        </form>
      ) : null}
      {notice ? <p className="meeting-notice" role="status">{notice}</p> : null}
      {room.status !== "disconnected" ? (
        <section className="meeting-room-status" aria-label="当前会议连接">
          <div><strong>{roomStatus(room.status)}</strong>
            <span>远端参会者 {room.remoteParticipantCount}</span></div>
          <button className="button button--secondary" type="button"
            onClick={() => void roomClient.current?.setMicrophoneEnabled(!room.microphoneEnabled)}>
            <MaterialIcon name={room.microphoneEnabled ? "mic" : "mic_off"} />
            {room.microphoneEnabled ? "静音" : "打开麦克风"}
          </button>
          <button className="button button--secondary" type="button"
            onClick={() => void leaveMeeting()}>离开会议</button>
        </section>
      ) : null}
      {requestContext && joined && roomClient.current && room.status !== "disconnected" ?
        <MeetingMediaWorkspace captions={translationPanel} screen={
          <MeetingScreenSharePanel api={api} context={requestContext}
            meetingId={joined.meetingId} participantId={joined.participantId}
            canShare={joined.canShare} room={room} roomClient={roomClient.current} />
        } /> : translationPanel}
      <MeetingList load={load} busy={busy} canJoin={canJoin} canWrite={canWrite}
        activeMeetingId={joined?.meetingId ?? null} refresh={refresh}
        joinMeeting={joinMeeting} inviteGuest={inviteGuest} />
    </PageFrame>
  );
}

function MeetingList(props: {
  load: LoadState;
  busy: string | null;
  canJoin: boolean;
  canWrite: boolean;
  activeMeetingId: string | null;
  refresh(): Promise<void>;
  joinMeeting(value: EnterpriseMeetingAggregateDto): Promise<void>;
  inviteGuest(meetingId: string): Promise<void>;
}) {
  if (props.load.status === "loading") {
    return <StatusPanel state="loading" description="正在读取当前企业的会议。" />;
  }
  if (props.load.status === "failed") {
    return <StatusPanel state={apiErrorState(props.load.error)}
      description="会议数据未就绪，未回退到个人 Call Link 或示例数据。"
      action={<button className="button button--secondary" onClick={() => void props.refresh()}>
        重新读取
      </button>} />;
  }
  if (props.load.meetings.length === 0) {
    return <StatusPanel state="empty" description="当前企业还没有会议。" />;
  }
  return <div className="meeting-list">{props.load.meetings.map((item) => {
    const meeting = item.meeting;
    const joinable = ["provisioning", "active"].includes(meeting.status) ||
      meeting.status === "scheduled";
    return <article className="meeting-card" key={meeting.id}>
      <header><MaterialIcon name={enterpriseIcons.navigation.meetings.outlined} outlined />
        <div><h2>{meeting.title}</h2><span>{meetingStatus(meeting.status)}</span></div></header>
      <dl><div><dt>参会者</dt><dd>{item.participants.length}</dd></div>
        <div><dt>通讯状态</dt><dd>{item.communication?.status ?? "not_ready"}</dd></div>
        <div><dt>时间</dt><dd>{formatTime(meeting.scheduledAt ?? meeting.createdAt)}</dd></div></dl>
      <footer>
        {props.canJoin && joinable ? <button className="button button--primary" type="button"
          disabled={props.busy !== null || props.activeMeetingId === meeting.id}
          onClick={() => void props.joinMeeting(item)}>
          <MaterialIcon name="login" />{props.activeMeetingId === meeting.id ? "已加入" : "加入"}
        </button> : null}
        {props.canWrite && meeting.policy.allowGuests && joinable ?
          <button className="button button--secondary" type="button" disabled={props.busy !== null}
            onClick={() => void props.inviteGuest(meeting.id)}>
            <MaterialIcon name="person_add" />复制访客邀请
          </button> : null}
      </footer>
    </article>;
  })}</div>;
}

function meetingStatus(value: string) {
  return ({ scheduled: "已预约", provisioning: "准备中", active: "进行中",
    ending: "结束中", ended: "已结束", cancelled: "已取消", failed: "失败" }
  )[value] ?? value;
}
function roomStatus(value: EnterpriseMeetingRoomSnapshot["status"]) {
  return ({ connecting: "正在连接", connected: "已连接", reconnecting: "正在重连",
    disconnected: "已断开" })[value];
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(value));
}
function errorStateLabel(error: unknown) {
  const state = apiErrorState(error);
  if (state === "not_ready") return "服务或 Provider 尚未就绪";
  if (state === "forbidden") return "当前身份无权执行";
  if (state === "conflict") return "会议状态已变化，请刷新";
  return "请求失败";
}
