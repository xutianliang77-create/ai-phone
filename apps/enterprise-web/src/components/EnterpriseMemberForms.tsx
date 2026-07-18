import { useState, type FormEvent } from "react";
import type {
  EnterpriseMemberDto,
  EnterpriseMemberRole,
  EnterpriseMemberStatus,
} from "@translation/contracts";
import {
  assignableMemberRoles,
  memberRolePresentation,
  memberStatusPresentation,
} from "../enterprise-members.js";

const editableMemberStatuses = ["active", "suspended"] as const;

export function MemberCreateForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel(): void;
  onSubmit(input: { userId: string; role: EnterpriseMemberRole }): void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<EnterpriseMemberRole>("member");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = userId.trim();
    if (normalized) onSubmit({ userId: normalized, role });
  };

  return (
    <form className="member-form" onSubmit={submit}>
      <header>
        <div><h2>添加成员</h2><p>将已注册且状态正常的账号加入当前企业。</p></div>
      </header>
      <div className="member-form__grid">
        <label>
          <span>账号 ID</span>
          <input
            autoFocus
            maxLength={120}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="输入已注册账号的 userId"
            disabled={busy}
            required
          />
        </label>
        <RoleSelect value={role} disabled={busy} onChange={setRole} />
      </div>
      <p className="member-form__truth">
        当前服务端接口不会发送短信、邮件或外部 Provider 邀请；账号不存在时不会创建成员。
      </p>
      <div className="member-form__actions">
        <button className="button button--secondary" type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button className="button button--primary" type="submit" disabled={busy || !userId.trim()}>
          {busy ? "正在添加" : "确认添加"}
        </button>
      </div>
    </form>
  );
}

export function MemberEditForm({
  member,
  busy,
  onCancel,
  onSubmit,
}: {
  member: EnterpriseMemberDto;
  busy: boolean;
  onCancel(): void;
  onSubmit(input: { role: EnterpriseMemberRole; status: EnterpriseMemberStatus }): void;
}) {
  const [role, setRole] = useState<EnterpriseMemberRole>(member.role);
  const [status, setStatus] = useState<EnterpriseMemberStatus>(member.status);
  const unchanged = role === member.role && status === member.status;

  return (
    <form
      className="member-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!unchanged) onSubmit({ role, status });
      }}
    >
      <header>
        <div><h2>编辑成员</h2><p><code>{member.userId}</code></p></div>
      </header>
      <div className="member-form__grid">
        <RoleSelect value={role} disabled={busy} onChange={setRole} />
        <label>
          <span>成员状态</span>
          <select
            aria-label="成员状态"
            value={status}
            disabled={busy}
            onChange={(event) => setStatus(event.target.value as EnterpriseMemberStatus)}
          >
            {member.status === "invited" ? (
              <option value="invited" disabled>{memberStatusPresentation.invited.label}</option>
            ) : null}
            {editableMemberStatuses.map((value) => (
              <option key={value} value={value}>{memberStatusPresentation[value].label}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="member-form__truth">
        保存后，以服务端返回的角色、状态和成员版本为准；停用成员将无法解析企业上下文。
      </p>
      <div className="member-form__actions">
        <button className="button button--secondary" type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button className="button button--primary" type="submit" disabled={busy || unchanged}>
          {busy ? "正在保存" : "保存变更"}
        </button>
      </div>
    </form>
  );
}

function RoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: EnterpriseMemberRole;
  disabled: boolean;
  onChange(role: EnterpriseMemberRole): void;
}) {
  return (
    <label>
      <span>成员角色</span>
      <select
        aria-label="成员角色"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as EnterpriseMemberRole)}
      >
        {assignableMemberRoles.map((role) => (
          <option key={role} value={role}>{memberRolePresentation[role].label}</option>
        ))}
      </select>
    </label>
  );
}
