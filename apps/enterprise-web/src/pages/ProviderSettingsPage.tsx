import { useCallback, useEffect, useState } from "react";
import type { EnterpriseProviderCapabilityDocument } from "@translation/contracts";
import { EnterpriseApiError, type EnterpriseApi } from "../api/enterprise-api.js";
import { useAuth } from "../auth/AuthContext.js";
import { apiErrorState } from "../business-state.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import {
  formatSettingsDate,
  providerCapabilityLabels,
  providerStatusLabels,
  visibleFingerprint,
} from "../enterprise-settings.js";
import { enterpriseIcons } from "../icon-registry.js";

type LoadState = "loading" | "ready" | "failed";

export function ProviderSettingsPage() {
  const { state, api } = useAuth();
  if (state.status !== "ready") return null;
  return <ProviderSettingsWorkspace
    api={api}
    token={state.session.token}
    tenantId={state.context.tenant.id}
  />;
}

function ProviderSettingsWorkspace({ api, token, tenantId }: {
  api: EnterpriseApi;
  token: string;
  tenantId: string;
}) {
  const [documents, setDocuments] = useState<EnterpriseProviderCapabilityDocument[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<unknown>();

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(undefined);
    try {
      const response = await api.getProviderCapabilities(token, tenantId);
      setDocuments(response.capabilities);
      setLoadState("ready");
    } catch (error) {
      setLoadError(error);
      setLoadState("failed");
    }
  }, [api, tenantId, token]);

  useEffect(() => { void load(); }, [load]);

  return (
    <PageFrame
      title="Provider"
      description="只读 capability document；就绪状态不等同于企业生产门禁通过"
      action={<button className="button button--secondary" disabled={loadState === "loading"} onClick={() => void load()}>
        <MaterialIcon name={enterpriseIcons.action.refresh} />刷新状态
      </button>}
    >
      {loadState === "loading" ? <StatusPanel state="loading" description="正在读取 Provider capability document。" /> : null}
      {loadState === "failed" ? <ProviderError error={loadError} onRetry={() => void load()} /> : null}
      {loadState === "ready" && documents.length === 0 ? (
        <StatusPanel state="empty" description="服务端未返回任何 Provider capability document。" />
      ) : null}
      {loadState === "ready" && documents.length > 0 ? (
        <section className="provider-grid" aria-label="Provider capability 列表">
          {documents.map((document) => <ProviderCard key={document.capability} document={document} />)}
        </section>
      ) : null}
      <div className="settings-notice" role="note">
        <MaterialIcon name={enterpriseIcons.status.forbidden} />
        页面不接收或回显 API Key、Secret、Webhook URL 与健康检查地址；配置写 API 尚未提供。
      </div>
    </PageFrame>
  );
}

function ProviderError({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  const state = apiError ? apiErrorState(apiError) : "degraded";
  return <StatusPanel
    state={state}
    title="Provider 状态暂时不可用"
    description={state === "not_ready"
      ? "Provider capability runtime 尚未就绪，未使用缓存结果伪装实时状态。"
      : state === "forbidden"
      ? "服务端拒绝了 tenant:read，未读取 Provider capability。"
      : "未使用缓存结果伪装实时状态；企业上下文仍可继续使用。"}
    traceId={apiError?.traceId}
    action={<button className="button button--secondary" onClick={onRetry}>重试</button>}
  />;
}

function ProviderCard({ document }: { document: EnterpriseProviderCapabilityDocument }) {
  const features = Object.entries(document.features);
  return (
    <article className="provider-card">
      <header><div>
        <span>{providerCapabilityLabels[document.capability]}</span>
        <h2>{document.provider}</h2>
      </div><strong className={`settings-chip settings-chip--${document.status}`}>
        {providerStatusLabels[document.status]}
      </strong></header>
      <dl>
        <div><dt>区域</dt><dd>{document.region}</dd></div>
        <div><dt>原因码</dt><dd>{document.reasonCode ?? "无"}</dd></div>
        <div><dt>配置指纹</dt><dd><code>{visibleFingerprint(document.fingerprint)}</code></dd></div>
        <div><dt>检测时间</dt><dd>{formatSettingsDate(document.checkedAt)}</dd></div>
        <div><dt>有效期</dt><dd>{formatSettingsDate(document.expiresAt)}</dd></div>
      </dl>
      <div className="provider-card__features" aria-label={`${providerCapabilityLabels[document.capability]} features`}>
        {features.length === 0 ? <span>服务端未声明 feature</span> : features.map(([name, enabled]) => (
          <span key={name}><MaterialIcon name={enabled ? "check_circle" : "block"} />{name}</span>
        ))}
      </div>
    </article>
  );
}
