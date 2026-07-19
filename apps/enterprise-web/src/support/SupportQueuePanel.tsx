import type {
  EnterpriseSupportQueueDto,
  EnterpriseSupportWorkItemDto,
} from "../api/enterprise-support-api.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { enterpriseIcons } from "../icon-registry.js";

export function SupportQueuePanel({
  queues,
  selectedQueueId,
  workItems,
  loading,
  busy,
  onQueue,
  onClaim,
  onRefresh,
}: {
  queues: EnterpriseSupportQueueDto[];
  selectedQueueId: string;
  workItems: EnterpriseSupportWorkItemDto[];
  loading: boolean;
  busy: string | null;
  onQueue(queueId: string): void;
  onClaim(item: EnterpriseSupportWorkItemDto): void;
  onRefresh(): void;
}) {
  return <aside className="support-queue" aria-labelledby="support-queue-title">
    <header className="support-panel-header">
      <div><MaterialIcon name={enterpriseIcons.support.queue} /><span>
        <h2 id="support-queue-title">等待队列</h2>
        <p>服务端优先级与 SLA</p>
      </span></div>
      <button className="icon-button" type="button" aria-label="刷新等待队列"
        disabled={loading} onClick={onRefresh}>
        <MaterialIcon name={enterpriseIcons.action.refresh} />
      </button>
    </header>
    <label className="support-queue__selector">服务队列
      <select value={selectedQueueId} onChange={(event) => onQueue(event.target.value)}>
        {queues.map((queue) => <option key={queue.id} value={queue.id}>
          {queue.name} · {queue.status}
        </option>)}
      </select>
    </label>
    {loading ? <StatusPanel state="loading" description="正在读取等待会话。" /> : null}
    {!loading && queues.length === 0 ? <StatusPanel state="empty"
      description="当前租户没有可读取的客服队列。" /> : null}
    {!loading && queues.length > 0 && workItems.length === 0 ? <StatusPanel
      state="empty" description="当前队列没有待接管或租约已失效的会话。" /> : null}
    <div className="support-work-items">
      {workItems.map((item) => <article className={item.slaBreached
        ? "support-work-item support-work-item--breached" : "support-work-item"}
        key={item.sessionId}>
        <header><strong>{item.intent || "待确认诉求"}</strong>
          <span className={item.slaBreached ? "state-chip state-chip--danger" : "state-chip"}>
            {item.slaBreached ? "SLA 超时" : "等待中"}
          </span></header>
        <dl><div><dt>优先级</dt><dd>{item.priority}</dd></div>
          <div><dt>等待</dt><dd>{duration(item.waitSeconds)}</dd></div></dl>
        <small>{item.status === "claim_expired" ? "原坐席租约已失效" :
          `SLA 截止 ${time(item.slaDeadlineAt)}`}</small>
        <button className="button button--primary" type="button"
          disabled={busy !== null} onClick={() => onClaim(item)}>
          <MaterialIcon name={enterpriseIcons.action.takeover} />
          {busy === `claim:${item.sessionId}` ? "正在接管" : "接管会话"}
        </button>
      </article>)}
    </div>
  </aside>;
}

function duration(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} 分钟` :
    `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}
function time(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(value));
}
