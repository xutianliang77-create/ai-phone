import type { EnterpriseProviderCapabilityDocument } from "@translation/contracts";
import { providerCapabilityState } from "../business-state.js";
import { StatusPanel } from "./StatusPanel.js";

export function ProviderReadinessPanel({
  capabilities,
}: {
  capabilities: EnterpriseProviderCapabilityDocument[] | null;
}) {
  if (capabilities === null) {
    return (
      <StatusPanel
        state="degraded"
        title="Provider 状态暂时不可用"
        description="企业上下文仍可使用，但当前无法取得 Provider capability document。"
      />
    );
  }
  if (capabilities.length === 0) {
    return (
      <StatusPanel
        state="empty"
        title="没有 Provider capability"
        description="服务端未返回任何 Provider capability document。"
      />
    );
  }
  const summary = providerSummaryState(capabilities);
  return (
    <section aria-labelledby="provider-readiness-title">
      <h2 id="provider-readiness-title">Provider readiness</h2>
      <div className="truth-grid">
        {capabilities.map((document) => (
          <article className="truth-card" key={document.capability}>
            <span>{document.capability}</span>
            <strong>{document.status}</strong>
            <small>{document.provider} · {document.reasonCode ?? document.fingerprint}</small>
          </article>
        ))}
      </div>
      {summary === "ready" ? null : (
        <StatusPanel
          state={summary}
          description="状态来自服务端实时 capability document；未配置或探测失败的能力不会开放。"
        />
      )}
    </section>
  );
}

function providerSummaryState(capabilities: EnterpriseProviderCapabilityDocument[]) {
  const states = capabilities.map((item) => providerCapabilityState(item.status));
  if (states.includes("processing")) return "processing" as const;
  if (states.every((state) => state === "ready")) return "ready" as const;
  if (states.includes("ready") || states.includes("degraded")) return "degraded" as const;
  return "not_ready" as const;
}
