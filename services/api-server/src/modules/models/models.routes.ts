import type { FastifyInstance } from "fastify";
import { getModelRoutingStatus } from "./model-routing.js";
import { loadVoicePresetCatalog } from "./voice-presets.js";
import {registerPublicModelConfigurationRoutes} from "./public-model-config.routes.js";

export async function registerModelRoutes(app: FastifyInstance) {
  registerPublicModelConfigurationRoutes(app);
  app.get("/models/routing", async (_request, reply) => {
    const status = getModelRoutingStatus();
    const statusCode = status.status === "ready" ? 200 : 503;
    return reply.status(statusCode).send(status);
  });

  app.get("/voice-presets", async (_request, reply) => {
    try {
      return await loadVoicePresetCatalog();
    } catch (error) {
      requestLogError(reply, error);
      return reply.status(503).send({
        error: {
          code: "voice_presets_unavailable",
          message: "Voice presets are temporarily unavailable",
        },
      });
    }
  });
}

function requestLogError(reply: { log: { warn: (value: object, message: string) => void } }, error: unknown) {
  reply.log.warn({
    errorMessage: error instanceof Error ? error.message : String(error),
  }, "Voice preset catalog unavailable");
}
