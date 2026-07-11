import type { FastifyInstance } from "fastify";
import { getModelRoutingStatus } from "./model-routing.js";

export async function registerModelRoutes(app: FastifyInstance) {
  app.get("/models/routing", async (_request, reply) => {
    const status = getModelRoutingStatus();
    const statusCode = status.status === "ready" ? 200 : 503;
    return reply.status(statusCode).send(status);
  });
}
