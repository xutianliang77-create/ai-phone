import type { FastifyInstance } from "fastify";
import { requireEnterpriseScope } from "./enterprise-auth.js";
import type { EnterpriseProviderReadinessService } from "./enterprise-provider-readiness.js";

export async function registerEnterpriseProviderReadinessRoutes(
  app: FastifyInstance,
  service: EnterpriseProviderReadinessService,
) {
  app.get("/enterprise/v1/provider-capabilities", async (request, reply) => {
    const context = requireEnterpriseScope(request, reply, "tenant:read");
    if (!context) return;
    return {
      capabilities: await service.getCapabilities({
        region: context.tenant.homeRegion,
      }),
    };
  });
}
