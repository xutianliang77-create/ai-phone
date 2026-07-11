import type { Plan } from "@translation/contracts";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

export type PlanCode = Plan["code"];

const plans: Plan[] = [
  {
    code: "free",
    displayName: "Free",
    monthlySeconds: 300,
    exportEnabled: false,
    termbaseEnabled: false,
    summaryEnabled: false,
  },
  {
    code: "pro",
    displayName: "Pro",
    monthlySeconds: 6000,
    exportEnabled: true,
    termbaseEnabled: false,
    summaryEnabled: false,
  },
  {
    code: "premium",
    displayName: "Premium",
    monthlySeconds: 30000,
    exportEnabled: true,
    termbaseEnabled: true,
    summaryEnabled: true,
  },
];

export function listPlans() {
  return plans;
}

export function activePlan() {
  return planForCode(
    process.env.ACTIVE_PLAN_CODE ?? process.env.SUBSCRIPTION_PLAN_CODE,
  );
}

export function activePlanForUser(userId: string) {
  const code = getStoreSnapshot().entitlementPlanCodes[userId];
  return code ? planForCode(code) : activePlan();
}

export function planForCode(code: string | undefined) {
  return findPlanByCode(code) ?? plans[0];
}

export function findPlanByCode(code: string | undefined) {
  return plans.find((plan) => plan.code === code) ?? null;
}
