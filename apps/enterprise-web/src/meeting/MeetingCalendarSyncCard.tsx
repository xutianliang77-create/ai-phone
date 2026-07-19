import { useCallback, useEffect, useState } from "react";
import type { EnterpriseMeetingCalendarSyncDto } from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "../api/enterprise-api.js";
import type { EnterpriseMeetingApi } from "../api/enterprise-meeting-api.js";
import { apiErrorState } from "../business-state.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { enterpriseIcons } from "../icon-registry.js";

type State = { status: "loading" } |
  { status: "ready"; sync: EnterpriseMeetingCalendarSyncDto | null } |
  { status: "failed"; error: unknown };

export function MeetingCalendarSyncCard(props: {
  api: EnterpriseMeetingApi;
  context: EnterpriseContentRequestContext;
  meetingId: string;
  meetingVersion: number;
  canSync: boolean;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await props.api.currentMeetingCalendarSync(
        props.context, props.meetingId,
      );
      setState({ status: "ready", sync: result.sync });
    } catch (error) { setState({ status: "failed", error }); }
  }, [props.api, props.context, props.meetingId]);
  useEffect(() => { void load(); }, [load]);

  async function sync() {
    if (busy || !props.canSync) return;
    setBusy(true);
    try {
      const result = await props.api.requestMeetingCalendarSync(
        props.context, props.meetingId,
        { expectedMeetingVersion: props.meetingVersion, durationMinutes: duration },
        crypto.randomUUID(),
      );
      setState({ status: "ready", sync: result.sync });
    } catch (error) { setState({ status: "failed", error }); }
    finally { setBusy(false); }
  }

  const syncRecord = state.status === "ready" ? state.sync : null;
  return <section className="meeting-calendar" aria-label="企业日历同步">
    <header><MaterialIcon name={enterpriseIcons.meeting.calendar} />
      <div><strong>企业日历</strong><span>{label(state)}</span></div></header>
    {state.status === "failed" ? <p>{failureLabel(state.error)}</p> : null}
    {syncRecord?.status === "failed" ?
      <p>同步失败：{syncRecord.lastErrorCode ?? "calendar_provider_failed"}</p> : null}
    {syncRecord?.status === "pending" && syncRecord.lastErrorCode ?
      <p>Worker 将继续重试：{syncRecord.lastErrorCode}</p> : null}
    {!syncRecord && state.status === "ready" ? <div className="meeting-calendar__actions">
      <label>时长
        <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
          <option value={30}>30 分钟</option><option value={60}>1 小时</option>
          <option value={90}>1.5 小时</option><option value={120}>2 小时</option>
        </select>
      </label>
      <button className="button button--secondary" type="button"
        disabled={!props.canSync || busy} onClick={() => void sync()}>
        <MaterialIcon name={enterpriseIcons.meeting.calendarSync} />
        {busy ? "正在提交" : "同步到 Google Calendar"}
      </button>
    </div> : null}
    {syncRecord?.status === "synced" && syncRecord.providerWebUrl ?
      <a className="button button--secondary" href={syncRecord.providerWebUrl}
        target="_blank" rel="noreferrer">
        <MaterialIcon name={enterpriseIcons.meeting.openExternal} />查看日历事件
      </a> : null}
    <small>仅同步主持人的无界AI会议入口；外部访客仍须单独创建邀请。</small>
  </section>;
}

function label(state: State) {
  if (state.status === "loading") return "正在读取";
  if (state.status === "failed") return "当前不可用";
  if (!state.sync) return "尚未同步";
  return ({ pending: "等待 Worker", synced: "已同步", failed: "同步失败" })[state.sync.status];
}
function failureLabel(error: unknown) {
  const state = apiErrorState(error);
  if (state === "not_ready") return "日历 Provider 尚未配置或健康检查未通过。";
  if (state === "forbidden") return "只有会议主持人可以同步日历。";
  if (state === "conflict") return "会议状态已变化，请刷新后重试。";
  return "无法读取企业日历状态。";
}
