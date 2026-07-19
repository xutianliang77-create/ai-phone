import type { EnterpriseGlobalSuppressionRegistryReadiness } from
  "@translation/contracts";

export interface EnterpriseGlobalSuppressionRegistry {
  readiness(): EnterpriseGlobalSuppressionRegistryReadiness;
}

export function unavailableEnterpriseGlobalSuppressionRegistry():
EnterpriseGlobalSuppressionRegistry {
  return Object.freeze({
    readiness: () => ({
      status: "not_configured" as const,
      reasonCode: "global_suppression_registry_not_configured",
    }),
  });
}
