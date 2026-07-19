import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import * as legacy from "./plans.service.js";

export type PlanCode = legacy.PlanCode;

export const listPlans = legacy.listPlans;
export const activePlan = legacy.activePlan;
export const planForCode = legacy.planForCode;
export const findPlanByCode = legacy.findPlanByCode;

export async function activePlanForUser(userId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.activePlanForUser(userId);
  const entitlement = await runtime.postgres.billingQueries.findEntitlement(userId);
  return entitlement?.status === "active"
    ? legacy.planForCode(entitlement.planCode)
    : legacy.activePlan();
}
