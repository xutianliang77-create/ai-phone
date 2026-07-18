import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EnterpriseEntitlementsResponse,
  EnterpriseProviderCapabilityDocument,
  EnterpriseUsageBudgetDto,
  EnterpriseUsagePeriodAggregateDto,
} from "@translation/contracts";
import {
  EnterpriseApiError,
  type EnterpriseContentRequestContext,
} from "../api/enterprise-api.js";
import { useAuth } from "../auth/AuthContext.js";
import { apiErrorState } from "../business-state.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { SessionTracePanel } from "../components/SessionTracePanel.js";
import {
  formatSettingsDate,
  providerCapabilityLabels,
  providerStatusLabels,
  unitLabels,
  usageCategoryPresentation,
} from "../enterprise-settings.js";
import { enterpriseIcons } from "../icon-registry.js";

type Loadable<T> =
  | { state: "idle" | "loading" }
  | { state: "ready"; data: T }
  | { state: "failed"; error: unknown };

export function DashboardPage() {
  const { state, api } = useAuth();
  if (state.status !== "ready") return null;
  const scopes = state.context.scopes;
  const canReadBilling = scopes.includes("billing:read");
  const canReadUsage = scopes.includes("usage:read");
  const requestContext = useMemo<EnterpriseContentRequestContext>(() => ({
    token: state.session.token,
    tenantId: state.context.tenant.id,
    routeDocument: state.routeDocument,
  }), [state.context.tenant.id, state.routeDocument, state.session.token]);
  const [providers, setProviders] = useState<Loadable<EnterpriseProviderCapabilityDocument[]>>(
    state.providerCapabilities
      ? { state: "ready", data: state.providerCapabilities }
      : { state: "idle" },
  );
  const [billing, setBilling] = useState<Loadable<EnterpriseEntitlementsResponse>>(
    canReadBilling ? { state: "loading" } : { state: "idle" },
  );
  const [budgets, setBudgets] = useState<Loadable<EnterpriseUsageBudgetDto[]>>(
    canReadBilling ? { state: "loading" } : { state: "idle" },
  );
  const [usage, setUsage] = useState<Loadable<EnterpriseUsagePeriodAggregateDto[]>>(
    canReadUsage ? { state: "loading" } : { state: "idle" },
  );
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setProviders({ state: "loading" });
    if (canReadBilling) {
      setBilling({ state: "loading" });
      setBudgets({ state: "loading" });
    }
    if (canReadUsage) setUsage({ state: "loading" });
    const requests: Promise<void>[] = [
      api.getProviderCapabilities(state.session.token, state.context.tenant.id)
        .then((result) => setProviders({ state: "ready", data: result.capabilities }))
        .catch((error: unknown) => setProviders({ state: "failed", error })),
    ];
    if (canReadBilling) {
      requests.push(
        api.getBillingEntitlements(requestContext)
          .then((data) => setBilling({ state: "ready", data }))
          .catch((error: unknown) => setBilling({ state: "failed", error })),
        api.listUsageBudgets(requestContext)
          .then((result) => setBudgets({ state: "ready", data: result.budgets }))
          .catch((error: unknown) => setBudgets({ state: "failed", error })),
      );
    }
    if (canReadUsage) {
      requests.push(api.listUsageAggregates(requestContext)
        .then((result) => setUsage({ state: "ready", data: result.aggregates }))
        .catch((error: unknown) => setUsage({ state: "failed", error })));
    }
    await Promise.all(requests);
    setRefreshing(false);
  }, [api, canReadBilling, canReadUsage, requestContext, state.context.tenant.id,
    state.session.token]);

  useEffect(() => { void reload(); }, [reload]);

  const alerts = budgetAlerts(budgets, usage);
  return (
    <PageFrame
      title="工作台"
      description="租户、Provider、权益、预算、用量与链路质量的服务端真值"
      action={<button className="button button--secondary" disabled={refreshing} onClick={() => void reload()}>
        <MaterialIcon name={enterpriseIcons.action.refresh} />刷新
      </button>}
    >
      <MetricGrid
        tenantStatus={state.context.tenant.status}
        region={`${state.context.tenant.homeRegion} · ${state.routeDocument.cellId}`}
        providers={providers}
        billing={billing}
        alerts={alerts}
        budgetState={budgets.state}
        usageState={usage.state}
        canReadBilling={canReadBilling}
        canReadUsage={canReadUsage}
      />
      <ActionSection
        tenantStatus={state.context.tenant.status}
        providers={providers}
        billing={billing}
        budgets={budgets}
        usage={usage}
        alerts={alerts}
      />
      <UsageSection resource={usage} readable={canReadUsage} />
      <SessionTracePanel />
      <section className="dashboard-section" aria-labelledby="business-status-title">
        <SectionHeader icon={enterpriseIcons.dashboard.business} id="business-status-title"
          title="业务状态" description="营销、客服和会议汇总必须来自对应服务端聚合。" />
        <StatusPanel state="not_ready" title="业务汇总接口尚未交付"
          description="当前不显示活动数、客服队列、会议趋势或示例数据；对应领域 API 完成后再接入。" />
      </section>
    </PageFrame>
  );
}

function MetricGrid(props: {
  tenantStatus: string;
  region: string;
  providers: Loadable<EnterpriseProviderCapabilityDocument[]>;
  billing: Loadable<EnterpriseEntitlementsResponse>;
  alerts: BudgetAlert[];
  budgetState: Loadable<unknown>["state"];
  usageState: Loadable<unknown>["state"];
  canReadBilling: boolean;
  canReadUsage: boolean;
}) {
  const providerValue = props.providers.state === "ready"
    ? `${props.providers.data.filter((item) => item.status === "ready").length}/${props.providers.data.length}`
    : loadableLabel(props.providers.state);
  const planValue = !props.canReadBilling ? "无读取权限"
    : props.billing.state === "ready" ? props.billing.data.subscription.planCode
    : loadableLabel(props.billing.state);
  const alertValue = !props.canReadBilling || !props.canReadUsage ? "权限不完整"
    : props.budgetState === "ready" && props.usageState === "ready"
    ? String(props.alerts.length) : "暂不可判定";
  const cards = [
    { icon: enterpriseIcons.dashboard.tenant, label: "租户状态", value: props.tenantStatus, note: props.region },
    { icon: enterpriseIcons.dashboard.provider, label: "Provider 就绪", value: providerValue, note: "ready / capability 总数" },
    { icon: enterpriseIcons.dashboard.plan, label: "当前套餐", value: planValue, note: "服务端 subscription" },
    { icon: enterpriseIcons.dashboard.alert, label: "预算告警", value: alertValue, note: "按类别与同账期逐项计算" },
  ];
  return <section className="dashboard-metrics" aria-label="企业运行摘要">{cards.map((card) =>
    <article className="dashboard-metric" key={card.label}><MaterialIcon name={card.icon} />
      <div><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></div>
    </article>)}</section>;
}

function ActionSection(props: {
  tenantStatus: string;
  providers: Loadable<EnterpriseProviderCapabilityDocument[]>;
  billing: Loadable<EnterpriseEntitlementsResponse>;
  budgets: Loadable<EnterpriseUsageBudgetDto[]>;
  usage: Loadable<EnterpriseUsagePeriodAggregateDto[]>;
  alerts: BudgetAlert[];
}) {
  const loading = [props.providers, props.billing, props.budgets, props.usage]
    .some((resource) => resource.state === "loading");
  const actions: string[] = [];
  if (props.tenantStatus !== "active") actions.push(`租户当前状态为 ${props.tenantStatus}，新业务可能受限。`);
  if (props.providers.state === "failed") actions.push("Provider capability 暂不可读取，请检查服务端 readiness。");
  if (props.providers.state === "ready") props.providers.data
    .filter((item) => item.status !== "ready")
    .forEach((item) => actions.push(`${providerCapabilityLabels[item.capability]}：${providerStatusLabels[item.status]}${item.reasonCode ? `（${item.reasonCode}）` : ""}`));
  if (props.billing.state === "ready" && props.billing.data.account.status !== "active") {
    actions.push(`账务账户状态为 ${props.billing.data.account.status}。`);
  }
  if (props.budgets.state === "ready" && props.budgets.data.length === 0) {
    actions.push("尚未配置用量预算；工作台不会推断默认限额。");
  }
  if (props.usage.state === "failed") actions.push("账期聚合暂不可读取，预算告警无法完整判断。");
  props.alerts.forEach((alert) => actions.push(
    `${usageCategoryPresentation[alert.budget.category].label}达到 ${alert.percent}%（阈值 ${alert.budget.alertThresholdPercent}%）。`,
  ));
  return <section className="dashboard-section" aria-labelledby="action-title">
    <SectionHeader icon={enterpriseIcons.dashboard.tasks} id="action-title" title="待办与告警"
      description="只根据当前租户的服务端状态生成，不使用示例任务。" />
    {loading ? <StatusPanel state="loading" description="正在汇总当前账号可读取的服务端状态。" />
      : actions.length === 0 ? <StatusPanel state="empty" title="当前没有可判定待办"
      description="已读取的数据没有产生告警；未授权或未接入的数据不计为正常。" />
      : <ul className="dashboard-actions">{actions.map((action) => <li key={action}>{action}</li>)}</ul>}
  </section>;
}

function UsageSection({ resource, readable }: {
  resource: Loadable<EnterpriseUsagePeriodAggregateDto[]>;
  readable: boolean;
}) {
  return <section className="dashboard-section" aria-labelledby="usage-overview-title">
    <SectionHeader icon={enterpriseIcons.settings.usage} id="usage-overview-title" title="账期用量"
      description="不同单位不求和；每行均来自不可变 ledger 的账期聚合。" />
    {!readable ? <StatusPanel state="forbidden" description="当前账号缺少 usage:read，未读取用量。" /> : null}
    {readable && resource.state === "loading" ? <StatusPanel state="loading" description="正在读取账期聚合。" /> : null}
    {readable && resource.state === "failed" ? <DashboardError error={resource.error} operation="读取账期用量" /> : null}
    {resource.state === "ready" && resource.data.length === 0 ? <StatusPanel state="empty"
      description="服务端没有账期聚合；工作台不生成示例趋势。" /> : null}
    {resource.state === "ready" && resource.data.length > 0 ? <div className="dashboard-table-wrap"
      role="region" aria-label="账期用量聚合" tabIndex={0}><table className="dashboard-table">
      <caption className="visually-hidden">当前租户的账期用量聚合</caption>
      <thead><tr><th>类别</th><th>净用量</th><th>账期</th><th>Ledger</th></tr></thead>
      <tbody>{resource.data.map((item) => <tr key={item.id}><td>{usageCategoryPresentation[item.category].label}<small>{item.category}</small></td>
        <td><strong>{item.netAmount.toLocaleString("zh-CN")}</strong> {unitLabels[item.unit]}<small>{item.usageEventCount} event · {item.adjustmentCount} adjustment</small></td>
        <td>{formatSettingsDate(item.periodStart)}<small>至 {formatSettingsDate(item.periodEnd)}</small></td>
        <td>{item.ledgerCount}<small>版本 {item.version}</small></td></tr>)}</tbody>
    </table></div> : null}
  </section>;
}

interface BudgetAlert { budget: EnterpriseUsageBudgetDto; percent: number }
function budgetAlerts(
  budgets: Loadable<EnterpriseUsageBudgetDto[]>,
  usage: Loadable<EnterpriseUsagePeriodAggregateDto[]>,
): BudgetAlert[] {
  if (budgets.state !== "ready" || usage.state !== "ready") return [];
  return budgets.data.flatMap((budget) => {
    if (budget.status !== "active" || budget.limitAmount <= 0) return [];
    const aggregate = usage.data.find((item) => item.category === budget.category &&
      item.unit === budget.unit && item.periodStart === budget.periodStart &&
      item.periodEnd === budget.periodEnd);
    if (!aggregate) return [];
    const percent = Math.round(aggregate.netAmount / budget.limitAmount * 100);
    return percent >= budget.alertThresholdPercent ? [{ budget, percent }] : [];
  });
}

function SectionHeader({ icon, id, title, description }: {
  icon: string; id: string; title: string; description: string;
}) {
  return <header className="dashboard-section__header"><MaterialIcon name={icon} /><div><h2 id={id}>{title}</h2><p>{description}</p></div></header>;
}
function DashboardError({ error, operation }: { error: unknown; operation: string }) {
  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  const state = apiErrorState(error);
  return <StatusPanel state={state} description={state === "not_ready"
    ? `${operation}所需的 PostgreSQL runtime 尚未就绪，未生成本地替代数据。`
    : state === "forbidden" ? `服务端拒绝${operation}，未执行越权读取。`
    : `${operation}失败，未保留陈旧结果。`} traceId={apiError?.traceId} />;
}
function loadableLabel(state: Loadable<unknown>["state"]) {
  if (state === "loading") return "读取中";
  if (state === "failed") return "不可用";
  return "未读取";
}
