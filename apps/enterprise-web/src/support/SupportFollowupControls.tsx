import { useState } from "react";
import type { EnterpriseSupportWorkbenchDto } from
  "../api/enterprise-support-api.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { enterpriseIcons } from "../icon-registry.js";

export function SupportFollowupControls({ workbench, busy, onTicket, onCallback }: {
  workbench: EnterpriseSupportWorkbenchDto;
  busy: string | null;
  onTicket(input: { subject: string; description: string }): Promise<boolean>;
  onCallback(input: { scheduledAt: string; reason: string }): Promise<boolean>;
}) {
  const [action, setAction] = useState<"ticket" | "callback" | null>(null);
  const ticket = workbench.controls.createTicket;
  const callback = workbench.controls.callback;
  return <div className="support-followup-actions">
    <div className="support-followups">
      <ActionButton icon={enterpriseIcons.support.ticket} label="创建工单"
        control={ticket} busy={busy} onClick={() => setAction("ticket")} />
      <ActionButton icon={enterpriseIcons.support.callback} label="安排回拨"
        control={callback} busy={busy} onClick={() => setAction("callback")} />
    </div>
    {ticket?.simulated || callback?.simulated ? <p className="support-followup-warning">
      当前为显式模拟 Adapter；结果只用于协议验证，不代表真实外部工单或回拨。</p> : null}
    {action === "ticket" ? <TicketForm busy={busy !== null}
      onCancel={() => setAction(null)} onSubmit={async (value) => {
        if (await onTicket(value)) setAction(null);
      }} /> : null}
    {action === "callback" ? <CallbackForm busy={busy !== null}
      onCancel={() => setAction(null)} onSubmit={async (value) => {
        if (await onCallback(value)) setAction(null);
      }} /> : null}
  </div>;
}

function ActionButton({ icon, label, control, busy, onClick }: {
  icon: string; label: string;
  control?: EnterpriseSupportWorkbenchDto["controls"][string];
  busy: string | null; onClick(): void;
}) {
  const ready = control?.status === "ready";
  return <button className="support-control" type="button"
    disabled={!ready || busy !== null} onClick={onClick}
    title={ready ? undefined : control?.reasonCode || "Provider 未就绪"}>
    <MaterialIcon name={icon} /><span>{label}</span>
    <small>{ready ? "异步执行" : "未就绪"}</small>
  </button>;
}

function TicketForm({ busy, onCancel, onSubmit }: {
  busy: boolean; onCancel(): void;
  onSubmit(value: { subject: string; description: string }): Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  return <form className="support-followup-form" onSubmit={(event) => {
    event.preventDefault();
    if (subject.trim() && description.trim()) {
      void onSubmit({ subject: subject.trim(), description: description.trim() });
    }
  }}><label>工单主题<input value={subject} maxLength={160} required
      onChange={(event) => setSubject(event.target.value)} /></label>
    <label>问题说明<textarea value={description} maxLength={2_000} required rows={4}
      onChange={(event) => setDescription(event.target.value)} /></label>
    <FormActions busy={busy} onCancel={onCancel} />
  </form>;
}

function CallbackForm({ busy, onCancel, onSubmit }: {
  busy: boolean; onCancel(): void;
  onSubmit(value: { scheduledAt: string; reason: string }): Promise<void>;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [reason, setReason] = useState("");
  const validTime = scheduledAt && Number.isFinite(Date.parse(scheduledAt)) &&
    Date.parse(scheduledAt) > Date.now();
  return <form className="support-followup-form" onSubmit={(event) => {
    event.preventDefault();
    if (validTime && reason.trim()) {
      void onSubmit({ scheduledAt: new Date(scheduledAt).toISOString(),
        reason: reason.trim() });
    }
  }}><label>回拨时间<input type="datetime-local" value={scheduledAt} required
      onChange={(event) => setScheduledAt(event.target.value)} /></label>
    <label>回拨原因<textarea value={reason} maxLength={500} required rows={3}
      onChange={(event) => setReason(event.target.value)} /></label>
    {!scheduledAt || validTime ? null : <small className="support-followup-error">
      回拨时间必须晚于当前时间。</small>}
    <FormActions busy={busy || !validTime} onCancel={onCancel} />
  </form>;
}

function FormActions({ busy, onCancel }: { busy: boolean; onCancel(): void }) {
  return <div className="support-followup-form__actions">
    <button className="button button--secondary" type="button" disabled={busy}
      onClick={onCancel}>取消</button>
    <button className="button button--primary" type="submit" disabled={busy}>
      {busy ? "正在提交" : "提交异步任务"}</button>
  </div>;
}
