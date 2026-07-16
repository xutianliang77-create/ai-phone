import { enterpriseIcons } from "./icon-registry.js";

export const pageStates = [
  "loading",
  "empty",
  "not_ready",
  "degraded",
  "forbidden",
  "conflict",
  "processing",
  "failed",
] as const;

export type PageState = typeof pageStates[number];

export const pageStateRegistry = {
  loading: {
    icon: enterpriseIcons.status.loading,
    title: "正在加载",
    role: "status",
    live: "polite",
  },
  empty: {
    icon: enterpriseIcons.status.empty,
    title: "暂无数据",
    role: "status",
    live: "polite",
  },
  not_ready: {
    icon: enterpriseIcons.status.not_ready,
    title: "尚未就绪",
    role: "status",
    live: "polite",
  },
  degraded: {
    icon: enterpriseIcons.status.degraded,
    title: "服务已降级",
    role: "status",
    live: "polite",
  },
  forbidden: {
    icon: enterpriseIcons.status.forbidden,
    title: "无权访问",
    role: "alert",
    live: "assertive",
  },
  conflict: {
    icon: enterpriseIcons.status.conflict,
    title: "版本冲突",
    role: "alert",
    live: "assertive",
  },
  processing: {
    icon: enterpriseIcons.status.processing,
    title: "正在处理",
    role: "status",
    live: "polite",
  },
  failed: {
    icon: enterpriseIcons.status.failed,
    title: "操作失败",
    role: "alert",
    live: "assertive",
  },
} as const satisfies Record<
  PageState,
  { icon: string; title: string; role: "status" | "alert"; live: "polite" | "assertive" }
>;
