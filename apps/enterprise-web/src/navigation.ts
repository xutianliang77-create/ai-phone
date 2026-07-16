import type { EnterpriseScope } from "@translation/contracts";
import type { EnterpriseNavigationIcon } from "./icon-registry.js";

export interface EnterpriseNavigationItem {
  path: string;
  label: string;
  description: string;
  icon: EnterpriseNavigationIcon;
  anyScope: readonly EnterpriseScope[];
}

export const enterpriseNavigation: readonly EnterpriseNavigationItem[] = [
  {
    path: "/",
    label: "工作台",
    description: "企业上下文与服务接入状态",
    icon: "dashboard",
    anyScope: ["tenant:read"],
  },
  {
    path: "/campaigns",
    label: "外呼营销",
    description: "活动、线索、授权与任务",
    icon: "campaigns",
    anyScope: ["campaign:read"],
  },
  {
    path: "/support",
    label: "AI 客服",
    description: "队列、会话与人工接管",
    icon: "support",
    anyScope: ["support:read"],
  },
  {
    path: "/meetings",
    label: "企业会议",
    description: "会议、字幕、共享与材料",
    icon: "meetings",
    anyScope: ["meeting:read"],
  },
  {
    path: "/contacts",
    label: "客户与线索",
    description: "客户、线索、授权与禁拨",
    icon: "contacts",
    anyScope: ["campaign:read", "support:read"],
  },
  {
    path: "/knowledge",
    label: "知识与术语",
    description: "知识版本、发布与术语包",
    icon: "knowledge",
    anyScope: ["knowledge:read"],
  },
  {
    path: "/analytics",
    label: "数据分析",
    description: "质量、成本与业务分析",
    icon: "analytics",
    anyScope: ["campaign:read", "support:read", "meeting:read"],
  },
  {
    path: "/audit",
    label: "合规与审计",
    description: "策略、授权、操作与导出",
    icon: "audit",
    anyScope: ["audit:read"],
  },
  {
    path: "/settings",
    label: "企业设置",
    description: "成员、权益、区域与 Provider",
    icon: "settings",
    anyScope: ["member:read", "tenant:write"],
  },
] as const;

export function canAccessNavigation(
  scopes: readonly EnterpriseScope[],
  item: EnterpriseNavigationItem,
) {
  return item.anyScope.some((scope) => scopes.includes(scope));
}

export function discoverEnterpriseNavigation(scopes: readonly EnterpriseScope[]) {
  return enterpriseNavigation.filter((item) => canAccessNavigation(scopes, item));
}

export function routeAllowed(scopes: readonly EnterpriseScope[], path: string) {
  const normalized = path === "/" ? "/" : `/${path.split("/").filter(Boolean)[0] ?? ""}`;
  const item = enterpriseNavigation.find((candidate) => candidate.path === normalized);
  return item ? canAccessNavigation(scopes, item) : false;
}
