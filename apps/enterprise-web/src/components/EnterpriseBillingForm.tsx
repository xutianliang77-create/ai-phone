import { useState } from "react";
import type { ChangeEnterpriseSubscriptionRequest, EnterpriseSubscriptionDto } from "@translation/contracts";

type SubscriptionInput = Omit<ChangeEnterpriseSubscriptionRequest, "tenantId">;

export function EnterpriseBillingForm({
  subscription,
  busy,
  idempotencyKey,
  onSubmit,
}: {
  subscription: EnterpriseSubscriptionDto;
  busy: boolean;
  idempotencyKey: string;
  onSubmit(input: SubscriptionInput): void;
}) {
  const [planCode, setPlanCode] = useState(subscription.planCode);
  const [planVersion, setPlanVersion] = useState(subscription.planVersion);
  const [seats, setSeats] = useState(subscription.seats);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">(
    subscription.billingCycle === "annual" ? "annual" : "monthly",
  );

  return (
    <form className="settings-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit({
        planCode: planCode.trim(),
        planVersion: planVersion.trim(),
        seats,
        billingCycle,
        idempotencyKey,
      });
    }}>
      <header><div><h2>变更订阅</h2><p>必须填写服务端已经发布的精确套餐代码和版本。</p></div></header>
      <div className="settings-form__grid">
        <label>套餐代码<input aria-label="套餐代码" required value={planCode} onChange={(event) => setPlanCode(event.target.value)} /></label>
        <label>套餐版本<input aria-label="套餐版本" required value={planVersion} onChange={(event) => setPlanVersion(event.target.value)} /></label>
        <label>席位数<input aria-label="席位数" type="number" min="1" step="1" required value={seats} onChange={(event) => setSeats(Number(event.target.value))} /></label>
        <label>账单周期<select aria-label="账单周期" value={billingCycle} onChange={(event) => setBillingCycle(event.target.value as "monthly" | "annual")}>
          <option value="monthly">月付</option><option value="annual">年付</option>
        </select></label>
      </div>
      <p className="settings-form__truth">当前没有套餐目录、支付或发票 API；本表单只提交订阅变更请求，并在重试时保持同一幂等键。</p>
      <div className="settings-form__actions"><button className="button button--primary" disabled={busy} type="submit">{busy ? "提交中…" : "提交变更"}</button></div>
    </form>
  );
}
