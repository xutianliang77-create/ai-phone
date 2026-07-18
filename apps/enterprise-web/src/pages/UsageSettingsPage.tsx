import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConfigureEnterpriseUsageBudgetRequest,
  EnterpriseUsageBudgetDto,
  EnterpriseUsageCategory,
  EnterpriseUsagePeriodAggregateDto,
  EnterpriseScope,
} from "@translation/contracts";
import {
  EnterpriseApiError,
  type EnterpriseApi,
  type EnterpriseContentRequestContext,
} from "../api/enterprise-api.js";
import { useAuth } from "../auth/AuthContext.js";
import { apiErrorState } from "../business-state.js";
import { EnterpriseBudgetForm } from "../components/EnterpriseBudgetForm.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import {
  formatSettingsDate,
  unitLabels,
  usageCategoryPresentation,
  visibleFingerprint,
} from "../enterprise-settings.js";
import { enterpriseIcons } from "../icon-registry.js";

type LoadState = "idle" | "loading" | "ready" | "failed";
type BudgetInput = Omit<ConfigureEnterpriseUsageBudgetRequest, "tenantId">;

export function UsageSettingsPage() {
  const { state, api } = useAuth();
  if (state.status !== "ready") return null;
  return <UsageSettingsWorkspace
    api={api}
    token={state.session.token}
    tenantId={state.context.tenant.id}
    routeDocument={state.routeDocument}
    scopes={state.context.scopes}
  />;
}

function UsageSettingsWorkspace({ api, token, tenantId, routeDocument, scopes }: {
  api: EnterpriseApi;
  token: string;
  tenantId: string;
  routeDocument: EnterpriseContentRequestContext["routeDocument"];
  scopes: readonly EnterpriseScope[];
}) {
  const canReadBudgets = scopes.includes("billing:read");
  const canWriteBudgets = scopes.includes("billing:write");
  const canReadUsage = scopes.includes("usage:read");
  const context = useMemo(() => ({
    token, tenantId, routeDocument,
  }), [routeDocument, tenantId, token]);
  const [budgets, setBudgets] = useState<EnterpriseUsageBudgetDto[]>([]);
  const [aggregates, setAggregates] = useState<EnterpriseUsagePeriodAggregateDto[]>([]);
  const [budgetState, setBudgetState] = useState<LoadState>(canReadBudgets ? "loading" : "idle");
  const [usageState, setUsageState] = useState<LoadState>(canReadUsage ? "loading" : "idle");
  const [budgetError, setBudgetError] = useState<unknown>();
  const [usageError, setUsageError] = useState<unknown>();
  const [mutationError, setMutationError] = useState<unknown>();
  const [editing, setEditing] = useState<EnterpriseUsageBudgetDto | "new">();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  const openBudget = (value: EnterpriseUsageBudgetDto | "new") => {
    setMutationError(undefined);
    setNotice(undefined);
    setEditing(value);
  };

  const loadBudgets = useCallback(async () => {
    if (!canReadBudgets) return;
    setBudgetState("loading");
    setBudgetError(undefined);
    try {
      setBudgets((await api.listUsageBudgets(context)).budgets);
      setBudgetState("ready");
    } catch (error) {
      setBudgetError(error);
      setBudgetState("failed");
    }
  }, [api, canReadBudgets, context]);

  const loadUsage = useCallback(async () => {
    if (!canReadUsage) return;
    setUsageState("loading");
    setUsageError(undefined);
    try {
      setAggregates((await api.listUsageAggregates(context)).aggregates);
      setUsageState("ready");
    } catch (error) {
      setUsageError(error);
      setUsageState("failed");
    }
  }, [api, canReadUsage, context]);

  useEffect(() => { void loadBudgets(); void loadUsage(); }, [loadBudgets, loadUsage]);

  const saveBudget = async (category: EnterpriseUsageCategory, input: BudgetInput) => {
    setBusy(true);
    setMutationError(undefined);
    setNotice(undefined);
    try {
      const { budget } = await api.configureUsageBudget(context, category, input);
      setBudgets((current) => [budget, ...current.filter((item) => item.id !== budget.id)]);
      setEditing(undefined);
      setNotice(`${usageCategoryPresentation[budget.category].label}预算已保存为服务端版本 ${budget.version}。`);
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageFrame
      title="预算与用量"
      description="预算来自账务配置；用量来自不可变 ledger 的服务端账期聚合"
      action={canWriteBudgets ? <button className="button button--primary" disabled={busy} onClick={() => openBudget("new")}><MaterialIcon name={enterpriseIcons.action.create} />配置预算</button> : undefined}
    >
      {editing ? <EnterpriseBudgetForm
        key={editing === "new" ? "new" : `${editing.id}:${editing.version}`}
        budget={editing === "new" ? undefined : editing}
        busy={busy}
        onCancel={() => setEditing(undefined)}
        onSubmit={(category, input) => void saveBudget(category, input)}
      /> : null}
      {mutationError ? <UsageError error={mutationError} operation="写入预算" /> : null}
      {notice ? <div className="settings-notice settings-notice--success" role="status"><MaterialIcon name="check_circle" />{notice}</div> : null}
      <BudgetSection
        budgets={budgets} state={budgetState} error={budgetError}
        readable={canReadBudgets} writable={canWriteBudgets}
        onRetry={() => void loadBudgets()} onEdit={openBudget}
      />
      <AggregateSection
        aggregates={aggregates} state={usageState} error={usageError}
        readable={canReadUsage} onRetry={() => void loadUsage()}
      />
    </PageFrame>
  );
}

function BudgetSection({ budgets, state, error, readable, writable, onRetry, onEdit }: {
  budgets: EnterpriseUsageBudgetDto[]; state: LoadState; error: unknown;
  readable: boolean; writable: boolean; onRetry(): void; onEdit(value: EnterpriseUsageBudgetDto): void;
}) {
  return <section className="settings-section" aria-labelledby="budget-title"><header><MaterialIcon name={enterpriseIcons.settings.budget} /><div><h2 id="budget-title">用量预算</h2><p>需要 billing:read；配置需要 billing:write。</p></div></header>
    {!readable ? <StatusPanel state="forbidden" description="当前账号缺少 billing:read，未读取预算。" /> : null}
    {state === "loading" ? <StatusPanel state="loading" description="正在读取用量预算。" /> : null}
    {state === "failed" ? <UsageError error={error} operation="读取预算" action={<button className="button button--secondary" onClick={onRetry}>重试</button>} /> : null}
    {state === "ready" && budgets.length === 0 ? <StatusPanel state="empty" description="服务端没有当前租户的预算配置。" /> : null}
    {state === "ready" && budgets.length > 0 ? <div className="settings-table-wrap"
      role="region" aria-label="用量预算表" tabIndex={0}><table className="settings-table">
      <caption className="visually-hidden">当前租户的用量预算</caption><thead><tr><th>类别</th><th>上限</th><th>阈值</th><th>周期</th><th>状态 / 版本</th><th>操作</th></tr></thead><tbody>{budgets.map((budget) => <tr key={budget.id}>
      <td><strong>{usageCategoryPresentation[budget.category].label}</strong><small>{budget.category}</small></td>
      <td>{budget.limitAmount.toLocaleString("zh-CN")} {unitLabels[budget.unit]}</td><td>{budget.alertThresholdPercent}%</td>
      <td>{formatSettingsDate(budget.periodStart)}<small>至 {formatSettingsDate(budget.periodEnd)}</small></td>
      <td>{budget.status}<small>版本 {budget.version}</small></td>
      <td>{writable ? <button className="text-button" onClick={() => onEdit(budget)}><MaterialIcon name={enterpriseIcons.action.edit} />编辑 {usageCategoryPresentation[budget.category].label}</button> : <small>只读</small>}</td>
    </tr>)}</tbody></table></div> : null}
  </section>;
}

function AggregateSection({ aggregates, state, error, readable, onRetry }: {
  aggregates: EnterpriseUsagePeriodAggregateDto[]; state: LoadState; error: unknown; readable: boolean; onRetry(): void;
}) {
  return <section className="settings-section" aria-labelledby="aggregate-title"><header><MaterialIcon name={enterpriseIcons.settings.usage} /><div><h2 id="aggregate-title">账期聚合</h2><p>只读结果，不把聚合值解释为余额、账单或实时 Provider 用量。</p></div></header>
    {!readable ? <StatusPanel state="forbidden" description="当前账号缺少 usage:read，未读取账期聚合。" /> : null}
    {state === "loading" ? <StatusPanel state="loading" description="正在读取不可变 ledger 的账期聚合。" /> : null}
    {state === "failed" ? <UsageError error={error} operation="读取用量" action={<button className="button button--secondary" onClick={onRetry}>重试</button>} /> : null}
    {state === "ready" && aggregates.length === 0 ? <StatusPanel state="empty" description="服务端没有当前租户的账期聚合；页面不生成趋势或示例数据。" /> : null}
    {state === "ready" && aggregates.length > 0 ? <div className="settings-table-wrap"
      role="region" aria-label="账期用量表" tabIndex={0}><table className="settings-table">
      <caption className="visually-hidden">当前租户的不可变账期聚合</caption><thead><tr><th>类别</th><th>结算 / 调整 / 净额</th><th>记录计数</th><th>账期</th><th>Ledger</th></tr></thead><tbody>{aggregates.map((item) => <tr key={item.id}>
      <td><strong>{usageCategoryPresentation[item.category].label}</strong><small>{item.category}</small></td>
      <td>{item.settledAmount} / {item.adjustmentAmount} / <strong>{item.netAmount}</strong><small>{unitLabels[item.unit]}</small></td>
      <td>{item.ledgerCount} ledger<small>{item.usageEventCount} event · {item.adjustmentCount} adjustment</small></td>
      <td>{formatSettingsDate(item.periodStart)}<small>至 {formatSettingsDate(item.periodEnd)}</small></td>
      <td><code>{visibleFingerprint(item.ledgerHash)}</code><small>计算于 {formatSettingsDate(item.computedAt)} · 版本 {item.version}</small></td>
    </tr>)}</tbody></table></div> : null}
  </section>;
}

function UsageError({ error, operation, action }: { error: unknown; operation: string; action?: React.ReactNode }) {
  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  const state = apiErrorState(error);
  return <StatusPanel state={state} description={state === "not_ready"
    ? "企业账务/用量 PostgreSQL runtime 尚未就绪，未回退到 SQLite/JSON。"
    : state === "conflict" ? "预算版本或周期发生冲突，服务端未覆盖现有记录。"
    : state === "forbidden" ? `服务端拒绝${operation}，未执行越权操作。`
    : `${operation}失败，未生成本地替代结果。`} traceId={apiError?.traceId} action={action} />;
}
