import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";

/** Keep deferred creation/inference surfaces closed; retain history and cleanup routes. */
export function registerFormalReleaseScope(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    if (process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL !== "app_store") return;
    const route = request.routeOptions.url ?? "";
    if (route.startsWith("/join/") || (request.method === "POST" &&
        route.startsWith("/call-links") && !route.endsWith("/end"))) {
      return sendError(reply, 503, "call_link_not_in_release", "Call links are not available in this release");
    }
    if (request.method !== "POST") return;
    if (/^\/billing\/orders(?:\/[^/]+\/confirm)?$/.test(route)) {
      return sendError(reply, 503, "purchases_not_in_release", "Purchases are not available in this release");
    }
    if (/^\/voice-(profiles|identities)(\/|$)/.test(route)) {
      return sendError(reply, 503, "voice_cloning_not_in_release", "Voice enrollment is not available in this release");
    }
    if (/^\/(agent-calls|device-calls)(\/|$)/.test(route) && !route.endsWith("/end")) {
      return sendError(reply, 503, "calling_not_in_release", "Calling is not available in this release");
    }
  });
}
