import {
  enterpriseMemberRoles,
  type EnterpriseMemberRole,
  type EnterpriseMemberStatus,
  type EnterpriseScope,
} from "@translation/contracts";

export const assignableMemberRoles = enterpriseMemberRoles.filter(
  (role): role is Exclude<EnterpriseMemberRole, "owner"> => role !== "owner",
);

export const memberRolePresentation: Record<
  EnterpriseMemberRole,
  { label: string; description: string }
> = {
  owner: { label: "企业所有者", description: "企业最高权限；所有者成员受服务端保护。" },
  admin: { label: "企业管理员", description: "管理企业配置、成员、业务与审计。" },
  marketing_manager: { label: "营销主管", description: "管理外呼活动、内容发布与审批。" },
  marketing_member: { label: "营销成员", description: "执行外呼活动，不能审批或发布知识。" },
  support_manager: { label: "客服主管", description: "管理客服队列、接管会话与发布知识。" },
  support_agent: { label: "客服坐席", description: "读取并接管授权的客服会话。" },
  meeting_host: { label: "会议主持人", description: "创建会议并停止屏幕共享。" },
  member: { label: "企业成员", description: "读取企业上下文并参与会议。" },
  auditor: { label: "审计员", description: "只读查看业务、账务、用量与审计记录。" },
};

export const memberStatusPresentation: Record<
  EnterpriseMemberStatus,
  { label: string; tone: "pending" | "positive" | "neutral" }
> = {
  invited: { label: "待加入", tone: "pending" },
  active: { label: "正常", tone: "positive" },
  suspended: { label: "已停用", tone: "neutral" },
};

export const scopeLabels: Record<EnterpriseScope, string> = {
  "tenant:read": "读取企业",
  "tenant:write": "管理企业",
  "member:read": "读取成员",
  "member:write": "管理成员",
  "knowledge:read": "读取知识",
  "knowledge:publish": "发布知识",
  "campaign:read": "读取营销",
  "campaign:write": "管理营销",
  "campaign:approve": "审批营销",
  "support:read": "读取客服",
  "support:manage": "管理客服",
  "support:takeover": "接管会话",
  "meeting:read": "读取会议",
  "meeting:write": "管理会议",
  "screen_share:stop": "停止共享",
  "billing:read": "读取账务",
  "billing:write": "管理账务",
  "usage:read": "读取用量",
  "usage:write": "写入用量",
  "audit:read": "读取审计",
  "audit:export": "导出审计",
};

export function formatMemberTime(value?: string) {
  if (!value) return "尚未加入";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}
