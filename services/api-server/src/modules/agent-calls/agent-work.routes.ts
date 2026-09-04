import type { FastifyInstance } from "fastify";
import { registerAgentWorkControlRoutes } from
  "./agent-work-control.routes.js";
import { registerAgentWorkTurnPermissionRoutes } from
  "./agent-work-turn-permission.routes.js";
import { registerAgentWorkUserPermissionRoutes } from
  "./agent-work-user-permission.routes.js";

export function registerAgentWorkRoutes(app: FastifyInstance) {
  registerAgentWorkTurnPermissionRoutes(app);
  registerAgentWorkControlRoutes(app);
  registerAgentWorkUserPermissionRoutes(app);
}
