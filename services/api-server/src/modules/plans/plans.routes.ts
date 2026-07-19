import type { FastifyInstance } from "fastify";
import { listPlans } from "./plans-runtime.service.js";

export async function registerPlansRoutes(app: FastifyInstance) {
  app.get("/plans", async () => ({ plans: listPlans() }));
}
