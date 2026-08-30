import { useCallback, useEffect, useMemo, useState } from "react";
import type { EnterpriseBillingLifecycleStatusResponse,
  EnterpriseEntitlementsResponse } from "@translation/contracts";
import {
  EnterpriseApiError,
  type EnterpriseApi,
  type EnterpriseContentRequestContext,
} from "../api/enterprise-api.js";
import { useAuth } from "../auth/AuthContext.js";
import { apiErrorState } from "../business-state.js";
import { EnterpriseBillingForm } from "../components/EnterpriseBillingForm.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { formatSettingsDate } from "../enterprise-settings.js";
import { enterpriseIcons } from "../icon-registry.js";

type LoadState = "loading" | "ready" | "failed";

export function BillingSettingsPage() {
  const { state, api } = useAuth();
  if (state.status !== "ready") return null;
  return <BillingSettingsWorkspace
    api={api}
    token={state.session.token}
    tenantId={state.context.tenant.id}
    routeDocument={state.routeDocument}
    canWrite={state.context.scopes.includes("billing:write")}
  />;
}

function BillingSettingsWorkspace({ api, token, tenantId, routeDocument, canWrite }: {
  api: EnterpriseApi;
  token: string;
  tenantId: string;
  routeDocument: EnterpriseContentRequestContext["routeDocument"];
  canWrite: boolean;
}) {
  const context = useMemo(() => ({
    token, tenantId, routeDocument,
  }), [routeDocument, tenantId, token]);
  const [data, setData] = useState<EnterpriseEntitlementsResponse>();
  const [lifecycle, setLifecycle] =
    useState<EnterpriseBillingLifecycleStatusResponse>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<unknown>();
  const [mutationError, setMutationError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(undefined);
    setData(undefined);
    try {
      const [entitlements, status] = await Promise.allSettled([
        api.getBillingEntitlements(context),
        api.getBillingLifecycleStatus(context),
      ]);
      if (status.status === "rejected") throw status.reason;
      setLifecycle(status.value);
      if (entitlements.status === "fulfilled") setData(entitlements.value);
      else setLoadError(entitlements.reason);
      setLoadState("ready");
    } catch (error) {
      setLoadError(error);
      setLoadState("failed");
    }
  }, [api, context]);

  useEffect(() => { void load(); }, [load]);

  const changeSubscription = async (input: Parameters<typeof api.changeSubscription>[1]) => {
    setBusy(true);
    setMutationError(undefined);
    setNotice(undefined);
    try {
      const response = await api.changeSubscription(context, input);
      setData(response);
      setLifecycle(await api.getBillingLifecycleStatus(context));
      setIdempotencyKey(createIdempotencyKey());
      setNotice(`订阅已更新为 ${response.subscription.planCode}@${response.subscription.planVersion}。`);
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageFrame title="套餐与权益" description="账务账户、订阅和 entitlement 均来自服务端版本化快照">
      {loadState === "loading" ? <StatusPanel state="loading" description="正在读取当前租户的账务与 entitlement。" /> : null}
      {loadState === "failed" ? <BillingError error={loadError} action={
        <button className="button button--secondary" onClick={() => void load()}>重试</button>
      } /> : null}
      {loadState === "ready" && lifecycle ? <>
        <BillingLifecycleTruth lifecycle={lifecycle} />
        {!data ? <BillingError error={loadError} /> : null}
        {data ? <BillingTruth data={data} /> : null}
        {!canWrite ? <div className="settings-notice" role="status"><MaterialIcon name={enterpriseIcons.status.forbidden} />当前角色只有 billing:read，不能变更订阅。</div> : null}
        {mutationError ? <BillingError error={mutationError} mutation /> : null}
        {notice ? <div className="settings-notice settings-notice--success" role="status"><MaterialIcon name="check_circle" />{notice}</div> : null}
        {canWrite && data ? <EnterpriseBillingForm
          key={`${data.subscription.id}:${data.subscription.version}`}
          subscription={data.subscription}
          busy={busy}
          idempotencyKey={idempotencyKey}
          onSubmit={(input) => void changeSubscription(input)}
        /> : null}
      </> : null}
    </PageFrame>
  );
}

function BillingTruth({ data }: { data: EnterpriseEntitlementsResponse }) {
  const entitlements = Object.entries(data.entitlement.entitlements);
  return <>
    <section className="settings-summary-grid" aria-label="账务真值">
      <Truth label="账务状态" value={data.account.status} detail={`${data.account.currency} · 版本 ${data.account.version}`} />
      <Truth label="当前套餐" value={data.subscription.planCode} detail={`版本 ${data.subscription.planVersion}`} />
      <Truth label="席位与周期" value={`${data.subscription.seats} 席`} detail={data.subscription.billingCycle} />
      <Truth label="订阅状态" value={data.subscription.status} detail={`版本 ${data.subscription.version}`} />
      <Truth label="当前账期" value={formatSettingsDate(data.subscription.currentPeriodStart)} detail={`至 ${formatSettingsDate(data.subscription.currentPeriodEnd)}`} />
      <Truth label="权益快照" value={data.entitlement.status} detail={data.entitlement.entitlementVersion} />
    </section>
    <section className="settings-section" aria-labelledby="entitlement-title">
      <header><MaterialIcon name={enterpriseIcons.settings.entitlement} /><div><h2 id="entitlement-title">Entitlement</h2><p>服务端快照生效时间 {formatSettingsDate(data.entitlement.effectiveFrom)}</p></div></header>
      {entitlements.length === 0 ? <StatusPanel state="empty" description="当前快照没有 entitlement 条目。" /> : (
        <div className="entitlement-grid">{entitlements.map(([name, value]) => (
          <article key={name}><span>{name}</span><strong>{value.enabled ? "已启用" : "未启用"}</strong><small>{value.limit === null ? "不限额" : `上限 ${value.limit}`}</small></article>
        ))}</div>
      )}
    </section>
  </>;
}

function BillingLifecycleTruth({ lifecycle }: {
  lifecycle: EnterpriseBillingLifecycleStatusResponse;
}) {
  return <section className="settings-section" aria-labelledby="subscription-lifecycle-title">
      <header><MaterialIcon name={enterpriseIcons.settings.billing} /><div>
        <h2 id="subscription-lifecycle-title">订阅生命周期</h2>
        <p>只读服务端 event/decision 状态，不包含 Provider 原始载荷或内部租约。</p>
      </div></header>
      <div className="settings-summary-grid">
        <Truth label="账户 / 订阅" value={`${lifecycle.accountStatus} / ${lifecycle.subscriptionStatus}`}
          detail={`更新 ${formatSettingsDate(lifecycle.updatedAt)}`} />
        <Truth label="生命周期账期" value={formatSettingsDate(lifecycle.currentPeriodStart)}
          detail={`至 ${formatSettingsDate(lifecycle.currentPeriodEnd)}`} />
        <Truth label="最后账务事件" value={lifecycle.lastEventType ?? "暂无事件"}
          detail={lifecycle.lastDecisionAction
            ? `${lifecycle.lastDecisionAction} · ${lifecycle.lastDecisionReason ?? "无原因码"}`
            : "等待服务端 decision"} />
      </div>
      {lifecycle.accountStatus !== "active" ? <div className="settings-notice" role="status">
        <MaterialIcon name={enterpriseIcons.status.not_ready} />当前状态阻断新高成本任务；进行中安全结束、结算和审计继续收敛。
      </div> : null}
    </section>;
}

function Truth({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="settings-summary-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function BillingError({ error, mutation = false, action }: { error: unknown; mutation?: boolean; action?: React.ReactNode }) {
  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  const descriptions: Record<string, string> = {
    plan_not_found: "套餐代码或版本不存在，服务端未执行订阅变更。",
    plan_retired: "该套餐版本已经退役，请使用已发布版本。",
    billing_account_inactive: "账务账户当前不可变更订阅。",
    seat_limit_exceeded: "席位数超过该套餐版本的服务端限制。",
    idempotency_conflict: "同一幂等键对应了不同请求；当前表单未生成伪成功结果。",
    entitlement_not_found: "当前订阅状态没有活动 entitlement；以只读生命周期状态为准。",
  };
  const state = apiError?.status === 402 || apiError?.code === "entitlement_not_found"
    ? "not_ready" : apiErrorState(error);
  return <StatusPanel
    state={state}
    description={apiError && descriptions[apiError.code] ? descriptions[apiError.code]
      : state === "not_ready" ? "企业账务 PostgreSQL runtime 尚未就绪，未回退到 SQLite/JSON。"
      : state === "forbidden" ? `服务端拒绝了 billing:${mutation ? "write" : "read"}。`
      : mutation ? "订阅变更未保存。" : "账务与 entitlement 读取失败。"}
    traceId={apiError?.traceId}
    action={action}
  />;
}

function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `subscription-${Date.now()}-${Math.random()}`;
}
