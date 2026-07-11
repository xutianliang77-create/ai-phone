import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  attachVoiceProfileReferenceAudio,
  createMyVoiceProfile,
  deleteMyVoiceProfile,
  getMyVoiceProfile,
} from "./voice-profiles.service.js";
import { synthesizeMyVoiceTestAudio } from "./voice-profile-test-audio.js";

export async function registerVoiceProfileRoutes(app: FastifyInstance) {
  app.get("/voice-profiles/me", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    return { profile: getMyVoiceProfile(account.id) };
  });

  app.post("/voice-profiles/me", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const result = createMyVoiceProfile(
      account.id,
      (request.body ?? {}) as Record<string, unknown>,
    );
    if (!result.ok) return sendError(reply, 400, result.code, result.code);
    return { profile: result.profile };
  });

  app.post("/voice-profiles/me/reference-audio", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const result = await attachVoiceProfileReferenceAudio(
      account.id,
      (request.body ?? {}) as Record<string, unknown>,
    );
    if (!result.ok) {
      const statusCode =
        result.code === "voice_reference_sync_failed" ? 503 : 400;
      const message =
        "message" in result ? result.message ?? result.code : result.code;
      return sendError(
        reply,
        statusCode,
        result.code,
        message,
      );
    }
    return { profile: result.profile };
  });

  app.post("/voice-profiles/me/test-audio", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const result = await synthesizeMyVoiceTestAudio(
      account.id,
      (request.body ?? {}) as Record<string, unknown>,
    );
    if (!result.ok) {
      return sendError(
        reply,
        result.statusCode,
        result.code,
        result.message,
      );
    }
    return result.response;
  });

  app.delete("/voice-profiles/me", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const result = deleteMyVoiceProfile(account.id);
    if (!result.ok) return sendError(reply, 404, result.code, result.code);
    return { profile: result.profile };
  });
}
