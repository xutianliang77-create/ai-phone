import { useCallback, useEffect, useMemo, useState } from "react";
import {
  enterpriseMemberRoles,
  enterpriseRoleScopes,
  type EnterpriseMemberDto,
  type EnterpriseScope,
} from "@translation/contracts";
import type {
  EnterpriseApi,
  EnterpriseContentRequestContext,
} from "../api/enterprise-api.js";
import { EnterpriseApiError } from "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { useAuth } from "../auth/AuthContext.js";
import {
  MemberCreateForm,
  MemberEditForm,
} from "../components/EnterpriseMemberForms.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import {
  formatMemberTime,
  memberRolePresentation,
  memberStatusPresentation,
  scopeLabels,
} from "../enterprise-members.js";
import { enterpriseIcons } from "../icon-registry.js";

type LoadState = "loading" | "ready" | "failed";

export function MemberSettingsPage() {
  const { state, api } = useAuth();
  if (state.status !== "ready") return null;
  return (
    <MemberSettingsWorkspace
      api={api}
      token={state.session.token}
      tenantId={state.context.tenant.id}
      routeDocument={state.routeDocument}
      scopes={state.context.scopes}
      currentUserId={state.session.account.id}
    />
  );
}

function MemberSettingsWorkspace({
  api, token, tenantId, routeDocument, scopes, currentUserId,
}: {
  api: EnterpriseApi;
  token: string;
  tenantId: string;
  routeDocument: EnterpriseContentRequestContext["routeDocument"];
  scopes: readonly EnterpriseScope[];
  currentUserId: string;
}) {
  const requestContext = useMemo(
    () => ({ token, tenantId, routeDocument }),
    [routeDocument, tenantId, token],
  );
  const canWrite = scopes.includes("member:write");
  const [members, setMembers] = useState<EnterpriseMemberDto[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<unknown>();
  const [mutationError, setMutationError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<"create" | "edit">();
  const [editing, setEditing] = useState<EnterpriseMemberDto>();

  const loadMembers = useCallback(async () => {
    setLoadState("loading");
    setLoadError(undefined);
    try {
      const result = await api.listMembers(requestContext);
      setMembers(result.members);
      setLoadState("ready");
    } catch (error) {
      setLoadError(error);
      setLoadState("failed");
    }
  }, [api, requestContext]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  const run = async (operation: () => Promise<string>) => {
    setBusy(true);
    setMutationError(undefined);
    setNotice(undefined);
    try {
      setNotice(await operation());
      setForm(undefined);
      setEditing(undefined);
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  };

  const createMember = (input: Parameters<EnterpriseApi["createMember"]>[1]) => run(async () => {
    const { member } = await api.createMember(requestContext, input);
    setMembers((current) => [member, ...current]);
    return `已添加账号 ${member.userId}，当前角色为${memberRolePresentation[member.role].label}。`;
  });

  const updateMember = (input: Parameters<EnterpriseApi["updateMember"]>[2]) => {
    if (!editing) return;
    void run(async () => {
      const { member } = await api.updateMember(requestContext, editing.id, input);
      setMembers((current) => current.map((item) => item.id === member.id ? member : item));
      return `已保存账号 ${member.userId} 的角色与状态。`;
    });
  };

  const openCreate = () => {
    setEditing(undefined);
    setForm("create");
    setMutationError(undefined);
    setNotice(undefined);
  };

  const openEdit = (member: EnterpriseMemberDto) => {
    setEditing(member);
    setForm("edit");
    setMutationError(undefined);
    setNotice(undefined);
  };

  return (
    <PageFrame
      title="成员与角色"
      description="成员关系、角色 scope 和状态变更均以服务端租户上下文为准"
      action={canWrite ? (
        <button className="button button--primary" disabled={busy} onClick={openCreate}>
          <MaterialIcon name={enterpriseIcons.action.create} />添加成员
        </button>
      ) : undefined}
    >
      {!canWrite && loadState === "ready" ? (
        <div className="member-notice" role="status">
          <MaterialIcon name={enterpriseIcons.status.forbidden} />
          当前角色只有 member:read，可查看成员和角色 scope，不能执行新增或编辑。
        </div>
      ) : null}
      {form === "create" ? (
        <MemberCreateForm
          busy={busy}
          onCancel={() => setForm(undefined)}
          onSubmit={(input) => void createMember(input)}
        />
      ) : null}
      {form === "edit" && editing ? (
        <MemberEditForm
          key={`${editing.id}:${editing.version}`}
          member={editing}
          busy={busy}
          onCancel={() => { setForm(undefined); setEditing(undefined); }}
          onSubmit={updateMember}
        />
      ) : null}
      {mutationError ? <MemberError error={mutationError} mutation /> : null}
      {notice ? <div className="member-notice member-notice--success" role="status">
        <MaterialIcon name="check_circle" />{notice}
      </div> : null}
      {loadState === "loading" ? (
        <StatusPanel state="loading" description="正在读取当前租户的成员关系。" />
      ) : null}
      {loadState === "failed" ? (
        <MemberError
          error={loadError}
          action={<button className="button button--secondary" onClick={() => void loadMembers()}>重试</button>}
        />
      ) : null}
      {loadState === "ready" ? (
        <>
          <MemberDirectory
            members={members}
            canWrite={canWrite}
            currentUserId={currentUserId}
            busy={busy}
            onEdit={openEdit}
          />
          <RoleScopeMatrix />
        </>
      ) : null}
    </PageFrame>
  );
}

function MemberDirectory({
  members, canWrite, currentUserId, busy, onEdit,
}: {
  members: EnterpriseMemberDto[];
  canWrite: boolean;
  currentUserId: string;
  busy: boolean;
  onEdit(member: EnterpriseMemberDto): void;
}) {
  if (members.length === 0) {
    return <StatusPanel state="empty" description="服务端未返回当前租户的成员记录。" />;
  }
  return (
    <section className="member-section" aria-labelledby="member-directory-title">
      <header><div><h2 id="member-directory-title">成员目录</h2><p>{members.length} 个服务端成员关系</p></div></header>
      <div className="member-table-wrap">
        <table className="member-table">
          <thead><tr><th>账号</th><th>角色</th><th>状态</th><th>加入时间</th><th>操作</th></tr></thead>
          <tbody>{members.map((member) => {
            const current = member.userId === currentUserId;
            const protectedMember = member.role === "owner" || current;
            const status = memberStatusPresentation[member.status];
            return (
              <tr key={member.id}>
                <td><strong>{member.userId}</strong>{current ? <small>当前账号</small> : null}</td>
                <td>{memberRolePresentation[member.role].label}<small>{member.role}</small></td>
                <td><span className={`member-status member-status--${status.tone}`}>{status.label}</span></td>
                <td>{formatMemberTime(member.joinedAt ?? member.createdAt)}<small>版本 {member.version}</small></td>
                <td>{canWrite && !protectedMember ? (
                  <button className="text-button" disabled={busy} onClick={() => onEdit(member)}>
                    <MaterialIcon name={enterpriseIcons.action.edit} />编辑 {member.userId}
                  </button>
                ) : <small>{member.role === "owner" ? "所有者受保护" : "当前账号不可自改"}</small>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

function RoleScopeMatrix() {
  return (
    <section className="member-section" aria-labelledby="role-scope-title">
      <header><div><h2 id="role-scope-title">角色与 scope</h2><p>直接读取共享契约，与服务端 RBAC 使用同一份映射。</p></div></header>
      <div className="role-grid">
        {enterpriseMemberRoles.map((role) => (
          <article className="role-card" key={role}>
            <header><MaterialIcon name={enterpriseIcons.member.role} /><div>
              <h3>{memberRolePresentation[role].label}</h3><code>{role}</code>
            </div></header>
            <p>{memberRolePresentation[role].description}</p>
            <div className="scope-list" aria-label={`${memberRolePresentation[role].label} scopes`}>
              {enterpriseRoleScopes[role].map((scope) => (
                <span key={scope} title={scope}>{scopeLabels[scope]}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MemberError({
  error, mutation = false, action,
}: {
  error: unknown;
  mutation?: boolean;
  action?: React.ReactNode;
}) {
  const state = apiErrorState(error);
  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  const descriptions: Record<string, string> = {
    account_not_found: "账号不存在或已停用，服务端没有创建成员关系。",
    member_already_exists: "该账号已属于当前企业，未重复创建成员关系。",
    owner_member_protected: "企业所有者成员受服务端保护，不能修改角色或状态。",
    member_version_conflict: "成员记录在保存期间发生变化，请刷新后再试。",
  };
  const titles: Record<string, string> = {
    account_not_found: "账号不存在",
    member_already_exists: "成员已存在",
    owner_member_protected: "所有者受保护",
  };
  const description = apiError && descriptions[apiError.code]
    ? descriptions[apiError.code]
    : state === "not_ready"
    ? "企业成员仓储尚未就绪，未回退到 SQLite/JSON 数据。"
    : state === "forbidden"
    ? `服务端拒绝了 member:${mutation ? "write" : "read"}，未执行越权操作。`
    : mutation ? "成员变更未保存，请核对服务端错误后重试。" : "成员目录读取失败。";
  return (
    <StatusPanel
      state={state}
      title={apiError ? titles[apiError.code] : undefined}
      description={description}
      traceId={apiError?.traceId}
      action={action}
    />
  );
}
