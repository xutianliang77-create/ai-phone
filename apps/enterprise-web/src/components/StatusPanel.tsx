import { MaterialIcon } from "./MaterialIcon.js";

export type PageState =
  | "loading"
  | "empty"
  | "not_ready"
  | "degraded"
  | "forbidden"
  | "conflict"
  | "processing"
  | "failed";

const statePresentation: Record<PageState, { icon: string; title: string }> = {
  loading: { icon: "autorenew", title: "正在加载" },
  empty: { icon: "inbox", title: "暂无数据" },
  not_ready: { icon: "construction", title: "尚未就绪" },
  degraded: { icon: "warning", title: "服务已降级" },
  forbidden: { icon: "lock", title: "无权访问" },
  conflict: { icon: "sync_problem", title: "版本冲突" },
  processing: { icon: "pending", title: "正在处理" },
  failed: { icon: "error_outline", title: "操作失败" },
};

export function StatusPanel({
  state,
  title = statePresentation[state].title,
  description,
  action,
}: {
  state: PageState;
  title?: string;
  description: string;
  action?: React.ReactNode;
}) {
  const presentation = statePresentation[state];
  return (
    <section className={`status-panel status-panel--${state}`} role="status">
      <MaterialIcon name={presentation.icon} label={title} />
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        {action ? <div className="status-panel__action">{action}</div> : null}
      </div>
    </section>
  );
}
