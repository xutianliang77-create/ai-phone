import { useState } from "react";
import {
  enterpriseUsageCategories,
  type ConfigureEnterpriseUsageBudgetRequest,
  type EnterpriseUsageBudgetDto,
  type EnterpriseUsageCategory,
} from "@translation/contracts";
import { unitLabels, usageCategoryPresentation } from "../enterprise-settings.js";

type BudgetInput = Omit<ConfigureEnterpriseUsageBudgetRequest, "tenantId">;

export function EnterpriseBudgetForm({
  budget,
  busy,
  onCancel,
  onSubmit,
}: {
  budget?: EnterpriseUsageBudgetDto;
  busy: boolean;
  onCancel(): void;
  onSubmit(category: EnterpriseUsageCategory, input: BudgetInput): void;
}) {
  const initialPeriod = defaultPeriod();
  const [category, setCategory] = useState<EnterpriseUsageCategory>(budget?.category ?? "meeting_audio_seconds");
  const [limitAmount, setLimitAmount] = useState(budget?.limitAmount ?? 0);
  const [threshold, setThreshold] = useState(budget?.alertThresholdPercent ?? 80);
  const [periodStart, setPeriodStart] = useState(toLocalInput(budget?.periodStart ?? initialPeriod.start));
  const [periodEnd, setPeriodEnd] = useState(toLocalInput(budget?.periodEnd ?? initialPeriod.end));
  const unit = budget?.unit ?? usageCategoryPresentation[category].unit;

  return (
    <form className="settings-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit(category, {
        unit,
        limitAmount,
        alertThresholdPercent: threshold,
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
        ...(budget ? { expectedVersion: budget.version } : {}),
      });
    }}>
      <header><div><h2>{budget ? "编辑预算" : "配置预算"}</h2><p>预算是服务端控制配置，不代表余额、账单或 Provider 配额。</p></div></header>
      <div className="settings-form__grid">
        <label>用量类别<select aria-label="用量类别" value={category} disabled={Boolean(budget)} onChange={(event) => setCategory(event.target.value as EnterpriseUsageCategory)}>
          {enterpriseUsageCategories.map((value) => <option key={value} value={value}>{usageCategoryPresentation[value].label}</option>)}
        </select></label>
        <label>计量单位<input aria-label="计量单位" value={unitLabels[unit]} readOnly /></label>
        <label>预算上限<input aria-label="预算上限" type="number" min="0" step="1" required value={limitAmount} onChange={(event) => setLimitAmount(Number(event.target.value))} /></label>
        <label>提醒阈值（%）<input aria-label="提醒阈值" type="number" min="1" max="100" step="1" required value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></label>
        <label>开始时间<input aria-label="开始时间" type="datetime-local" required value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
        <label>结束时间<input aria-label="结束时间" type="datetime-local" required value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
      </div>
      <p className="settings-form__truth">{budget ? `保存时携带服务端 expectedVersion ${budget.version}，冲突不会覆盖新版本。` : "同一类别的时间段不能与现有预算重叠。"}</p>
      <div className="settings-form__actions">
        <button className="button button--secondary" type="button" disabled={busy} onClick={onCancel}>取消</button>
        <button className="button button--primary" type="submit" disabled={busy}>{busy ? "保存中…" : "保存预算"}</button>
      </div>
    </form>
  );
}

function defaultPeriod() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
