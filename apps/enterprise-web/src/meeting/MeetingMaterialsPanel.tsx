import { useMemo, useState } from "react";
import type {
  EnterpriseMeetingAggregateDto,
  EnterpriseMeetingMaterialDto,
} from "@translation/contracts";
import type { EnterpriseMeetingApi } from "../api/enterprise-meeting-api.js";
import type { EnterpriseContentRequestContext } from "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { enterpriseIcons } from "../icon-registry.js";

type MaterialLoad =
  | { status: "closed" | "loading" }
  | { status: "ready"; material: EnterpriseMeetingMaterialDto | null }
  | { status: "failed"; error: unknown };

export function MeetingMaterialsPanel(props: {
  api: EnterpriseMeetingApi;
  context: EnterpriseContentRequestContext;
  aggregate: EnterpriseMeetingAggregateDto;
  canWrite: boolean;
  connected: boolean;
  onMeetingChanged(): Promise<void>;
}) {
  const meeting = props.aggregate.meeting;
  const [load, setLoad] = useState<MaterialLoad>({ status: "closed" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generationKey, setGenerationKey] = useState<string | null>(null);
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, string>>({});

  async function open() {
    if (load.status !== "closed") {
      setLoad({ status: "closed" });
      return;
    }
    await reload();
  }

  async function reload() {
    setLoad({ status: "loading" });
    try {
      const response = await props.api.currentMeetingMaterial(props.context, meeting.id);
      setLoad({ status: "ready", material: response.material });
      setSpeakerDrafts(labels(response.material));
    } catch (error) {
      setLoad({ status: "failed", error });
    }
  }

  async function endMeeting() {
    if (busy || props.connected) return;
    setBusy("end"); setNotice(null);
    try {
      await props.api.endMeeting(props.context, meeting.id, meeting.version);
      setNotice("会议已结束；后续到达的字幕事件会被拒绝，可生成冻结版本材料。");
      await props.onMeetingChanged();
    } catch (error) {
      setNotice(errorLabel(error));
    } finally { setBusy(null); }
  }

  async function generate() {
    if (busy) return;
    setBusy("generate"); setNotice(null);
    const idempotencyKey = generationKey ?? crypto.randomUUID();
    setGenerationKey(idempotencyKey);
    try {
      const response = await props.api.generateMeetingMaterial(
        props.context, meeting.id, meeting.version, idempotencyKey,
      );
      setLoad({ status: "ready", material: response.material });
      setSpeakerDrafts(labels(response.material));
      setNotice(reviewNotice(response.material));
      setGenerationKey(null);
      await props.onMeetingChanged();
    } catch (error) {
      if (apiErrorState(error) === "conflict") setGenerationKey(null);
      setNotice(errorLabel(error));
    } finally { setBusy(null); }
  }

  async function publish(material: EnterpriseMeetingMaterialDto) {
    if (busy) return;
    setBusy("publish"); setNotice(null);
    try {
      const response = await props.api.publishMeetingMaterial(
        props.context, meeting.id, material.run.id, material.run.version,
      );
      setLoad({ status: "ready", material: response.material });
      setNotice("会后材料已按当前复核版本发布，并记录审计事件。");
      await props.onMeetingChanged();
    } catch (error) { setNotice(errorLabel(error)); }
    finally { setBusy(null); }
  }

  async function updateSpeaker(
    material: EnterpriseMeetingMaterialDto,
    participantId: string,
  ) {
    const displayName = speakerDrafts[participantId]?.trim();
    if (!displayName || busy) return;
    setBusy(`speaker:${participantId}`); setNotice(null);
    try {
      const response = await props.api.updateMeetingMaterialSpeaker(
        props.context, meeting.id, material.run.id, participantId,
        displayName, material.run.version,
      );
      setLoad({ status: "ready", material: response.material });
      setSpeakerDrafts(labels(response.material));
      setNotice("说话人名称仅修正了本次会议材料，未写入全局成员资料。");
    } catch (error) { setNotice(errorLabel(error)); }
    finally { setBusy(null); }
  }

  async function updateAction(
    material: EnterpriseMeetingMaterialDto,
    actionId: string,
    status: "open" | "completed" | "cancelled",
    version: number,
  ) {
    if (busy) return;
    setBusy(`action:${actionId}`); setNotice(null);
    try {
      const response = await props.api.updateMeetingMaterialAction(
        props.context, meeting.id, material.run.id, actionId, status, version,
      );
      setLoad({ status: "ready", material: response.material });
      setNotice("待办状态已更新；负责人和截止时间仍以有证据的服务端字段为准。");
    } catch (error) { setNotice(errorLabel(error)); }
    finally { setBusy(null); }
  }

  const material = load.status === "ready" ? load.material : null;
  const speakers = useMemo(() => uniqueSpeakers(material), [material]);
  return <section className="meeting-materials" aria-label={`${meeting.title} 会后材料`}>
    <div className="meeting-materials__entry">
      {props.canWrite && meeting.status === "active" ?
        <button className="button button--secondary" type="button"
          disabled={busy !== null || props.connected} onClick={() => void endMeeting()}>
          <MaterialIcon name={enterpriseIcons.meeting.end} />
          {props.connected ? "请先离开再结束" : busy === "end" ? "结束中" : "结束会议"}
        </button> : null}
      {meeting.status === "ended" ?
        <button className="button button--secondary" type="button"
          disabled={busy !== null} onClick={() => void open()}>
          <MaterialIcon name={enterpriseIcons.meeting.materials} />
          {load.status === "closed" ? "会后材料" : "收起材料"}
        </button> : null}
    </div>
    {notice ? <p className="meeting-materials__notice" role="status">{notice}</p> : null}
    {load.status === "loading" ?
      <StatusPanel state="loading" description="正在读取服务端会后材料。" /> : null}
    {load.status === "failed" ?
      <StatusPanel state={apiErrorState(load.error)}
        description="会后材料未就绪，未使用本地字幕或示例纪要回退。"
        action={<button className="button button--secondary" onClick={() => void reload()}>
          重新读取
        </button>} /> : null}
    {load.status === "ready" && !material ?
      <StatusPanel state="empty" description="尚未生成冻结版本的逐字稿与复核材料。"
        action={props.canWrite ? <button className="button button--primary"
          disabled={busy !== null} onClick={() => void generate()}>
          <MaterialIcon name={enterpriseIcons.action.review} />
          {busy === "generate" ? "生成中" : "生成会后材料"}
        </button> : undefined} /> : null}
    {material ? <div className="meeting-materials__body">
      <MaterialHeader material={material} canWrite={props.canWrite} busy={busy}
        generate={generate} publish={publish} />
      {props.canWrite && speakers.length > 0 ? <section className="meeting-speakers">
        <h3><MaterialIcon name={enterpriseIcons.action.edit} />说话人修正</h3>
        <div className="meeting-speakers__grid">{speakers.map((speaker) =>
          <label key={speaker.participantId}>{speaker.label}
            <span><input maxLength={120}
              value={speakerDrafts[speaker.participantId] ?? speaker.label}
              onChange={(event) => setSpeakerDrafts((current) => ({
                ...current, [speaker.participantId]: event.target.value,
              }))} />
              <button className="button button--secondary" type="button"
                disabled={busy !== null ||
                  speakerDrafts[speaker.participantId]?.trim() === speaker.label}
                onClick={() => void updateSpeaker(material, speaker.participantId)}>
                保存
              </button></span>
          </label>)}</div>
      </section> : null}
      <MaterialConclusions material={material} />
      <MaterialActions material={material} canWrite={props.canWrite} busy={busy}
        update={updateAction} />
      <MaterialTranscript material={material} />
    </div> : null}
  </section>;
}

function MaterialHeader(props: {
  material: EnterpriseMeetingMaterialDto; canWrite: boolean; busy: string | null;
  generate(): Promise<void>; publish(value: EnterpriseMeetingMaterialDto): Promise<void>;
}) {
  const run = props.material.run;
  return <header className="meeting-materials__header">
    <div><MaterialIcon name={enterpriseIcons.meeting.materials} outlined />
      <span><strong>材料修订 {run.revision}</strong>
        <small>{run.sourceEventCount} 个规范化片段 · {run.status === "published" ? "已发布" : "待复核"}</small>
      </span></div>
    <span className={`meeting-materials__review state--${run.reviewStatus}`}>
      {reviewLabel(run.reviewStatus)}
    </span>
    {props.canWrite && run.status === "draft" ? <div className="meeting-materials__actions">
      <button className="button button--secondary" disabled={props.busy !== null}
        onClick={() => void props.generate()}>
        <MaterialIcon name={enterpriseIcons.action.refresh} />重新生成修订
      </button>
      <button className="button button--primary"
        disabled={props.busy !== null || run.reviewStatus !== "ready"}
        onClick={() => void props.publish(props.material)}>
        <MaterialIcon name={enterpriseIcons.action.publish} />发布
      </button>
    </div> : null}
    {run.reviewStatus !== "ready" ? <p>
      {run.reviewStatus === "not_configured"
        ? "AI 复核 Provider 未配置；仅展示服务端冻结逐字稿，不生成摘要或待办。"
        : run.reviewStatus === "processing" ? "复核仍在处理，可稍后重新读取。"
          : "AI 复核失败；未把降级内容标记为成功。"}
    </p> : null}
    {run.retentionUntil ? <small>保存至 {formatTime(run.retentionUntil)}</small> : null}
  </header>;
}

function MaterialConclusions({ material }: { material: EnterpriseMeetingMaterialDto }) {
  if (material.conclusions.length === 0) return null;
  return <section className="meeting-material-conclusions">
    <h3><MaterialIcon name={enterpriseIcons.meeting.summary} />复核结论</h3>
    <div>{material.conclusions.map((item) => <article key={item.id}>
      <span>{conclusionLabel(item.kind)}</span><p>{item.text}</p>
      <Evidence ids={item.evidenceSegmentIds} material={material} />
    </article>)}</div>
  </section>;
}

function MaterialActions(props: {
  material: EnterpriseMeetingMaterialDto; canWrite: boolean; busy: string | null;
  update(material: EnterpriseMeetingMaterialDto, actionId: string,
    status: "open" | "completed" | "cancelled", version: number): Promise<void>;
}) {
  if (props.material.actionItems.length === 0) return null;
  return <section className="meeting-material-actions">
    <h3><MaterialIcon name={enterpriseIcons.meeting.action} />待办</h3>
    {props.material.actionItems.map((item) => <article key={item.id}>
      <div><strong>{item.text}</strong><span>{actionLabel(item.status)}</span></div>
      <p>{item.ownerParticipantId ? `负责人已关联 · ` : "未从证据确认负责人 · "}
        {item.dueAt ? `截止 ${formatTime(item.dueAt)}` : "未从证据确认截止时间"}
        {item.priority ? ` · ${priorityLabel(item.priority)}` : " · 优先级未确认"}</p>
      <Evidence ids={item.evidenceSegmentIds} material={props.material} />
      {props.canWrite && item.status === "open" ? <button className="button button--secondary"
        disabled={props.busy !== null} onClick={() => void props.update(
          props.material, item.id, "completed", item.version,
        )}>标记完成</button> : null}
    </article>)}
  </section>;
}

function MaterialTranscript({ material }: { material: EnterpriseMeetingMaterialDto }) {
  return <section className="meeting-transcript">
    <h3><MaterialIcon name={enterpriseIcons.meeting.transcript} />双语逐字稿</h3>
    {material.segments.map((segment) => <article id={`material-segment-${segment.id}`}
      key={segment.id}>
      <header><strong>{segment.speakerLabel}</strong>
        <span>#{segment.ordinal + 1} · {formatTime(segment.occurredAt)}</span></header>
      <p lang={segment.sourceLanguage}>{segment.sourceText}</p>
      {segment.translations.map((translation) =>
        <p className="meeting-transcript__translation" lang={translation.language}
          key={translation.language}>{translation.text}</p>)}
    </article>)}
  </section>;
}

function Evidence(props: { ids: string[]; material: EnterpriseMeetingMaterialDto }) {
  const ordinals = new Map(props.material.segments.map((segment) =>
    [segment.id, segment.ordinal + 1]));
  return <div className="meeting-material-evidence">
    <MaterialIcon name={enterpriseIcons.meeting.evidence} />
    {props.ids.map((id) => <a href={`#material-segment-${id}`} key={id}>
      片段 {ordinals.get(id) ?? "?"}
    </a>)}
  </div>;
}

function uniqueSpeakers(material: EnterpriseMeetingMaterialDto | null) {
  const values = new Map<string, string>();
  for (const segment of material?.segments ?? []) {
    values.set(segment.sourceParticipantId, segment.speakerLabel);
  }
  return [...values].map(([participantId, label]) => ({ participantId, label }));
}
function labels(material: EnterpriseMeetingMaterialDto | null) {
  return Object.fromEntries(uniqueSpeakers(material).map((value) =>
    [value.participantId, value.label]));
}
function reviewNotice(material: EnterpriseMeetingMaterialDto | null) {
  if (!material) return "材料未生成。";
  return material.run.reviewStatus === "ready"
    ? "逐字稿与待复核结论已生成；发布前请检查每条 segment 引用。"
    : "逐字稿已冻结；AI 复核未就绪，未伪造摘要或待办。";
}
function reviewLabel(value: string) {
  return ({ processing: "复核中", not_configured: "未配置复核",
    ready: "待人工发布", failed: "复核失败" })[value] ?? value;
}
function conclusionLabel(value: string) {
  return ({ summary: "摘要", topic: "议题", decision: "决策", objection: "异议",
    risk: "风险", unresolved: "未解决" })[value] ?? value;
}
function actionLabel(value: string) {
  return ({ open: "待处理", completed: "已完成", cancelled: "已取消" })[value] ?? value;
}
function priorityLabel(value: string) {
  return ({ low: "低优先级", medium: "中优先级", high: "高优先级" })[value] ?? value;
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(value));
}
function errorLabel(error: unknown) {
  const state = apiErrorState(error);
  if (state === "forbidden") return "当前身份无权管理会后材料。";
  if (state === "conflict") return "会议或材料版本已变化，请刷新后重试。";
  if (state === "not_ready") return "企业材料服务或 Provider 尚未就绪。";
  return "会后材料请求失败；未使用示例数据回退。";
}
