import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EnterpriseCampaignDto,
  EnterpriseCampaignLeadDto,
  EnterpriseLeadImportBatchDto,
  EnterpriseLeadImportResponse,
  EnterpriseLeadImportRowInput,
} from "@translation/contracts";
import type {
  EnterpriseApi,
  EnterpriseContentRequestContext,
} from "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type DataState =
  | { status: "loading" }
  | { status: "ready"; leads: EnterpriseCampaignLeadDto[];
      batches: EnterpriseLeadImportBatchDto[] }
  | { status: "failed"; error: unknown };

export function CampaignLeadImportPanel({ api, context, campaign, canWrite, onClose }: {
  api: EnterpriseApi;
  context: EnterpriseContentRequestContext;
  campaign: EnterpriseCampaignDto;
  canWrite: boolean;
  onClose(): void;
}) {
  const [data, setData] = useState<DataState>({ status: "loading" });
  const [mode, setMode] = useState<"csv" | "api">("csv");
  const [sourceReference, setSourceReference] = useState("");
  const [payload, setPayload] = useState("");
  const [result, setResult] = useState<EnterpriseLeadImportResponse | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const importKey = useRef(commandKey("import"));
  const rollbackKeys = useRef(new Map<string, string>());
  const editable = canWrite && campaign.status === "draft" &&
    campaign.approvalStatus === "not_submitted";

  const refresh = useCallback(async () => {
    setData({ status: "loading" });
    try {
      const [leads, batches] = await Promise.all([
        api.listCampaignLeads(context, campaign.id),
        api.listLeadImportBatches(context, campaign.id),
      ]);
      setData({ status: "ready", leads: leads.leads, batches: batches.batches });
    } catch (error) {
      setData({ status: "failed", error });
    }
  }, [api, campaign.id, context]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function importLeads() {
    if (!editable || busy || !sourceReference.trim() || !payload) return;
    setClientError(null);
    let input;
    if (mode === "csv") input = { sourceKind: "csv" as const,
      sourceReference: sourceReference.trim(), csv: payload };
    else {
      try {
        const rows = JSON.parse(payload) as unknown;
        if (!Array.isArray(rows)) throw new Error("rows");
        input = { sourceKind: "api" as const, sourceReference: sourceReference.trim(),
          rows: rows as EnterpriseLeadImportRowInput[] };
      } catch {
        setClientError("API 模式必须输入 JSON 行数组。");
        return;
      }
    }
    setBusy("import");
    try {
      const response = await api.importCampaignLeads(
        context, campaign.id, input, importKey.current,
      );
      setResult(response);
      if (response.status === "committed" || response.status === "replayed") {
        importKey.current = commandKey("import");
        setPayload("");
        await refresh();
      }
    } catch (error) {
      setData({ status: "failed", error });
    } finally {
      setBusy(null);
    }
  }

  async function rollback(batch: EnterpriseLeadImportBatchDto) {
    if (!editable || busy || batch.status !== "committed") return;
    setBusy(`rollback:${batch.id}`);
    try {
      let key = rollbackKeys.current.get(batch.id);
      if (!key) {
        key = commandKey("rollback");
        rollbackKeys.current.set(batch.id, key);
      }
      await api.rollbackLeadImport(context, campaign.id, batch.id,
        { expectedVersion: batch.version }, key);
      rollbackKeys.current.delete(batch.id);
      setResult(null);
      await refresh();
    } catch (error) {
      setData({ status: "failed", error });
    } finally {
      setBusy(null);
    }
  }

  return <section className="lead-import-panel" aria-labelledby="lead-import-title">
    <header className="lead-import-panel__header">
      <div><span className="lead-import-panel__eyebrow">{campaign.name}</span>
        <h2 id="lead-import-title">线索与导入批次</h2>
        <p>号码按国家规范化并加密保存；列表只显示脱敏号码。</p></div>
      <button className="text-button" type="button" onClick={onClose}>关闭</button>
    </header>
    <div className="lead-import-boundary"><MaterialIcon name={enterpriseIcons.campaign.approval} />
      <span><strong>导入不代表已取得营销授权</strong>
        <small>本任务不会创建授权、禁拨、调度、拨号或 Provider 成功记录。</small></span>
    </div>
    {editable ? <div className="lead-import-form">
      <div className="lead-import-tabs" role="tablist" aria-label="导入方式">
        <button type="button" role="tab" aria-selected={mode === "csv"}
          onClick={() => { setMode("csv"); setPayload(""); setResult(null); }}>CSV</button>
        <button type="button" role="tab" aria-selected={mode === "api"}
          onClick={() => { setMode("api"); setPayload(""); setResult(null); }}>API JSON</button>
      </div>
      <label>来源标识<input value={sourceReference} maxLength={200}
        placeholder={mode === "csv" ? "leads-2026-07.csv" : "crm-export-42"}
        onChange={(event) => setSourceReference(event.target.value)} /></label>
      {mode === "csv" ? <><label className="lead-import-file">
        <span>选择 CSV 文件</span><input type="file" accept=".csv,text/csv"
          onChange={(event) => void readCsv(event.currentTarget.files?.[0],
            setPayload, setSourceReference, setClientError)} /></label>
        <textarea aria-label="CSV 内容" rows={7} value={payload}
          placeholder="phone,countryCode,externalId&#10;+1 415 555 2671,US,crm-1"
          onChange={(event) => setPayload(event.target.value)} /></>
        : <textarea aria-label="API JSON 行数组" rows={9} value={payload}
          placeholder={'[{"phone":"+14155552671","countryCode":"US","externalId":"crm-1"}]'}
          onChange={(event) => setPayload(event.target.value)} />}
      {clientError ? <p className="lead-import-error" role="alert">{clientError}</p> : null}
      <button className="button button--primary" type="button"
        disabled={Boolean(busy) || !payload || !sourceReference.trim()}
        onClick={() => void importLeads()}>
        <MaterialIcon name={enterpriseIcons.campaign.import} />
        {busy === "import" ? "正在校验…" : "校验并整批导入"}</button>
    </div> : <p className="lead-import-readonly">活动离开未提交草稿后，服务端禁止导入和回滚。</p>}
    {result ? <ImportResult result={result} /> : null}
    {data.status === "loading" ? <StatusPanel state="loading"
      description="正在读取当前活动的脱敏线索和导入批次。" /> : null}
    {data.status === "failed" ? <StatusPanel state={apiErrorState(data.error)}
      description="线索服务不可用；不会回退到 SQLite、JSON 或示例数据。"
      action={<button className="button button--secondary" type="button"
        onClick={() => void refresh()}>重试</button>} /> : null}
    {data.status === "ready" ? <div className="lead-import-data">
      <section><h3>活动线索 <span>{data.leads.length}</span></h3>
        {data.leads.length === 0 ? <p className="lead-import-empty">暂无活动线索。</p>
          : <div className="lead-table" tabIndex={0} role="region"
            aria-label="活动线索表" aria-describedby="lead-mask-note"><table>
              <thead><tr><th>号码</th><th>外部 ID</th><th>国家</th><th>语言</th><th>属性</th></tr></thead>
              <tbody>{data.leads.map((lead) => <tr key={lead.linkId}>
                <td>{lead.phoneHint}</td><td>{lead.externalId ?? "—"}</td>
                <td>{lead.countryCode}</td><td>{lead.language ?? "—"}</td>
                <td>{lead.attributeKeys.join(" · ") || "—"}</td></tr>)}</tbody>
            </table></div>}
        <small id="lead-mask-note">页面、API 和审计均不返回号码明文。</small></section>
      <section><h3>导入批次 <span>{data.batches.length}</span></h3>
        {data.batches.length === 0 ? <p className="lead-import-empty">暂无已提交批次。</p>
          : <div className="lead-import-batches">{data.batches.map((batch) =>
            <article key={batch.id}><header><strong>{batch.sourceReference}</strong>
              <span className={`lead-batch-status lead-batch-status--${batch.status}`}>
                {batch.status === "committed" ? "已提交" : "已回滚"}</span></header>
              <p>共 {batch.totalRows} · 新建 {batch.createdCount} · 关联 {batch.linkedCount} · 重复 {batch.duplicateCount}</p>
              <footer><time>{new Date(batch.createdAt).toLocaleString()}</time>
                {editable && batch.status === "committed" ? <button type="button"
                  className="button button--secondary" disabled={Boolean(busy)}
                  onClick={() => void rollback(batch)}><MaterialIcon name={enterpriseIcons.campaign.rollback} />
                  {busy === `rollback:${batch.id}` ? "回滚中…" : "回滚批次"}</button> : null}</footer>
            </article>)}</div>}</section>
    </div> : null}
  </section>;
}

function ImportResult({ result }: { result: EnterpriseLeadImportResponse }) {
  if (result.status === "rejected") return <section className="lead-import-report lead-import-report--error"
    aria-live="polite"><h3>整批未写入</h3><p>共 {result.totalRows} 行，发现 {result.errors.length} 个错误。</p>
    <ul>{result.errors.slice(0, 50).map((item, index) => <li
      key={`${item.rowNumber}:${item.field}:${index}`}>第 {item.rowNumber} 行 · {item.field} · {item.code}</li>)}</ul></section>;
  return <section className="lead-import-report" aria-live="polite"><h3>
    {result.status === "replayed" ? "已安全重放" : "整批导入已提交"}</h3>
    <p>共 {result.batch.totalRows} 行：新建 {result.batch.createdCount}、关联 {result.batch.linkedCount}、重复 {result.batch.duplicateCount}。</p></section>;
}
async function readCsv(file: File | undefined, setPayload: (value: string) => void,
  setSource: (value: string) => void, setError: (value: string | null) => void) {
  if (!file) return;
  if (file.size > 512 * 1_024) { setError("CSV 文件不能超过 512 KiB。"); return; }
  setPayload(await file.text()); setSource(file.name); setError(null);
}
function commandKey(command: string) {
  return `web-leads:${command}:${crypto.randomUUID()}`;
}
